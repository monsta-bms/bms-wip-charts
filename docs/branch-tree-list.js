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

  function getCreatedAtTime(version) {
    const time = Date.parse(version?.createdAt || version?.created_at || "");
    return Number.isFinite(time) ? time : 0;
  }

  function getParentBranchPath(version) {
    const parts = getBranchPath(version).split("/").filter(Boolean);
    return parts.length > 1 ? parts.slice(0, -1).join("/") : "";
  }

  function getNodeKey(version) {
    return getVersionId(version) || getBranchPath(version);
  }

  function branchSegmentToNumber(segment) {
    const value = String(segment || "").trim().toLowerCase();
    if (!/^[a-z]+$/.test(value)) {
      return value || "0";
    }

    let number = 0;
    for (const character of value) {
      number = number * 26 + (character.charCodeAt(0) - 96);
    }
    return String(number);
  }

  function buildVersionPathLabel(branchPath) {
    const parts = String(branchPath || "root").split("/").filter(Boolean);
    const pathParts = parts[0] === "root" ? parts.slice(1) : parts;
    if (pathParts.length === 0) {
      return "BASE";
    }

    return pathParts.map(branchSegmentToNumber).join("-");
  }

  function buildFromLabel(parentVersion) {
    if (!parentVersion) {
      return "起点";
    }

    return `from ${buildVersionPathLabel(getBranchPath(parentVersion))}`;
  }

  function compareSiblingVersions(a, b) {
    const createdAtDiff = getCreatedAtTime(a) - getCreatedAtTime(b);
    if (createdAtDiff !== 0) {
      return createdAtDiff;
    }

    const pathCompare = getBranchPath(a).localeCompare(getBranchPath(b), "en", { numeric: true });
    if (pathCompare !== 0) {
      return pathCompare;
    }

    return String(getVersionId(a)).localeCompare(String(getVersionId(b)), "en", { numeric: true });
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
      return (childrenByParentKey.get(getNodeKey(version)) || []).sort(compareSiblingVersions);
    }

    function siblingCountFor(version) {
      const parent = getParentVersion(version, lookup);
      if (!parent) {
        return roots.length;
      }

      return (childrenByParentKey.get(getNodeKey(parent)) || []).length;
    }

    function walk(version, parent, depth, isLast, siblingCount, parentSiblingCount, siblingIndex) {
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
        siblingCount,
        parentSiblingCount,
        siblingIndex,
        hasChildren: children.length > 0
      });

      children.forEach((child, index) => {
        walk(child, version, depth + 1, index === children.length - 1, children.length, siblingCount, index);
      });
    }

    roots.sort(compareSiblingVersions).forEach((root, index) => {
      walk(root, null, 0, index === roots.length - 1, roots.length, 0, index);
    });

    versions
      .filter((version) => !visited.has(getNodeKey(version)))
      .sort(compareSiblingVersions)
      .forEach((version, index, missing) => {
        const parent = getParentVersion(version, lookup);
        nodes.push({
          version,
          parent,
          depth: Math.max(0, getBranchPath(version).split("/").filter(Boolean).length - 1),
          isLast: index === missing.length - 1,
          siblingCount: siblingCountFor(version),
          parentSiblingCount: parent ? siblingCountFor(parent) : 0,
          siblingIndex: index,
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

  function isDeleteRequested(version) {
    return version?.deleteRequested === true || version?.delete_requested === true;
  }

  function isHiddenVersion(version) {
    return version?.hidden === true || version?.isHidden === true || version?.is_hidden === true;
  }

  function getDownloadBlockReason(version) {
    return version?.downloadBlockReason || version?.download_block_reason || "download_blocked";
  }

  function renderProgressBadges() {
    return "";
  }

  function renderStateBadges(node, progress) {
    const version = node.version;
    const badges = [];

    if (isRejected(version)) {
      badges.push(`<span class="rejected-badge compact">没譜面</span>`);
    } else if (isCompleted(version, progress)) {
      badges.push(`<span class="completed-badge compact">完成</span>`);
    }

    if (isDownloadBlocked(version)) {
      badges.push(`<span class="download-blocked-badge">DL不可</span>`);
    } else if (isDeleteRequested(version)) {
      badges.push(`<span class="delete-requested-badge">削除申請中</span>`);
    } else if (isHiddenVersion(version)) {
      badges.push(`<span class="hidden-badge">非表示</span>`);
    }

    return badges.slice(0, 2).join("");
  }

  function enhanceDownloadControl(row, version, displayVersionLabel) {
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
      existingDownload.setAttribute("aria-label", `${displayVersionLabel} をダウンロード`);
    } else {
      existingDownload.classList.add("download-blocked-control");
      existingDownload.title = "download url is not available";
    }
  }

  function applyColumnClasses(row, version) {
    const tag = row.querySelector(":scope > .version-tag");
    const actions = row.querySelector(":scope > .version-actions");
    const metaBlocks = Array.from(row.querySelectorAll(":scope > .meta-block"));
    const [difficultyCell, authorCell, progressCell, thumbnailCell, commentCell] = metaBlocks;

    tag?.classList.add("version-tree-cell");
    difficultyCell?.classList.add("difficulty-cell");
    authorCell?.classList.add("author-cell");
    progressCell?.classList.add("progress-cell");
    thumbnailCell?.classList.add("thumbnail-cell");
    commentCell?.classList.add("comment-cell");
    actions?.classList.add("actions-cell");

    const authorValue = authorCell?.querySelector(".meta-value");
    if (authorValue) {
      const author = String(version?.author || "未入力");
      authorValue.textContent = author;
      authorValue.title = author;
    }

    const commentValue = commentCell?.querySelector(".meta-value");
    if (commentValue) {
      const comment = String(version?.comment || "");
      commentValue.textContent = comment;
      commentValue.title = comment;
    }
  }

  function enhanceRow(row, node) {
    const version = node.version;
    const branchPath = getBranchPath(version);
    const displayVersionLabel = buildVersionPathLabel(branchPath);
    const parentText = buildFromLabel(node.parent);
    const progress = Number.isFinite(Number(version?.progress)) ? Number(version.progress) : 0;
    const completed = isCompleted(version, progress);
    const rejected = isRejected(version);
    const collapsed = isCollapsedByCompletion(version);
    const blocked = isDownloadBlocked(version);
    const deleteRequested = isDeleteRequested(version);
    const hidden = isHiddenVersion(version);
    const tag = row.querySelector(".version-tag");
    const progressBlock = [...row.querySelectorAll(".meta-block")]
      .find((block) => block.querySelector(".progress-pill"));

    applyColumnClasses(row, version);

    row.classList.add("version-tree-row");
    row.classList.toggle("is-completed", completed);
    row.classList.toggle("is-rejected", rejected);
    row.classList.toggle("is-leaf", !node.hasChildren);
    row.classList.toggle("is-collapsed-by-completion", collapsed);
    row.classList.toggle("is-download-blocked", blocked);
    row.classList.toggle("is-delete-requested", deleteRequested);
    row.classList.toggle("is-hidden-version", hidden);
    row.dataset.depth = String(node.depth);
    row.dataset.branchPath = branchPath;
    row.style.setProperty("--tree-depth", String(node.depth));

    if (tag) {
      const leafText = node.hasChildren ? "" : " / 末端";
      const titleText = `displayVersion: ${getDisplayVersion(version)} / branchPath: ${branchPath}${leafText}`;
      tag.classList.add("version-tree-tag");
      tag.style.setProperty("--tree-depth", String(node.depth));
      tag.title = titleText;
      tag.innerHTML = `
        <span class="tree-connector" aria-hidden="true"></span>
        <span class="version-label-stack">
          <span class="version-title-line">
            <span class="version-main-label">${html(displayVersionLabel)}</span>
            <span class="version-state-badges">${renderStateBadges(node, progress)}</span>
          </span>
          <span class="version-parent-line" title="${html(titleText)}">${html(parentText)}</span>
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
      progressBlock.insertAdjacentHTML("beforeend", renderProgressBadges(version));
    }

    enhanceDownloadControl(row, version, displayVersionLabel);
  }

  function createVersionListHeader() {
    const header = document.createElement("div");
    header.className = "version-list-header";
    header.setAttribute("aria-hidden", "true");
    header.innerHTML = `
      <span>版</span>
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
