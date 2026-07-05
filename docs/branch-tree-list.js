(() => {
  const listElement = document.querySelector("#chartList");

  if (!listElement || typeof renderCharts !== "function") {
    return;
  }

  const baseRenderCharts = renderCharts;

  function html(value) {
    if (typeof escapeHtml === "function") {
      return escapeHtml(value);
    }

    return String(value ?? "").replace(/[&<>"']/g, (character) => {
      const replacements = {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      };
      return replacements[character];
    });
  }

  function getVersionId(version) {
    return version?.id || version?.versionId || "";
  }

  function getParentVersionId(version) {
    return version?.parentVersionId || version?.parent_version_id || "";
  }

  function getBranchPath(version) {
    return version?.branchPath || version?.branch_path || "root";
  }

  function getVersionNumber(version) {
    const value = Number(version?.versionNumber ?? version?.version_number);
    return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
  }

  function getCreatedAtTime(version) {
    const time = Date.parse(version?.createdAt || version?.created_at || "");
    return Number.isFinite(time) ? time : 0;
  }

  function getBranchLabel(version) {
    const explicit = version?.branchLabel || version?.branch_label;
    if (explicit) {
      return String(explicit);
    }

    const parts = getBranchPath(version).split("/").filter(Boolean);
    return parts[parts.length - 1] || "root";
  }

  function branchLabelRank(label) {
    const value = String(label || "").toLowerCase();
    if (value === "root") {
      return 0;
    }

    if (!/^[a-z]+$/.test(value)) {
      return Number.MAX_SAFE_INTEGER;
    }

    let rank = 0;
    for (const character of value) {
      rank = rank * 26 + (character.charCodeAt(0) - 96);
    }
    return rank;
  }

  function compareVersions(a, b) {
    const labelDiff = branchLabelRank(getBranchLabel(a)) - branchLabelRank(getBranchLabel(b));
    if (labelDiff !== 0) {
      return labelDiff;
    }

    const pathCompare = getBranchPath(a).localeCompare(getBranchPath(b), "en", { numeric: true });
    if (pathCompare !== 0) {
      return pathCompare;
    }

    const versionDiff = getVersionNumber(a) - getVersionNumber(b);
    if (versionDiff !== 0) {
      return versionDiff;
    }

    return getCreatedAtTime(a) - getCreatedAtTime(b);
  }

  function buildTreeNodes(versions) {
    const byId = new Map();
    const byPath = new Map();
    const childrenByParentId = new Map();
    const childrenByParentPath = new Map();
    const roots = [];

    for (const version of versions) {
      const versionId = getVersionId(version);
      const branchPath = getBranchPath(version);
      if (versionId) {
        byId.set(versionId, version);
      }
      byPath.set(branchPath, version);
    }

    for (const version of versions) {
      const versionId = getVersionId(version);
      const parentId = getParentVersionId(version);
      const branchPath = getBranchPath(version);
      const pathParts = branchPath.split("/").filter(Boolean);
      const parentPath = pathParts.length > 1 ? pathParts.slice(0, -1).join("/") : "";

      if (parentId && byId.has(parentId)) {
        const children = childrenByParentId.get(parentId) || [];
        children.push(version);
        childrenByParentId.set(parentId, children);
        continue;
      }

      if (parentPath && byPath.has(parentPath)) {
        const children = childrenByParentPath.get(parentPath) || [];
        children.push(version);
        childrenByParentPath.set(parentPath, children);
        continue;
      }

      roots.push(version);
      if (!versionId && branchPath === "root") {
        roots.push(version);
      }
    }

    const uniqueRoots = [...new Set(roots)].sort(compareVersions);
    const nodes = [];
    const visited = new Set();

    function childVersions(version) {
      const versionId = getVersionId(version);
      const branchPath = getBranchPath(version);
      const byParentId = versionId ? childrenByParentId.get(versionId) || [] : [];
      const byParentPath = childrenByParentPath.get(branchPath) || [];
      return [...new Set([...byParentId, ...byParentPath])].sort(compareVersions);
    }

    function walk(version, depth, isLast) {
      const versionId = getVersionId(version) || getBranchPath(version);
      if (visited.has(versionId)) {
        return;
      }

      visited.add(versionId);
      const children = childVersions(version);
      nodes.push({
        version,
        depth,
        isLast,
        hasChildren: children.length > 0
      });

      children.forEach((child, index) => {
        walk(child, depth + 1, index === children.length - 1);
      });
    }

    uniqueRoots.forEach((root, index) => {
      walk(root, 0, index === uniqueRoots.length - 1);
    });

    const missing = versions
      .filter((version) => !visited.has(getVersionId(version) || getBranchPath(version)))
      .sort((a, b) => getBranchPath(a).localeCompare(getBranchPath(b), "en", { numeric: true }));

    missing.forEach((version, index) => {
      nodes.push({ version, depth: getBranchPath(version).split("/").filter(Boolean).length - 1, isLast: index === missing.length - 1, hasChildren: false });
    });

    return nodes;
  }

  function renderProgressBadges(version, progress) {
    const completed = version?.completed === true || Number(progress) === 100;
    const rejectedBadge = version?.isRejected ? `<span class="rejected-badge">没譜面</span>` : "";
    const completedBadge = completed ? `<span class="completed-badge">完成</span>` : "";
    return `${completedBadge}${rejectedBadge}`;
  }

  function replaceDownloadControl(row, version) {
    const actions = row.querySelector(".version-actions");
    if (!actions) {
      return;
    }

    const existingDownload = actions.querySelector("a[href], .download-disabled");
    if (!existingDownload) {
      return;
    }

    const blocked = version?.downloadBlocked === true || version?.download_blocked === true;
    if (!blocked) {
      return;
    }

    const reason = version?.downloadBlockReason || version?.download_block_reason || "download_blocked";
    const disabled = document.createElement("span");
    disabled.className = "download-disabled download-blocked-control";
    disabled.title = reason;
    disabled.textContent = "DL不可";
    existingDownload.replaceWith(disabled);
  }

  function enhanceRow(row, node) {
    const version = node.version;
    const branchPath = getBranchPath(version);
    const progress = Number.isFinite(Number(version?.progress)) ? Number(version.progress) : 0;
    const completed = version?.completed === true || progress === 100;
    const collapsed = version?.collapsedByCompletion === true || version?.collapsed_by_completion === true;
    const blocked = version?.downloadBlocked === true || version?.download_blocked === true;
    const tag = row.querySelector(".version-tag");
    const progressBlock = [...row.querySelectorAll(".meta-block")]
      .find((block) => block.querySelector(".progress-pill"));

    row.classList.add("version-tree-row");
    row.classList.toggle("is-completed", completed);
    row.classList.toggle("is-collapsed-by-completion", collapsed);
    row.classList.toggle("is-download-blocked", blocked);
    row.dataset.depth = String(node.depth);
    row.style.setProperty("--tree-depth", String(node.depth));

    if (tag) {
      const connector = node.depth === 0 ? "root" : node.isLast ? "└" : "├";
      tag.classList.add("version-tree-tag");
      tag.style.setProperty("--tree-depth", String(node.depth));
      tag.innerHTML = `
        <span class="tree-connector" aria-hidden="true">${html(connector)}</span>
        <span class="version-main-label">${html(version?.displayVersion || "ver?.?")}</span>
        <span class="branch-path-badge">${html(branchPath)}</span>
      `;
    }

    if (progressBlock) {
      const progressPill = progressBlock.querySelector(".progress-pill");
      if (progressPill) {
        progressPill.classList.toggle("is-completed", completed);
      }

      const oldBadges = progressBlock.querySelectorAll(".completed-badge, .rejected-badge");
      oldBadges.forEach((badge) => badge.remove());
      progressBlock.insertAdjacentHTML("beforeend", renderProgressBadges(version, progress));
    }

    replaceDownloadControl(row, version);
  }

  function enhanceTreeDisplay(data) {
    const charts = Array.isArray(data?.charts) ? data.charts : [];
    const chartGroups = Array.from(listElement.querySelectorAll(".chart-group"));

    charts.forEach((entry, chartIndex) => {
      const group = chartGroups[chartIndex];
      if (!group) {
        return;
      }

      const list = group.querySelector(".version-list");
      const versions = Array.isArray(entry.versions) ? entry.versions : [];
      const rows = Array.from(list?.querySelectorAll(":scope > .version-row") || []);
      if (!list || versions.length === 0 || rows.length === 0) {
        return;
      }

      const rowsByVersion = new Map();
      versions.forEach((version, index) => {
        const key = getVersionId(version) || getBranchPath(version) || String(index);
        rowsByVersion.set(key, rows[index]);
      });

      const treeNodes = buildTreeNodes(versions);
      const fragment = document.createDocumentFragment();
      treeNodes.forEach((node) => {
        const key = getVersionId(node.version) || getBranchPath(node.version);
        const row = rowsByVersion.get(key);
        if (!row) {
          return;
        }
        enhanceRow(row, node);
        fragment.appendChild(row);
      });

      if (fragment.childNodes.length > 0) {
        list.innerHTML = "";
        list.appendChild(fragment);
      }
    });
  }

  function renderChartsAsTree(data) {
    baseRenderCharts(data);
    enhanceTreeDisplay(data);
  }

  try {
    renderCharts = renderChartsAsTree;
  } catch (error) {
    window.renderCharts = renderChartsAsTree;
  }

  if (typeof loadCharts === "function") {
    loadCharts();
  }
})();
