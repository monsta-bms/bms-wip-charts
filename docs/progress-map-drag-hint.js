(function attachProgressMapDragHint(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.BmsProgressMapDragHint = api;
})(typeof window !== "undefined" ? window : globalThis, function createProgressMapDragHint() {
  "use strict";

  function isVisible(state = {}) {
    return state.editable === true
      && state.mapAvailable === true
      && state.analysisComplete === true
      && Number(state.paintedCount) === 0
      && state.isDragging !== true
      && state.isRejected !== true
      && state.isCompletionLocked !== true
      && state.hasFailure !== true;
  }

  return Object.freeze({ isVisible });
});
