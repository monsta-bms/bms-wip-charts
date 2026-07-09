(() => {
  const CHART_LIST_SELECTOR = "#chartList";
  const TREE_WIDTH = 68;
  const TREE_HEIGHT = 50;
  const TREE_ROOT_X = 18;
  const TREE_INDENT = 16;
  const TREE_NODE_Y = 25;
  const TREE_NODE_RADIUS = 4;

  const splitBranchPath = (branchPath) => String(branchPath || "root").split("/").filter(Boolean);
  const getDepthFromBranchPath = (branchPath) => Math.max(0, splitBranchPath(branchPath).length - 1);

  const isDescendantBranchPath = (branchPath, ancestorBranchPath) => {
    const current = splitBranchPath(branchPath);
    const ancestor = splitBranchPath(ancestorBranchPath);
    return current.length > ancestor.length && ancestor.every((segment, index) => current[index] === segment);
  };

  const branchPathAtDepth = (branchPath, depth) => {
    const segments = splitBranchPath(branchPath);
    return segments.slice(0, Math.min(segments.length, depth + 1)).join("/");
  };

  const hasLaterSiblingAtDepth = (visibleRows, rowIndex, branchPath, depth) => {
    const ancestorAtDepth = branchPathAtDepth(branchPath, depth);
    return visibleRows.slice(rowIndex + 1).some((rowInfo) => {
      if (rowInfo.depth < depth) {
        return false;
      }
      if (rowInfo.depth === depth) {
        return branchPathAtDepth(rowInfo.branchPath, depth) !== ancestorAtDepth;
      }
      return branchPathAtDepth(rowInfo.branchPath, depth) !== ancestorAtDepth;
    });
  };

  const hasLaterDescendant = (visibleRows, rowIndex, branchPath) => {
    return visibleRows.slice(rowIndex + 1).some((rowInfo) => isDescendantBranchPath(rowInfo.branchPath, branchPath));
  };

  const getNodeX = (depth) => {
    if (depth <= 0) {
      return TREE_ROOT_X;
    }
    return Math.min(TREE_WIDTH - 10, TREE_ROOT_X + ((depth - 1) * TREE_INDENT));
  };

  const buildPath = (className, d) => `<path class="${className}" d="${d}"></path>`;

  const buildConnectorSvg = (rowInfo, rowIndex, visibleRows) => {
    const depth = Math.max(0, rowInfo.depth);
    const nodeX = getNodeX(depth);
    const nodeY = TREE_NODE_Y;
    const lineEndX = TREE_WIDTH - 2;
    const paths = [];
    const currentContinues = hasLaterDescendant(visibleRows, rowIndex, rowInfo.branchPath);

    if (depth <= 0) {
      if (currentContinues) {
        paths.push(buildPath(
          "tree-line tree-line-current tree-line-below",
          `M ${nodeX} ${nodeY + TREE_NODE_RADIUS + 2} V ${TREE_HEIGHT}`,
        ));
      }
      return `
        <svg class="tree-connector-canvas" viewBox="0 0 ${TREE_WIDTH} ${TREE_HEIGHT}" preserveAspectRatio="none" focusable="false" aria-hidden="true">
          ${paths.join("")}
          <circle class="tree-node-dot tree-node-root" cx="${nodeX}" cy="${nodeY}" r="${TREE_NODE_RADIUS}"></circle>
        </svg>
      `;
    }

    for (let level = 1; level < depth; level += 1) {
      if (hasLaterSiblingAtDepth(visibleRows, rowIndex, rowInfo.branchPath, level)) {
        const ancestorX = getNodeX(level);
        paths.push(buildPath(
          "tree-line tree-line-ancestor",
          `M ${ancestorX} 0 V ${TREE_HEIGHT}`,
        ));
      }
    }

    paths.push(buildPath(
      "tree-line tree-line-current tree-line-elbow",
      `M ${nodeX} 0 V ${nodeY - 8} Q ${nodeX} ${nodeY} ${nodeX + 8} ${nodeY} H ${lineEndX}`,
    ));

    if (currentContinues) {
      paths.push(buildPath(
        "tree-line tree-line-current tree-line-below",
        `M ${nodeX} ${nodeY + TREE_NODE_RADIUS + 2} V ${TREE_HEIGHT}`,
      ));
    }

    return `
      <svg class="tree-connector-canvas" viewBox="0 0 ${TREE_WIDTH} ${TREE_HEIGHT}" preserveAspectRatio="none" focusable="false" aria-hidden="true">
        ${paths.join("")}
        <circle class="tree-node-dot" cx="${nodeX}" cy="${nodeY}" r="${TREE_NODE_RADIUS}"></circle>
      </svg>
    `;
  };

  const collectVisibleRows = (list) => {
    return Array.from(list.querySelectorAll(".version-row.version-tree-row"))
      .filter((row) => row.offsetParent !== null)
      .map((row) => {
        const branchPath = row.dataset.branchPath || "root";
        const depth = Number(row.dataset.depth || getDepthFromBranchPath(branchPath));
        return { row, branchPath, depth: Number.isFinite(depth) ? depth : 0 };
      });
  };

  const refreshPolishedTreeConnectors = (root = document) => {
    const lists = root.querySelectorAll?.(".version-list") || [];
    lists.forEach((list) => {
      const visibleRows = collectVisibleRows(list);
      visibleRows.forEach((rowInfo, rowIndex) => {
        const connector = rowInfo.row.querySelector(".tree-connector");
        if (!connector) {
          return;
        }
        const currentContinues = hasLaterDescendant(visibleRows, rowIndex, rowInfo.branchPath);
        connector.classList.add("tree-connector-svg");
        connector.classList.toggle("tree-connector-root", rowInfo.depth <= 0);
        connector.classList.toggle("tree-connector-grid", rowInfo.depth > 0);
        connector.classList.toggle("continues-below", currentContinues);
        connector.classList.toggle("is-terminal", rowInfo.depth > 0 && !currentContinues);
        connector.innerHTML = buildConnectorSvg(rowInfo, rowIndex, visibleRows);
      });
    });
  };

  let scheduledFrame = 0;
  const scheduleRefresh = () => {
    if (scheduledFrame) {
      window.cancelAnimationFrame(scheduledFrame);
    }
    scheduledFrame = window.requestAnimationFrame(() => {
      scheduledFrame = 0;
      refreshPolishedTreeConnectors(document);
    });
  };

  const mount = () => {
    const chartList = document.querySelector(CHART_LIST_SELECTOR);
    if (!chartList || chartList.dataset.treeProgressPolishMounted === "true") {
      return;
    }
    chartList.dataset.treeProgressPolishMounted = "true";
    const observer = new MutationObserver(scheduleRefresh);
    observer.observe(chartList, { childList: true, subtree: true });
    chartList.addEventListener("click", (event) => {
      if (event.target.closest(".intermediate-toggle-button")) {
        window.setTimeout(scheduleRefresh, 0);
      }
    });
    scheduleRefresh();
  };

  window.refreshPolishedTreeConnectors = refreshPolishedTreeConnectors;
  window.schedulePolishedTreeConnectors = scheduleRefresh;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount, { once: true });
  } else {
    mount();
  }
})();
