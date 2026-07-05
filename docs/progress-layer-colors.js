(() => {
  const PROGRESS_LAYER_COLORS = {
    initial: {
      stroke: "#1f7a5c",
      fill: "rgba(37, 111, 93, 0.44)"
    },
    parent: {
      stroke: "#1f7a5c",
      fill: "rgba(37, 111, 93, 0.2)"
    },
    followups: [
      { stroke: "#2563eb", fill: "rgba(37, 99, 235, 0.5)" },
      { stroke: "#7c3aed", fill: "rgba(124, 58, 237, 0.46)" },
      { stroke: "#dc6b19", fill: "rgba(220, 107, 25, 0.46)" },
      { stroke: "#0891b2", fill: "rgba(8, 145, 178, 0.46)" },
      { stroke: "#be123c", fill: "rgba(190, 18, 60, 0.42)" }
    ],
    completion: {
      stroke: "#15803d",
      fill: "rgba(21, 128, 61, 0.5)"
    },
    rejected: {
      stroke: "#7a3418",
      fill: "rgba(122, 52, 24, 0.42)"
    },
    empty: {
      stroke: "#d8e1e8",
      fill: "#edf2f5"
    }
  };

  function getFollowupColor(index = 0) {
    const colors = PROGRESS_LAYER_COLORS.followups;
    const safeIndex = Number.isInteger(Number(index)) ? Math.max(0, Number(index)) : 0;
    return colors[safeIndex % colors.length];
  }

  function isFollowupLayer(layer) {
    const kind = String(layer?.kind || "").toLowerCase();
    const color = String(layer?.color || "").toLowerCase();
    return kind === "followup" || color === "#2563eb";
  }

  function getFollowupIndex(layer, index, context) {
    if (Number.isInteger(Number(context?.followupIndex))) {
      return Math.max(0, Number(context.followupIndex));
    }

    if (Number.isInteger(Number(layer?.followupIndex))) {
      return Math.max(0, Number(layer.followupIndex));
    }

    if (Number.isInteger(Number(index))) {
      return Math.max(0, Number(index) - 1);
    }

    return 0;
  }

  function resolveProgressLayerStyle(layer = {}, index = 0, context = {}) {
    const role = String(context.role || "").toLowerCase();
    const kind = String(layer?.kind || "").toLowerCase();

    if (role === "empty") {
      return PROGRESS_LAYER_COLORS.empty;
    }

    if (role === "parent") {
      return PROGRESS_LAYER_COLORS.parent;
    }

    if (role === "current") {
      return getFollowupColor(getFollowupIndex(layer, index, context));
    }

    if (kind === "rejected_auto_fill") {
      return PROGRESS_LAYER_COLORS.rejected;
    }

    if (kind === "completion_fill") {
      return layer?.color ? colorBackedStyle(layer.color, PROGRESS_LAYER_COLORS.completion.fill) : PROGRESS_LAYER_COLORS.completion;
    }

    if (isFollowupLayer(layer)) {
      return getFollowupColor(getFollowupIndex(layer, index, context));
    }

    if (layer?.color) {
      return colorBackedStyle(layer.color, PROGRESS_LAYER_COLORS.initial.fill);
    }

    return PROGRESS_LAYER_COLORS.initial;
  }

  function colorBackedStyle(stroke, fallbackFill) {
    return {
      stroke,
      fill: fallbackFill
    };
  }

  function getLayerStorageColor(layer, index, context) {
    return resolveProgressLayerStyle(layer, index, context).stroke;
  }

  function getLayerFillColor(layer, index, context) {
    return resolveProgressLayerStyle(layer, index, context).fill;
  }

  function applyCssVariables(root = document.documentElement) {
    if (!root?.style) {
      return;
    }

    root.style.setProperty("--progress-fill-initial", PROGRESS_LAYER_COLORS.initial.fill);
    root.style.setProperty("--progress-fill-parent", PROGRESS_LAYER_COLORS.parent.fill);
    root.style.setProperty("--progress-fill-current", getFollowupColor(0).fill);
    root.style.setProperty("--progress-fill-rejected", PROGRESS_LAYER_COLORS.rejected.fill);
    root.style.setProperty("--progress-fill-empty", PROGRESS_LAYER_COLORS.empty.fill);
  }

  window.BmsProgressLayerColors = {
    PROGRESS_LAYER_COLORS,
    getFollowupColor,
    resolveProgressLayerStyle,
    getLayerStorageColor,
    getLayerFillColor,
    applyCssVariables
  };

  applyCssVariables();
})();
