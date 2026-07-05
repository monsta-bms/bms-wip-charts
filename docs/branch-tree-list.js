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

  function getDisplayVersion(version) {
    return version?.displayVersion || version?.display_version || "ver?.?";
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

  function getParentBranchPath(version) {
    const parts = getBranchPath(version).split("/").filter(Boolean);
    return parts.length > 1 ? parts.slice(0, -1).join("/") : "";
  }

  function getNodeKey(version) {
    return getVersionId(version) || getBranchPath(version);
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

  function buildLookup(versions) {
    const byId = new Map();
    const byPath = new Map();

    for (const version of versions) {
      const versionId = getVersionId(version);
      const branchPath = getBranchPath(version);
      if (versionId) {
        byId.set(versionId, version);
      }
      byPath.set(branchPath, version);
    }

    return { byId, byPath };
  }

  function getParentVersion(version, lookup) {
    const parentId = getParentVersionId(version);
    if (parentId && lookup.byId.has(parentId)) {
      return lookup.byId.get(parentId);
    }

    const parentPath = getParentBranchPath(version);
    return parentPath && lookup.byPath.has(parentPath) ? lookup.byPath.get(parentPath) : null;
  }

  function buildTreeNodes(versions) {
    const lookup = buildLookup(versions);
    const childrenByParentKey = new Map();
    const roots = [];

    for (const version of versions) {
      const parent = getParentVersion(version, lookup);
      if (!parent) {
        roots.push(version);
        continue;
      }

      const parentKey = getNodeKey(parent);
      const children = childrenByParentKey.get(parentKey) || [];
      children.push(version);
      childrenByParentKey.set(parentKey, children);
    }

    const nodes = [];
    const visited = new Set();

    function childVersions(version) {
      return (childrenByParentKey.get(getNodeKey(version)) || []).sort(compareVersions);
    }

    function walk(version, parent, depth, isLast) {
      const versionKey = getNodeKey(version);
      if (visited.has(versionKey)) {
        return;
      }

      visited.add(versionKey);
      const children = childVersions(version);
      nodes.push({
        version,
        parent,
        depth,
        isLast,
        hasChildren: children.length > 0
      });

      children.forEach((child, index) => {
        walk(child, version, depth + 1, index === children.length - 1);
      });
    }

    roots.sort(compareVersions).forEach((root, index) => {
      walk(root, null, 0, index === roots.length - 1);
    });

    versions
      .filter((version) => !visited.has(getNodeKey(version)))
      .sort((a, b) => getBranchPath(a).localeCompare(getBranchPath(b), "en", { numeric: true }))
      .forEach((version, index, missing) => {
        const parent = getParentVersion(version, lookup);
        nodes.push({
          version,
          parent,
          depth: Math.max(0, getBranchPath(version).split("/").filter(Boolean).length - 1),
          isLast: index === missing.length - 1,
          hasChildren: false
        });
      });

    return nodes;
  }

  function isCompleted(version, progress) {
    return version?.completed === true || Number(progress) === 100;
  }

  function isRejected(version) {
    return version?.isRejected === true || version?.is_rejected === true;
  }

  function isCollapsedByCompletion(version) {
    return version?.collapsedByCompletion === true || version?.collapsed_by_completion === true;
  }

  function isDownloadBlocked(version) {
    return version?.downloadBlocked === true || version?.download_blocked === true;
  }

  function getDownloadBlockReason(version) {
    return version?.downloadBlockReason || version?.download_block_reason || "download_blocked";
  }

  function renderProgressBadges(version, progress) {
    const completedBadge = isCompleted(version, progress) ? `<span class="completed-badge">完成</span>` : "";
    const rejectedBadge = isRejected(version) ? `<span class="rejected-badge">没譜面</span>` : "";
    return `${completedBadge}${rejectedBadge}`;
  }

  function renderStateBadges(node, progress) {
    const version = node.version;
    const leafBadge = !node.hasChildren && !isRejected(version) ? `<span class="leaf-badge">末端</span>` : "";
    const rejectedBadge = isRejected(version) ? `<span class="append-locked-badge">追記不可</span>` : "";
    const collapsedBadge = isCollapsedByCompletion(version) ? `<span class="intermediate-badge">中間</span>` : "";
    const completedBadge = isCompleted(version, progress) ? `<span class="completed-badge compact">完成</span>` : "";
    return `${leafBadge}${completedBadge}${rejectedBadge}${collapsedBadge}`;
  }

  function enhanceDownloadControl(row, version) {
    const actions = row.querySelector(".version-actions");
    if (!actions) {
      return;
    }

    const existingDownload = actions.querySelector("a[href], .download-disabled");
    if (!existingDownload) {
      return;
    }

    const blocked = isDownloadBlocked(version);
    if (blocked) {
      const disabled = document.createElement("span");
      disabled.className = "download-disabled download-button download-blocked-control";
      disabled.title = getDownloadBlockReason(version);
      disabled.textContent = "DL不可";
      existingDownload.replaceWith(disabled);
      return;
    }

    existingDownload.classList.add("download-button");
    if (existingDownload.tagName.toLowerCase() === "a") {
      existingDownload.classList.add("download-available-control");
      existingDownload.setAttribute("aria-label", `${getDisplayVersion(version)} をダウンロード`);
    } else {
      existingDownload.classList.add("download-blocked-control");
      existingDownload.title = "download url is not available";
    }
  }

  function enhanceRow(row, node) {
    const version = node.version;
    const branchPath = getBranchPath(version);
    const progress = Number.isFinite(Number(version?.progress)) ? Number(version.progress) : 0;
    const completed = isCompleted(version, progress);
    const rejected = isRejected(version);
    const collapsed = isCollapsedByCompletion(version);
    const blocked = isDownloadBlocked(version);
    const tag = row.querySelector(".version-tag");
    const progressBlock = [...row.querySelectorAll(".meta-block")]
      .find((block) => block.querySelector(".progress-pill"));

    row.classList.add("version-tree-row");
    row.classList.toggle("is-completed", completed);
    row.classList.toggle("is-rejected", rejected);
    row.classList.toggle("is-leaf", !node.hasChildren);
    row.classList.toggle("is-collapsed-by-completion", collapsed);
    row.classList.toggle("is-download-blocked", blocked);
    row.dataset.depth = String(node.depth);
    row.dataset.branchPath = branchPath;
    row.style.setProperty("--tree-depth", String(node.depth));

    if (tag) {
      const connector = node.depth === 0 ? "" : node.isLast ? "└" : "├";
      const parentText = node.parent ? `from ${getDisplayVersion(node.parent)}` : "起点";
      tag.classList.add("version-tree-tag");
      tag.style.setProperty("--tree-depth", String(node.depth));
      tag.title = `branchPath: ${branchPath}`;
      tag.innerHTML = `
        <span class="tree-connector" aria-hidden="true">${html(connector)}</span>
        <span class="version-label-stack">
          <span class="version-title-line">
            <span class="version-main-label">${html(getDisplayVersion(version))}</span>
            <span class="version-state-badges">${renderStateBadges(node, progress)}</span>
          </span>
          <span class="version-parent-line" title="branchPath: ${html(branchPath)}">${html(parentText)}</span>
        </span>
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

    enhanceDownloadControl(row, version);
  }

  function createVersionListHeader() {
    const header = document.createElement("div");
    header.className = "version-list-header";
    header.setAttribute("aria-hidden", "true");
    header.innerHTML = `
      <span>ver</span>
      <span>難易度</span>
      <span>作者</span>
      <span>進捗</span>
      <span>進捗サムネイル</span>
      <span>コメント</span>
      <span>操作</span>
    `;
    return header;
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
        const key = getNodeKey(version) || String(index);
        rowsByVersion.set(key, rows[index]);
      });

      const treeNodes = buildTreeNodes(versions);
      const fragment = document.createDocumentFragment();
      treeNodes.forEach((node) => {
        const row = rowsByVersion.get(getNodeKey(node.version));
        if (!row) {
          return;
        }
        enhanceRow(row, node);
        fragment.appendChild(row);
      });

      if (fragment.childNodes.length > 0) {
        list.innerHTML = "";
        list.appendChild(createVersionListHeader());
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
