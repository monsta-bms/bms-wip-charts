(() => {
  const CHART_LIST_SELECTOR = "#chartList";
  const SVG_NS = "http://www.w3.org/2000/svg";
  const TREE_ZONE_WIDTH = 94;
  const TREE_ROOT_X = 18;
  const TREE_INDENT = 16;
  const TREE_NODE_RADIUS = 3.8;
  const TREE_LABEL_GAP = 8;
  const MAX_WARNINGS = 5;
  let warningCount = 0;

  const splitBranchPath = (branchPath) => String(branchPath || "root").split("/").filter(Boolean);

  const getDepthFromBranchPath = (branchPath) => Math.max(0, splitBranchPath(branchPath).length - 1);

  const branchPathAtDepth = (branchPath, depth) => {
    const segments = splitBranchPath(branchPath);
    return segments.slice(0, Math.min(segments.length, depth + 1)).join("/") || "root";
  };

  const getParentBranchPath = (branchPath) => {
    const depth = getDepthFromBranchPath(branchPath);
    return depth <= 0 ? "" : branchPathAtDepth(branchPath, depth - 1);
  };

  const getNodeXInTreeZone = (depth) => {
    if (depth <= 0) {
      return TREE_ROOT_X;
    }
    return Math.min(TREE_ZONE_WIDTH - 18, TREE_ROOT_X + ((depth - 1) * TREE_INDENT));
  };

  const warnOnce = (message, details) => {
    if (warningCount >= MAX_WARNINGS) {
      return;
    }
    warningCount += 1;
    console.warn(message, details || "");
  };

  const createSvgElement = (name, attributes = {}) => {
    const element = document.createElementNS(SVG_NS, name);
    Object.entries(attributes).forEach(([key, value]) => {
      element.setAttribute(key, String(value));
    });
    return element;
  };

  const appendPath = (svg, className, d) => {
    const path = createSvgElement("path", { class: className, d });
    svg.appendChild(path);
    return path;
  };

  const appendCircle = (svg, className, cx, cy, r) => {
    const circle = createSvgElement("circle", { class: className, cx, cy, r });
    svg.appendChild(circle);
    return circle;
  };

  const ensureOverlay = (list) => {
    let svg = list.querySelector(":scope > .version-tree-overlay");
    if (!svg) {
      svg = createSvgElement("svg", {
        class: "version-tree-overlay",
        focusable: "false",
        "aria-hidden": "true"
      });
      list.prepend(svg);
    }

    let controls = list.querySelector(":scope > .version-tree-overlay-controls");
    if (!controls) {
      controls = document.createElement("div");
      controls.className = "version-tree-overlay-controls";
      list.appendChild(controls);
    }

    return { svg, controls };
  };

  const isVisibleRow = (row) => {
    if (!row || row.hidden || row.hasAttribute("hidden")) {
      return false;
    }
    return row.offsetParent !== null || row.getClientRects().length > 0;
  };

  const getCollapsedGroupControl = (row) => {
    const sourceButton = row.querySelector(".intermediate-toggle-button");
    if (!sourceButton) {
      return null;
    }

    const groupId = sourceButton.dataset.collapsedGroupId || "";
    const count = Number(sourceButton.dataset.count || row.dataset.intermediateGroupCount || 0);
    if (!groupId || !Number.isFinite(count) || count <= 0) {
      return null;
    }

    return {
      groupId,
      count,
      expanded: sourceButton.getAttribute("aria-expanded") === "true" || row.classList.contains("is-group-expanded")
    };
  };

  const collectVisibleRows = (list) => {
    const listRect = list.getBoundingClientRect();
    return Array.from(list.querySelectorAll(":scope > .version-row.version-tree-row"))
      .filter(isVisibleRow)
      .map((row) => {
        const branchPath = row.dataset.branchPath || "root";
        const depthValue = Number(row.dataset.depth || getDepthFromBranchPath(branchPath));
        const depth = Number.isFinite(depthValue) ? Math.max(0, depthValue) : 0;
        const cell = row.querySelector(":scope > .version-tree-cell") || row.querySelector(":scope > .version-tag");
        const label = row.querySelector(".version-label-stack") || row.querySelector(".version-main-label") || cell;
        const rowRect = row.getBoundingClientRect();
        const cellRect = cell?.getBoundingClientRect?.() || rowRect;
        const labelRect = label?.getBoundingClientRect?.() || cellRect;
        const anchorY = Math.round(labelRect.top - listRect.top + (labelRect.height / 2));
        const cellLeft = Math.round(cellRect.left - listRect.left);
        const treeOriginX = cellLeft;
        const nodeX = Math.round(treeOriginX + getNodeXInTreeZone(depth));
        const labelStartX = Math.round(labelRect.left - listRect.left);
        const groupControl = getCollapsedGroupControl(row);
        return {
          key: branchPath,
          type: "row",
          row,
          branchPath,
          parentKey: depth <= 0 ? "" : getParentBranchPath(branchPath),
          depth,
          anchorY,
          treeOriginX,
          nodeX,
          labelStartX,
          groupControl
        };
      });
  };

  const findNearestVisibleAncestor = (node, nodeByBranchPath) => {
    for (let depth = node.depth - 1; depth >= 0; depth -= 1) {
      const ancestorPath = branchPathAtDepth(node.branchPath, depth);
      if (nodeByBranchPath.has(ancestorPath)) {
        return nodeByBranchPath.get(ancestorPath);
      }
    }
    return null;
  };

  const createOmittedNode = (targetNode) => {
    const group = targetNode.groupControl;
    if (!group || group.expanded) {
      return null;
    }

    const targetDepth = targetNode.depth;
    const visibleAncestorDepth = Math.max(0, targetDepth - group.count - 1);
    const omittedDepth = Math.min(targetDepth - 1, visibleAncestorDepth + 1);
    const omittedPath = branchPathAtDepth(targetNode.branchPath, omittedDepth);
    const parentPath = branchPathAtDepth(targetNode.branchPath, visibleAncestorDepth);
    const nodeX = Math.round(targetNode.treeOriginX + getNodeXInTreeZone(omittedDepth));

    return {
      key: `omitted:${group.groupId}`,
      type: "omitted",
      branchPath: omittedPath,
      parentKey: parentPath,
      depth: omittedDepth,
      anchorY: targetNode.anchorY,
      treeOriginX: targetNode.treeOriginX,
      nodeX,
      labelStartX: targetNode.labelStartX,
      count: group.count,
      groupId: group.groupId,
      targetKey: targetNode.key
    };
  };

  const buildVisibleTreeGraph = (list) => {
    const rows = collectVisibleRows(list);
    const nodes = [...rows];
    const omittedNodes = [];
    const nodeByKey = new Map();
    const nodeByBranchPath = new Map();

    rows.forEach((node) => {
      nodeByKey.set(node.key, node);
      nodeByBranchPath.set(node.branchPath, node);
    });

    rows.forEach((node) => {
      const omittedNode = createOmittedNode(node);
      if (!omittedNode) {
        return;
      }
      omittedNodes.push(omittedNode);
      nodes.push(omittedNode);
      nodeByKey.set(omittedNode.key, omittedNode);
      node.parentKey = omittedNode.key;
    });

    const edges = [];
    nodes.forEach((node) => {
      if (!node.parentKey) {
        return;
      }
      const parent = nodeByKey.get(node.parentKey) || nodeByBranchPath.get(node.parentKey) || findNearestVisibleAncestor(node, nodeByBranchPath);
      if (!parent || parent.key === node.key) {
        return;
      }
      edges.push({
        parent,
        child: node,
        omitted: parent.type === "omitted" || node.type === "omitted"
      });
    });

    return { rows, nodes, omittedNodes, edges };
  };

  const buildEdgePath = (parent, child) => {
    const childIsBelow = child.anchorY >= parent.anchorY;
    const direction = childIsBelow ? 1 : -1;
    const sameRow = Math.abs(child.anchorY - parent.anchorY) <= 1;
    if (sameRow) {
      const horizontalStartX = parent.nodeX + TREE_NODE_RADIUS + 1;
      const horizontalEndX = child.nodeX - TREE_NODE_RADIUS - 1;
      if (horizontalEndX > horizontalStartX) {
        return `M ${horizontalStartX} ${parent.anchorY} L ${horizontalEndX} ${child.anchorY}`;
      }
      return `M ${parent.nodeX} ${parent.anchorY} L ${child.nodeX} ${child.anchorY}`;
    }

    const startY = parent.anchorY + (direction * TREE_NODE_RADIUS);
    const endY = child.anchorY;
    const startX = parent.nodeX;
    const endX = child.nodeX - TREE_NODE_RADIUS - 1;
    const sameColumn = Math.abs(child.nodeX - startX) <= 1 || Math.abs(endX - startX) <= (TREE_NODE_RADIUS + 2);

    if (sameColumn) {
      const stopY = endY - (direction * TREE_NODE_RADIUS);
      return `M ${startX} ${startY} L ${startX} ${stopY}`;
    }

    const cornerRadius = Math.max(6, Math.min(12, Math.abs(endX - startX) * 0.55));
    const trunkEndY = endY - (direction * cornerRadius);
    const cornerEndX = Math.min(endX, startX + cornerRadius);
    const parts = [
      `M ${startX} ${startY}`,
      `L ${startX} ${trunkEndY}`,
      `Q ${startX} ${endY} ${cornerEndX} ${endY}`
    ];

    if (endX > cornerEndX + 0.5) {
      parts.push(`L ${endX} ${endY}`);
    }

    return parts.join(" ");
  };

  const drawEdges = (svg, edges) => {
    edges
      .slice()
      .sort((a, b) => a.child.anchorY - b.child.anchorY)
      .forEach((edge) => {
        const className = edge.omitted
          ? "tree-overlay-line tree-overlay-line-edge tree-overlay-line-omitted-edge"
          : "tree-overlay-line tree-overlay-line-edge";
        appendPath(svg, className, buildEdgePath(edge.parent, edge.child));
      });
  };

  const drawLabelLinks = (svg, nodes) => {
    nodes.forEach((node) => {
      if (node.type !== "row") {
        return;
      }
      const startX = node.nodeX + TREE_NODE_RADIUS + 1;
      const endX = Math.max(startX + 6, node.labelStartX - TREE_LABEL_GAP);
      if (endX <= startX) {
        return;
      }
      const d = `M ${startX} ${node.anchorY} L ${endX} ${node.anchorY}`;
      appendPath(svg, "tree-overlay-line tree-overlay-line-label", d);
    });
  };

  const drawNodes = (svg, nodes) => {
    nodes.forEach((node) => {
      if (node.type !== "row") {
        return;
      }
      appendCircle(
        svg,
        node.depth <= 0 ? "tree-overlay-node tree-overlay-node-root" : "tree-overlay-node",
        node.nodeX,
        node.anchorY,
        TREE_NODE_RADIUS
      );
    });
  };

  const addOmittedButton = (controls, node, expanded = false) => {
    const actionText = expanded ? "隠す" : "表示";
    const label = `中間履歴 ${node.count}件を${actionText}`;
    const button = document.createElement("button");
    button.className = `intermediate-toggle-button tree-omission-button${expanded ? " is-expanded" : ""}`;
    button.type = "button";
    button.dataset.collapsedGroupId = node.groupId;
    button.dataset.count = String(node.count);
    button.setAttribute("aria-expanded", expanded ? "true" : "false");
    button.setAttribute("aria-label", label);
    button.title = label;
    button.textContent = expanded ? "−" : `…${node.count}`;
    button.style.left = `${Math.round(node.nodeX)}px`;
    button.style.top = `${Math.round(node.anchorY)}px`;
    controls.appendChild(button);
  };

  const addExpandedGroupButton = (controls, rowNode) => {
    const group = rowNode.groupControl;
    if (!group || !group.expanded) {
      return;
    }

    const targetDepth = rowNode.depth;
    const visibleAncestorDepth = Math.max(0, targetDepth - group.count - 1);
    const markerDepth = Math.min(targetDepth - 1, visibleAncestorDepth + 1);
    addOmittedButton(controls, {
      count: group.count,
      groupId: group.groupId,
      nodeX: Math.round(rowNode.treeOriginX + getNodeXInTreeZone(markerDepth)),
      anchorY: rowNode.anchorY
    }, true);
  };

  const renderTreeOverlay = (list) => {
    if (!list) {
      return;
    }

    const { svg, controls } = ensureOverlay(list);
    const graph = buildVisibleTreeGraph(list);
    const width = Math.ceil(Math.max(list.scrollWidth, list.getBoundingClientRect().width));
    const height = Math.ceil(Math.max(list.scrollHeight, list.getBoundingClientRect().height));

    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(height));
    svg.style.width = `${width}px`;
    svg.style.height = `${height}px`;
    controls.style.width = `${width}px`;
    controls.style.height = `${height}px`;
    svg.replaceChildren();
    controls.replaceChildren();

    if (graph.rows.length === 0) {
      return;
    }

    drawEdges(svg, graph.edges);
    drawLabelLinks(svg, graph.nodes);
    drawNodes(svg, graph.nodes);
    graph.omittedNodes.forEach((node) => addOmittedButton(controls, node, false));
    graph.rows.forEach((node) => addExpandedGroupButton(controls, node));

    if (graph.omittedNodes.some((node) => !list.contains(controls.querySelector(`[data-collapsed-group-id="${CSS.escape(node.groupId)}"]`)))) {
      warnOnce("[branch-tree-overlay] omitted marker was not inserted into the version list");
    }
  };

  const refreshBranchTreeOverlays = (root = document) => {
    const lists = root.querySelectorAll?.(".version-list") || [];
    lists.forEach(renderTreeOverlay);
  };

  let scheduledFrame = 0;
  const scheduleRefresh = () => {
    if (scheduledFrame && typeof window.cancelAnimationFrame === "function") {
      window.cancelAnimationFrame(scheduledFrame);
    }
    const run = () => {
      scheduledFrame = 0;
      refreshBranchTreeOverlays(document);
    };
    if (typeof window.requestAnimationFrame === "function") {
      scheduledFrame = window.requestAnimationFrame(run);
      return;
    }
    window.setTimeout(run, 0);
  };

  const shouldIgnoreMutations = (mutations) => {
    return mutations.length > 0 && mutations.every((mutation) => {
      const target = mutation.target;
      return target?.closest?.(".version-tree-overlay, .version-tree-overlay-controls");
    });
  };

  const mount = () => {
    const chartList = document.querySelector(CHART_LIST_SELECTOR);
    if (!chartList) {
      return;
    }

    chartList.dataset.treeProgressPolishMounted = "true";
    const observer = new MutationObserver((mutations) => {
      if (shouldIgnoreMutations(mutations)) {
        return;
      }
      scheduleRefresh();
    });
    observer.observe(chartList, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["hidden", "class", "data-depth", "data-branch-path", "data-intermediate-group-count"]
    });

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
    window.addEventListener("resize", scheduleRefresh);
    window.addEventListener("load", scheduleRefresh, { once: true });
    window.addEventListener("pageshow", scheduleRefresh);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        scheduleRefresh();
      }
    });
  };

  window.renderBranchTreeOverlay = renderTreeOverlay;
  window.refreshBranchTreeOverlays = refreshBranchTreeOverlays;
  window.refreshPolishedTreeConnectors = refreshBranchTreeOverlays;
  window.scheduleBranchTreeOverlayRefresh = scheduleRefresh;
  window.schedulePolishedTreeConnectors = scheduleRefresh;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount, { once: true });
  } else {
    mount();
  }
})();
