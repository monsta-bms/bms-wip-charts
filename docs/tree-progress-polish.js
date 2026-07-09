(() => {
  const CHART_LIST_SELECTOR = "#chartList";
  const TREE_WIDTH = 78;
  const TREE_HEIGHT = 50;
  const TREE_ROOT_X = 18;
  const TREE_INDENT = 16;
  const TREE_NODE_Y = 25;
  const TREE_NODE_RADIUS = 4;
  const TREE_LINE_END_X = TREE_WIDTH;

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

  const hasLaterVisibleInAncestor = (visibleRows, rowIndex, branchPath, ancestorDepth) => {
    if (ancestorDepth <= 0) {
      return false;
    }

    const ancestorPath = branchPathAtDepth(branchPath, ancestorDepth);
    const currentChildPath = branchPathAtDepth(branchPath, ancestorDepth + 1);
    return visibleRows.slice(rowIndex + 1).some((rowInfo) => {
      if (rowInfo.depth < ancestorDepth) {
        return false;
      }
      if (branchPathAtDepth(rowInfo.branchPath, ancestorDepth) !== ancestorPath) {
        return false;
      }
      return branchPathAtDepth(rowInfo.branchPath, ancestorDepth + 1) !== currentChildPath;
    });
  };

  const hasLaterDescendant = (visibleRows, rowIndex, branchPath) => {
    return visibleRows.slice(rowIndex + 1).some((rowInfo) => isDescendantBranchPath(rowInfo.branchPath, branchPath));
  };

  const getNodeX = (depth) => {
    if (depth <= 0) {
      return TREE_ROOT_X;
    }
    return Math.min(TREE_WIDTH - 12, TREE_ROOT_X + ((depth - 1) * TREE_INDENT));
  };

  const buildPath = (className, d) => `<path class="${className}" d="${d}"></path>`;
  const buildCircle = (className, cx, cy, r) => `<circle class="${className}" cx="${cx}" cy="${cy}" r="${r}"></circle>`;

  const getCollapsedCount = (row) => {
    const button = row.querySelector(".intermediate-toggle-button");
    const count = Number(button?.dataset.count || row.dataset.intermediateGroupCount || 0);
    return Number.isFinite(count) ? count : 0;
  };

  const buildCompressedHistoryMarkers = (rowInfo, hiddenCount) => {
    if (hiddenCount <= 0 || rowInfo.depth <= 1) {
      return { paths: [], circles: [] };
    }

    const maxHiddenDepths = Math.min(hiddenCount, rowInfo.depth - 1);
    const paths = [];
    const circles = [];
    for (let offset = maxHiddenDepths; offset >= 1; offset -= 1) {
      const depth = rowInfo.depth - offset;
      const x = getNodeX(depth);
      paths.push(buildPath("tree-line tree-line-compressed", `M ${x} 7 V ${TREE_HEIGHT - 7}`));
      circles.push(buildCircle("tree-node-compressed", x, TREE_NODE_Y, 2.4));
    }
    return { paths, circles };
  };

  const buildConnectorSvg = (rowInfo, rowIndex, visibleRows) => {
    const depth = Math.max(0, rowInfo.depth);
    const nodeX = getNodeX(depth);
    const nodeY = TREE_NODE_Y;
    const paths = [];
    const circles = [];
    const currentContinues = hasLaterDescendant(visibleRows, rowIndex, rowInfo.branchPath);
    const collapsedCount = getCollapsedCount(rowInfo.row);
    const compressed = buildCompressedHistoryMarkers(rowInfo, collapsedCount);

    if (depth <= 0) {
      if (currentContinues) {
        paths.push(buildPath(
          "tree-line tree-line-current tree-line-below",
          `M ${nodeX} ${nodeY + TREE_NODE_RADIUS + 2} V ${TREE_HEIGHT}`,
        ));
      }
      circles.push(buildCircle("tree-node-dot tree-node-root", nodeX, nodeY, TREE_NODE_RADIUS));
      return `
        <svg class="tree-connector-canvas" viewBox="0 0 ${TREE_WIDTH} ${TREE_HEIGHT}" preserveAspectRatio="none" focusable="false" aria-hidden="true">
          ${paths.join("")}
          ${circles.join("")}
        </svg>
      `;
    }

    for (let level = 1; level < depth; level += 1) {
      if (hasLaterVisibleInAncestor(visibleRows, rowIndex, rowInfo.branchPath, level)) {
        const ancestorX = getNodeX(level);
        paths.push(buildPath(
          "tree-line tree-line-ancestor",
          `M ${ancestorX} 0 V ${TREE_HEIGHT}`,
        ));
      }
    }

    paths.push(...compressed.paths);
    circles.push(...compressed.circles);

    paths.push(buildPath(
      "tree-line tree-line-current tree-line-elbow",
      `M ${nodeX} 0 V ${nodeY - 9} Q ${nodeX} ${nodeY} ${nodeX + 9} ${nodeY} H ${TREE_LINE_END_X}`,
    ));

    if (currentContinues) {
      paths.push(buildPath(
        "tree-line tree-line-current tree-line-below",
        `M ${nodeX} ${nodeY + TREE_NODE_RADIUS + 2} V ${TREE_HEIGHT}`,
      ));
    }

    circles.push(buildCircle("tree-node-dot", nodeX, nodeY, TREE_NODE_RADIUS));

    return `
      <svg class="tree-connector-canvas" viewBox="0 0 ${TREE_WIDTH} ${TREE_HEIGHT}" preserveAspectRatio="none" focusable="false" aria-hidden="true">
        ${paths.join("")}
        ${circles.join("")}
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
        const svg = buildConnectorSvg(rowInfo, rowIndex, visibleRows);
        if (connector.innerHTML !== svg) {
          connector.innerHTML = svg;
        }
      });
    });
  };

  let scheduledFrame = 0;
  const scheduleRefresh = () => {
    if (scheduledFrame && typeof window.cancelAnimationFrame === "function") {
      window.cancelAnimationFrame(scheduledFrame);
    }
    const run = () => {
      scheduledFrame = 0;
      refreshPolishedTreeConnectors(document);
    };
    if (typeof window.requestAnimationFrame === "function") {
      scheduledFrame = window.requestAnimationFrame(run);
      return;
    }
    window.setTimeout(run, 0);
  };

  const mount = () => {
    const chartList = document.querySelector(CHART_LIST_SELECTOR);
    if (!chartList) {
      return;
    }

    chartList.dataset.treeProgressPolishMounted = "true";
    const observer = new MutationObserver(scheduleRefresh);
    observer.observe(chartList, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", "class", "data-depth", "data-branch-path"] });
    chartList.addEventListener("click", (event) => {
      if (event.target.closest(".intermediate-toggle-button")) {
        window.setTimeout(scheduleRefresh, 0);
        window.setTimeout(scheduleRefresh, 80);
      }
    });

    scheduleRefresh();
    window.setTimeout(scheduleRefresh, 50);
    window.setTimeout(scheduleRefresh, 250);
    window.setTimeout(scheduleRefresh, 1000);
    window.addEventListener("load", scheduleRefresh, { once: true });
    window.addEventListener("pageshow", scheduleRefresh);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        scheduleRefresh();
      }
    });

    let attempt = 0;
    const interval = window.setInterval(() => {
      attempt += 1;
      scheduleRefresh();
      if (attempt >= 20) {
        window.clearInterval(interval);
      }
    }, 500);
  };

  window.refreshPolishedTreeConnectors = refreshPolishedTreeConnectors;
  window.schedulePolishedTreeConnectors = scheduleRefresh;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount, { once: true });
  } else {
    mount();
  }
})();
