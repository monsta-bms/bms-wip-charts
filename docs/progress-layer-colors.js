(() => {
  const PROGRESS_LAYER_COLORS = {
    initial: {
      stroke: "#2E8B57",
      fill: "#2E8B57"
    },
    parent: {
      stroke: "#2E8B57",
      fill: "rgba(46, 139, 87, 0.32)"
    },
    followups: [
      { stroke: "#4A90E2", fill: "#4A90E2" },
      { stroke: "#8B6BD6", fill: "#8B6BD6" },
      { stroke: "#E39D3C", fill: "#E39D3C" },
      { stroke: "#D96C6C", fill: "#D96C6C" },
      { stroke: "#2BA7A0", fill: "#2BA7A0" }
    ],
    completion: {
      stroke: "#2E8B57",
      fill: "#2E8B57"
    },
    rejected: {
      stroke: "#7A4A30",
      fill: "#7A4A30"
    },
    empty: {
      stroke: "#D8E8E2",
      fill: "#CFE3DC"
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
    return kind === "followup" || color === "#2563eb" || color === "#4a90e2";
  }

  function getLayerPaintPriority(layer = {}) {
    const kind = String(layer?.kind || "").toLowerCase();
    if (kind === "rejected_auto_fill") return 4;
    if (kind === "followup") return 3;
    if (kind === "completion_fill") return 1;
    return 2;
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
    root.style.setProperty("--progress-stroke-empty", PROGRESS_LAYER_COLORS.empty.stroke);
  }

  window.BmsProgressLayerColors = {
    PROGRESS_LAYER_COLORS,
    getFollowupColor,
    getLayerPaintPriority,
    resolveProgressLayerStyle,
    getLayerStorageColor,
    getLayerFillColor,
    applyCssVariables
  };

  applyCssVariables();
})();
