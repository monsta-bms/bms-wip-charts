"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(
  path.resolve(__dirname, "..", "docs", "chart-render-pipeline.js"),
  "utf8"
);
let passed = 0;

function check(name, action) {
  action();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

function makeNode(name) {
  return {
    name,
    nodeType: 1,
    matches(selector) {
      return selector === ".chart-group" && name.startsWith("chart-");
    }
  };
}

function makeTarget(names = []) {
  const target = {
    children: names.map(makeNode),
    querySelectorAll() {
      return [];
    }
  };
  Object.defineProperty(target, "childNodes", { get: () => target.children });
  return target;
}

function loadPipeline(defaultTarget = makeTarget()) {
  const warnings = [];
  const errors = [];
  const browserWindow = {
    console: {
      warn(message, detail) {
        warnings.push({ message, detail });
      },
      error(message, detail) {
        errors.push({ message, detail });
      }
    },
    document: {
      querySelector(selector) {
        return selector === "#chartList" ? defaultTarget : null;
      }
    }
  };
  const module = { exports: {} };
  const context = vm.createContext({ window: browserWindow, module, console: browserWindow.console });
  vm.runInContext(source, context, { filename: "chart-render-pipeline.js" });
  return { api: module.exports, browserWindow, defaultTarget, warnings, errors };
}

function registerBase(api, calls = [], implementation = null) {
  api.setBaseRenderer({
    name: "test-base",
    run(context) {
      calls.push(`base:${context.mode}`);
      if (implementation) {
        return implementation(context);
      }
      const nodes = context.charts.map((_, index) => makeNode(`chart-${index}`));
      context.target.children = context.mode === "append"
        ? [...context.target.children, ...nodes]
        : nodes;
      return nodes.length;
    }
  });
}

check("global is published", () => {
  const loaded = loadPipeline();
  assert.equal(loaded.browserWindow.BmsChartRenderPipeline, loaded.api);
});

check("public API is fixed", () => {
  const { api } = loadPipeline();
  assert.deepEqual(Object.keys(api).sort(), [
    "getRegisteredStages",
    "registerDataStage",
    "registerMountStage",
    "registerPostRenderStage",
    "render",
    "renderInto",
    "setBaseRenderer"
  ]);
});

check("public API is frozen", () => {
  assert.equal(Object.isFrozen(loadPipeline().api), true);
});

check("base renderer registers", () => {
  const { api } = loadPipeline();
  registerBase(api);
  assert.equal(api.getRegisteredStages().base.name, "test-base");
});

check("base renderer rejects duplicate registration", () => {
  const { api } = loadPipeline();
  registerBase(api);
  assert.throws(() => registerBase(api), { code: "CHART_RENDER_BASE_DUPLICATE" });
});

check("data stage registers", () => {
  const { api } = loadPipeline();
  api.registerDataStage({ name: "data-stage", order: 1, run() {} });
  assert.equal(api.getRegisteredStages().data[0].name, "data-stage");
});

check("post-render stage registers", () => {
  const { api } = loadPipeline();
  api.registerPostRenderStage({ name: "post-stage", order: 1, run() {} });
  assert.equal(api.getRegisteredStages().postRender[0].name, "post-stage");
});

check("mount stage registers", () => {
  const { api } = loadPipeline();
  api.registerMountStage({ name: "mount-stage", order: 1, run() {} });
  assert.equal(api.getRegisteredStages().mount[0].name, "mount-stage");
});

check("same stage name in one collection is rejected", () => {
  const { api } = loadPipeline();
  api.registerPostRenderStage({ name: "same", order: 1, run() {} });
  assert.throws(
    () => api.registerPostRenderStage({ name: "same", order: 2, run() {} }),
    { code: "CHART_RENDER_STAGE_DUPLICATE" }
  );
});

check("same stage name across collections is rejected", () => {
  const { api } = loadPipeline();
  api.registerDataStage({ name: "shared-name", order: 1, run() {} });
  assert.throws(
    () => api.registerMountStage({ name: "shared-name", order: 2, run() {} }),
    { code: "CHART_RENDER_STAGE_DUPLICATE" }
  );
});

check("invalid stage name is rejected", () => {
  const { api } = loadPipeline();
  assert.throws(
    () => api.registerDataStage({ name: "user input", order: 1, run() {} }),
    { code: "CHART_RENDER_STAGE_INVALID" }
  );
});

check("non-integer stage order is rejected", () => {
  const { api } = loadPipeline();
  assert.throws(
    () => api.registerDataStage({ name: "bad-order", order: 1.5, run() {} }),
    { code: "CHART_RENDER_STAGE_INVALID" }
  );
});

check("stages run by order", () => {
  const { api } = loadPipeline();
  const calls = [];
  registerBase(api, calls);
  api.registerPostRenderStage({ name: "later", order: 20, run: () => calls.push("later") });
  api.registerPostRenderStage({ name: "earlier", order: 10, run: () => calls.push("earlier") });
  api.render({ charts: [] });
  assert.deepEqual(calls, ["base:replace", "earlier", "later"]);
});

check("same order is stable by stage name", () => {
  const { api } = loadPipeline();
  const calls = [];
  registerBase(api);
  api.registerPostRenderStage({ name: "zeta", order: 10, run: () => calls.push("zeta") });
  api.registerPostRenderStage({ name: "alpha", order: 10, run: () => calls.push("alpha") });
  api.render({ charts: [] });
  assert.deepEqual(calls, ["alpha", "zeta"]);
});

check("initial render locks registration", () => {
  const { api } = loadPipeline();
  registerBase(api);
  api.render({ charts: [] });
  assert.equal(api.getRegisteredStages().locked, true);
  assert.throws(
    () => api.registerMountStage({ name: "late", order: 1, run() {} }),
    { code: "CHART_RENDER_REGISTRATION_LOCKED" }
  );
});

check("registered stage snapshots are immutable", () => {
  const { api } = loadPipeline();
  api.registerDataStage({ name: "frozen", order: 1, run() {} });
  const stages = api.getRegisteredStages();
  assert.equal(Object.isFrozen(stages), true);
  assert.equal(Object.isFrozen(stages.data), true);
  assert.equal(Object.isFrozen(stages.data[0]), true);
});

check("replace mode replaces target children", () => {
  const target = makeTarget(["old"]);
  const { api } = loadPipeline(target);
  registerBase(api);
  const context = api.render({ charts: [{}, {}] }, { mode: "replace" });
  assert.deepEqual(target.children.map((node) => node.name), ["chart-0", "chart-1"]);
  assert.equal(context.mode, "replace");
});

check("append mode preserves target children", () => {
  const target = makeTarget(["old"]);
  const oldNode = target.children[0];
  const { api } = loadPipeline(target);
  registerBase(api);
  const context = api.render({ charts: [{}] }, { mode: "append", source: "load-more" });
  assert.equal(target.children[0], oldNode);
  assert.deepEqual(Array.from(context.renderedNodes, (node) => node.name), ["chart-0"]);
});

check("detail mode is preserved", () => {
  const { api } = loadPipeline();
  registerBase(api);
  assert.equal(api.render({ charts: [] }, { mode: "detail", source: "detail" }).mode, "detail");
});

check("renderInto uses the explicit target", () => {
  const { api, defaultTarget } = loadPipeline();
  const detailTarget = makeTarget();
  registerBase(api);
  const context = api.renderInto({ charts: [{}] }, detailTarget, { mode: "detail" });
  assert.equal(context.target, detailTarget);
  assert.equal(defaultTarget.children.length, 0);
});

check("data stage does not require input mutation", () => {
  const input = Object.freeze({ charts: Object.freeze([Object.freeze({ id: "a" })]) });
  const { api } = loadPipeline();
  registerBase(api);
  api.registerDataStage({
    name: "copy",
    order: 1,
    run(context) {
      return { ...context.data, charts: [...context.charts, { id: "b" }] };
    }
  });
  const context = api.render(input);
  assert.equal(input.charts.length, 1);
  assert.equal(context.charts.length, 2);
});

check("context exposes stable fields", () => {
  const { api, defaultTarget } = loadPipeline();
  registerBase(api);
  const context = api.render({ charts: [] }, {
    source: "management-refresh",
    selectedChartId: "chart-id",
    suppressFavorites: true
  });
  assert.equal(context.target, defaultTarget);
  assert.equal(context.source, "management-refresh");
  assert.equal(context.selectedChartId, "chart-id");
  assert.equal(context.suppressFavorites, true);
  assert.equal(context.append, false);
});

check("each stage runs once", () => {
  const { api } = loadPipeline();
  const counts = { data: 0, post: 0, mount: 0 };
  registerBase(api);
  api.registerDataStage({ name: "data", order: 1, run: (context) => { counts.data += 1; return context.data; } });
  api.registerPostRenderStage({ name: "post", order: 1, run: () => { counts.post += 1; } });
  api.registerMountStage({ name: "mount", order: 1, run: () => { counts.mount += 1; } });
  api.render({ charts: [] });
  assert.deepEqual(counts, { data: 1, post: 1, mount: 1 });
});

check("suppressMount skips mount stages", () => {
  const { api } = loadPipeline();
  let count = 0;
  registerBase(api);
  api.registerMountStage({ name: "mount", order: 1, run: () => { count += 1; } });
  api.render({ charts: [] }, { suppressMount: true });
  assert.equal(count, 0);
});

check("required stage failure propagates", () => {
  const { api, errors } = loadPipeline();
  registerBase(api);
  api.registerPostRenderStage({ name: "required", order: 1, required: true, run() { throw new Error("private"); } });
  assert.throws(() => api.render({ charts: [] }), { code: "CHART_RENDER_STAGE_FAILED" });
  assert.equal(errors[0].detail.stageName, "required");
});

check("optional stage failure warns and continues", () => {
  const { api, warnings } = loadPipeline();
  let mounted = 0;
  registerBase(api);
  api.registerPostRenderStage({ name: "optional", order: 1, required: false, run() { throw new Error("private"); } });
  api.registerMountStage({ name: "mount", order: 1, run() { mounted += 1; } });
  const context = api.render({ charts: [] });
  assert.equal(mounted, 1);
  assert.equal(warnings.length, 1);
  assert.equal(context.stageResults.find((item) => item.name === "optional").status, "failed");
});

check("base failure propagates with a fixed code", () => {
  const { api } = loadPipeline();
  registerBase(api, [], () => { throw new Error("private input text"); });
  assert.throws(() => api.render({ charts: [] }), { code: "CHART_RENDER_BASE_FAILED" });
});

check("base must be registered", () => {
  const { api } = loadPipeline();
  assert.throws(() => api.render({ charts: [] }), { code: "CHART_RENDER_BASE_MISSING" });
});

check("same-target reentrancy is rejected", () => {
  const { api, defaultTarget } = loadPipeline();
  registerBase(api, [], () => api.renderInto({ charts: [] }, defaultTarget));
  assert.throws(() => api.render({ charts: [] }), { code: "CHART_RENDER_REENTRANT" });
});

check("different-target nested render is allowed", () => {
  const { api, defaultTarget } = loadPipeline();
  const detailTarget = makeTarget();
  let nested = false;
  registerBase(api, [], (context) => {
    if (context.target === defaultTarget && !nested) {
      nested = true;
      api.renderInto({ charts: [] }, detailTarget, { mode: "detail" });
    }
    context.target.children = [];
  });
  api.render({ charts: [] });
  assert.equal(nested, true);
});

check("guard is released after an exception", () => {
  const { api } = loadPipeline();
  let fail = true;
  registerBase(api, [], (context) => {
    if (fail) {
      fail = false;
      throw new Error("first failure");
    }
    context.target.children = [];
  });
  assert.throws(() => api.render({ charts: [] }), { code: "CHART_RENDER_BASE_FAILED" });
  assert.doesNotThrow(() => api.render({ charts: [] }));
});

check("stage results are returned and frozen", () => {
  const { api } = loadPipeline();
  registerBase(api);
  api.registerPostRenderStage({ name: "post", order: 1, run: () => 42 });
  const results = api.render({ charts: [] }).stageResults;
  assert.equal(Object.isFrozen(results), true);
  assert.deepEqual(Array.from(results, (item) => item.name), ["test-base", "post"]);
});

check("invalid mode falls back to replace", () => {
  const { api } = loadPipeline();
  registerBase(api);
  assert.equal(api.render({ charts: [] }, { mode: "unsafe-user-value" }).mode, "replace");
});

check("invalid source falls back to reload", () => {
  const { api } = loadPipeline();
  registerBase(api);
  assert.equal(api.render({ charts: [] }, { source: "unsafe-user-value" }).source, "reload");
});

check("invalid target is rejected", () => {
  const { api } = loadPipeline();
  registerBase(api);
  assert.throws(() => api.renderInto({ charts: [] }, {}), { code: "CHART_RENDER_TARGET_INVALID" });
});

check("error codes do not contain input text", () => {
  const { api } = loadPipeline();
  registerBase(api);
  try {
    api.renderInto({ charts: [{ comment: "secret-like-user-text" }] }, {});
    assert.fail("expected invalid target");
  } catch (error) {
    assert.equal(error.code, "CHART_RENDER_TARGET_INVALID");
    assert.doesNotMatch(error.code, /secret-like-user-text/);
  }
});

check("renderCharts facade calls the pipeline", () => {
  const { api, browserWindow } = loadPipeline();
  registerBase(api);
  const context = browserWindow.renderCharts({ charts: [] }, { mode: "detail" });
  assert.equal(context.mode, "detail");
});

check("facade identity remains stable after renders", () => {
  const { api, browserWindow } = loadPipeline();
  const facade = browserWindow.renderCharts;
  registerBase(api);
  api.render({ charts: [] });
  api.render({ charts: [] });
  assert.equal(browserWindow.renderCharts, facade);
});

check("same input produces the same stage sequence", () => {
  const { api } = loadPipeline();
  registerBase(api);
  api.registerPostRenderStage({ name: "post", order: 1, run() {} });
  const first = Array.from(api.render({ charts: [] }).stageResults, (item) => item.name);
  const second = Array.from(api.render({ charts: [] }).stageResults, (item) => item.name);
  assert.deepEqual(first, second);
});

check("replace reports all current top-level nodes", () => {
  const { api } = loadPipeline();
  registerBase(api);
  const context = api.render({ charts: [{}, {}] });
  assert.deepEqual(Array.from(context.renderedNodes, (node) => node.name), ["chart-0", "chart-1"]);
  assert.equal(Object.isFrozen(context.renderedNodes), true);
});

check("data-stage transformed charts reach the base", () => {
  const { api } = loadPipeline();
  let baseCount = 0;
  registerBase(api, [], (context) => {
    baseCount = context.charts.length;
    context.target.children = [];
  });
  api.registerDataStage({ name: "filter", order: 1, run: (context) => ({ ...context.data, charts: [] }) });
  api.render({ charts: [{}] });
  assert.equal(baseCount, 0);
});

check("originalData remains available after transformation", () => {
  const input = { charts: [{ id: "original" }] };
  const { api } = loadPipeline();
  registerBase(api);
  api.registerDataStage({ name: "filter", order: 1, run: (context) => ({ ...context.data, charts: [] }) });
  const context = api.render(input);
  assert.equal(context.originalData, input);
  assert.equal(context.data.charts.length, 0);
});

check("required flag defaults to true", () => {
  const { api } = loadPipeline();
  api.registerPostRenderStage({ name: "default-required", order: 1, run() {} });
  assert.equal(api.getRegisteredStages().postRender[0].required, true);
});

check("optional flag is preserved", () => {
  const { api } = loadPipeline();
  api.registerMountStage({ name: "optional-mount", order: 1, required: false, run() {} });
  assert.equal(api.getRegisteredStages().mount[0].required, false);
});

let performanceMetrics;
check("8, 100, and 1000 item fixtures keep every stage to one run", () => {
  performanceMetrics = [8, 100, 1000].map((size) => {
    const { api } = loadPipeline();
    const counts = { data: 0, base: 0, tree: 0, favorites: 0, thumbnail: 0, mount: 0 };
    api.registerDataStage({
      name: "favorites-filter",
      order: 100,
      run(context) {
        counts.data += 1;
        return context.data;
      }
    });
    api.setBaseRenderer({
      name: "test-base",
      run(context) {
        counts.base += 1;
        context.target.children = context.charts.map((_, index) => makeNode(`chart-${index}`));
      }
    });
    api.registerPostRenderStage({ name: "tree", order: 100, run() { counts.tree += 1; } });
    api.registerPostRenderStage({ name: "favorites", order: 200, run() { counts.favorites += 1; } });
    api.registerPostRenderStage({ name: "stored-progress-thumbnails", order: 300, run() { counts.thumbnail += 1; } });
    api.registerMountStage({ name: "common-mount", order: 400, run() { counts.mount += 1; } });
    const startedAt = process.hrtime.bigint();
    const context = api.render({ charts: Array.from({ length: size }, (_, index) => ({ id: index })) });
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    assert.deepEqual(counts, { data: 1, base: 1, tree: 1, favorites: 1, thumbnail: 1, mount: 1 });
    assert.equal(context.renderedNodes.length, size);
    return { size, durationMs: Number(durationMs.toFixed(3)), renderedNodes: context.renderedNodes.length };
  });
});

assert.ok(passed >= 35, `expected at least 35 checks, got ${passed}`);
console.log(`chart render pipeline tests: ${passed} checks passed`);
console.log(`chart render pipeline performance fixtures: ${JSON.stringify(performanceMetrics)}`);
