(function initializeChartRenderPipeline(factory) {
  "use strict";

  const browserWindow = typeof window !== "undefined" ? window : null;
  const api = factory(browserWindow);
  if (typeof module === "object" && module?.exports) {
    module.exports = api;
  }
  if (browserWindow) {
    browserWindow.BmsChartRenderPipeline = api;
    browserWindow.renderCharts = function renderCharts(data, options) {
      return api.render(data, options);
    };
  }
})(function createChartRenderPipelineApi(browserWindow) {
  "use strict";

  const allowedModes = new Set(["replace", "append", "detail"]);
  const allowedSources = new Set([
    "initial",
    "reload",
    "favorite-filter",
    "append-success",
    "management-refresh",
    "load-more",
    "detail"
  ]);
  const stageNamePattern = /^[a-z][a-z0-9-]{0,63}$/;
  const activeTargets = new WeakSet();
  const dataStages = [];
  const postRenderStages = [];
  const mountStages = [];
  let baseRenderer = null;
  let registrationLocked = false;

  function createError(code, message, details = {}) {
    const error = new Error(message);
    error.code = code;
    Object.entries(details).forEach(([key, value]) => {
      error[key] = value;
    });
    return error;
  }

  function logFailure(level, code, stageType, stageName) {
    const targetConsole = browserWindow?.console || console;
    const method = level === "warning" ? "warn" : "error";
    targetConsole?.[method]?.("[chart-render-pipeline] stage failed", {
      code,
      stageType,
      stageName
    });
  }

  function normalizeMode(value) {
    return allowedModes.has(value) ? value : "replace";
  }

  function normalizeSource(value) {
    return allowedSources.has(value) ? value : "reload";
  }

  function normalizeData(value) {
    return value && typeof value === "object" ? value : { charts: [] };
  }

  function validateTarget(target) {
    return Boolean(target)
      && (typeof target === "object" || typeof target === "function")
      && typeof target.querySelectorAll === "function";
  }

  function normalizeRegistration(stage, stageType) {
    if (registrationLocked) {
      throw createError(
        "CHART_RENDER_REGISTRATION_LOCKED",
        "Chart render stages cannot be registered after rendering starts."
      );
    }
    if (!stage || typeof stage !== "object"
      || typeof stage.name !== "string"
      || !stageNamePattern.test(stage.name)
      || !Number.isFinite(stage.order)
      || !Number.isInteger(stage.order)
      || typeof stage.run !== "function") {
      throw createError("CHART_RENDER_STAGE_INVALID", "Chart render stage registration is invalid.", {
        stageType
      });
    }
    return Object.freeze({
      name: stage.name,
      order: stage.order,
      required: stage.required !== false,
      run: stage.run
    });
  }

  function registerStage(collection, stage, stageType) {
    const normalized = normalizeRegistration(stage, stageType);
    if (isStageNameRegistered(normalized.name)) {
      throw createError("CHART_RENDER_STAGE_DUPLICATE", "Chart render stage name is already registered.", {
        stageType,
        stageName: normalized.name
      });
    }
    collection.push(normalized);
    collection.sort((left, right) => left.order - right.order || left.name.localeCompare(right.name));
    return normalized;
  }

  function isStageNameRegistered(name) {
    return baseRenderer?.name === name
      || dataStages.some((entry) => entry.name === name)
      || postRenderStages.some((entry) => entry.name === name)
      || mountStages.some((entry) => entry.name === name);
  }

  function setBaseRenderer(stage) {
    if (registrationLocked) {
      throw createError(
        "CHART_RENDER_REGISTRATION_LOCKED",
        "Chart render stages cannot be registered after rendering starts."
      );
    }
    if (baseRenderer) {
      throw createError("CHART_RENDER_BASE_DUPLICATE", "Chart base renderer is already registered.");
    }
    const normalized = normalizeRegistration({ ...stage, order: 0 }, "base");
    if (isStageNameRegistered(normalized.name)) {
      throw createError("CHART_RENDER_STAGE_DUPLICATE", "Chart render stage name is already registered.", {
        stageType: "base",
        stageName: normalized.name
      });
    }
    baseRenderer = normalized;
    return baseRenderer;
  }

  function registerDataStage(stage) {
    return registerStage(dataStages, stage, "data");
  }

  function registerPostRenderStage(stage) {
    return registerStage(postRenderStages, stage, "post-render");
  }

  function registerMountStage(stage) {
    return registerStage(mountStages, stage, "mount");
  }

  function stageDescriptor(stage) {
    return stage
      ? Object.freeze({ name: stage.name, order: stage.order, required: stage.required })
      : null;
  }

  function getRegisteredStages() {
    return Object.freeze({
      locked: registrationLocked,
      base: stageDescriptor(baseRenderer),
      data: Object.freeze(dataStages.map(stageDescriptor)),
      postRender: Object.freeze(postRenderStages.map(stageDescriptor)),
      mount: Object.freeze(mountStages.map(stageDescriptor))
    });
  }

  function directChildren(target) {
    return Array.from(target.children || target.childNodes || [])
      .filter((node) => node && (node.nodeType === undefined || node.nodeType === 1));
  }

  function runStage(stage, stageType, context) {
    try {
      const result = stage.run(context);
      context.stageResults.push(Object.freeze({
        name: stage.name,
        stageType,
        status: "completed",
        result
      }));
      return result;
    } catch (error) {
      if (error?.code === "CHART_RENDER_REENTRANT") {
        throw error;
      }
      const code = "CHART_RENDER_STAGE_FAILED";
      logFailure(stage.required ? "error" : "warning", code, stageType, stage.name);
      context.stageResults.push(Object.freeze({
        name: stage.name,
        stageType,
        status: "failed",
        code
      }));
      if (stage.required) {
        throw createError(code, "A required chart render stage failed.", {
          stageType,
          stageName: stage.name,
          cause: error
        });
      }
      return undefined;
    }
  }

  function execute(data, target, rawOptions = {}) {
    const options = rawOptions && typeof rawOptions === "object" ? rawOptions : {};
    if (!validateTarget(target)) {
      throw createError("CHART_RENDER_TARGET_INVALID", "Chart render target is invalid.");
    }
    if (activeTargets.has(target)) {
      throw createError("CHART_RENDER_REENTRANT", "Chart rendering is already active for this target.");
    }

    registrationLocked = true;
    if (!baseRenderer) {
      throw createError("CHART_RENDER_BASE_MISSING", "Chart base renderer is not registered.");
    }

    const originalData = normalizeData(data);
    const context = {
      mode: normalizeMode(options.mode),
      source: normalizeSource(options.source),
      target,
      data: originalData,
      originalData,
      charts: Array.isArray(originalData.charts) ? originalData.charts : [],
      append: normalizeMode(options.mode) === "append",
      selectedChartId: typeof options.selectedChartId === "string" ? options.selectedChartId : "",
      suppressFavorites: options.suppressFavorites === true,
      suppressMount: options.suppressMount === true,
      renderedNodes: Object.freeze([]),
      stageResults: []
    };

    activeTargets.add(target);
    try {
      dataStages.forEach((stage) => {
        const transformed = runStage(stage, "data", context);
        if (transformed !== undefined) {
          context.data = normalizeData(transformed);
          context.charts = Array.isArray(context.data.charts) ? context.data.charts : [];
        }
      });

      const childrenBefore = new Set(directChildren(target));
      try {
        const result = baseRenderer.run(context);
        context.stageResults.push(Object.freeze({
          name: baseRenderer.name,
          stageType: "base",
          status: "completed",
          result
        }));
      } catch (error) {
        if (error?.code === "CHART_RENDER_REENTRANT") {
          throw error;
        }
        const code = "CHART_RENDER_BASE_FAILED";
        logFailure("error", code, "base", baseRenderer.name);
        throw createError(code, "The chart base renderer failed.", {
          stageType: "base",
          stageName: baseRenderer.name,
          cause: error
        });
      }

      const childrenAfter = directChildren(target);
      context.renderedNodes = Object.freeze(context.mode === "append"
        ? childrenAfter.filter((node) => !childrenBefore.has(node))
        : childrenAfter);

      postRenderStages.forEach((stage) => runStage(stage, "post-render", context));
      if (!context.suppressMount) {
        mountStages.forEach((stage) => runStage(stage, "mount", context));
      }
      context.stageResults = Object.freeze(context.stageResults.slice());
      return context;
    } finally {
      activeTargets.delete(target);
    }
  }

  function render(data, rawOptions = {}) {
    const options = rawOptions && typeof rawOptions === "object" ? rawOptions : {};
    const target = options.target
      || browserWindow?.document?.querySelector?.("#chartList")
      || null;
    return execute(data, target, options);
  }

  function renderInto(data, target, options = {}) {
    return execute(data, target, options);
  }

  return Object.freeze({
    setBaseRenderer,
    registerDataStage,
    registerPostRenderStage,
    registerMountStage,
    render,
    renderInto,
    getRegisteredStages
  });
});
