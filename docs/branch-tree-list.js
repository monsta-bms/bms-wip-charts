(() => {
  const listElement = document.querySelector("#chartList");
  const interactionRoot = document.querySelector("#list") || listElement;
  const completedCollapseReason = "superseded_by_completed_descendant";
  const expandedIntermediateGroups = new Set();
  let latestCharts = [];

  if (!listElement || typeof renderCharts !== "function") {
    return;
  }

  const baseRenderCharts = renderCharts;

  function makeVersionUiModel(version, options = {}) {
    return typeof buildSharedVersionUiModel === "function"
      ? buildSharedVersionUiModel(version, options)
      : null;
  }

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

  function cleanVersionComment(value) {
    return String(value ?? "");
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

  function getVersionChartName(version, entry = {}) {
    const chart = entry?.chart || {};
    return String(
      version?.chartName
      || version?.chart_name
      || chart.name
      || chart.chartName
      || chart.chart_name
      || "差分名未入力"
    ).trim();
  }

  function getMiniViewInfo(version) {
    const miniView = version?.miniView;
    if (!miniView || miniView.available !== true || miniView.mode !== "7key-sp" || !miniView.url) {
      return null;
    }
    return miniView;
  }

  function parseApiDate(value) {
    const source = String(value || "").trim();
    if (!source) {
      return null;
    }

    const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(source)
      ? `${source.replace(" ", "T")}Z`
      : source;
    const date = new Date(normalized);
    return Number.isFinite(date.getTime()) ? date : null;
  }

  function getCreatedAtTime(version) {
    return parseApiDate(version?.createdAt || version?.created_at)?.getTime() || 0;
  }

  function isWithin24Hours(version) {
    if (typeof version?.within24Hours === "boolean") {
      return version.within24Hours;
    }

    const createdAt = getCreatedAtTime(version);
    return createdAt > 0 && Date.now() - createdAt < 24 * 60 * 60 * 1000;
  }

  function hasChildVersions(version) {
    return version?.hasChildVersions === true || version?.hasDescendants === true;
  }

  function formatPostedAt(version) {
    const date = parseApiDate(version?.createdAt || version?.created_at);
    if (!date) {
      return "投稿日時不明";
    }

    return `投稿 ${new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(date)}`;
  }

  function renderLifecycleMeta(version, uiModel, options = {}) {
    const postedAt = formatPostedAt(version);
    const createdAt = String(version?.createdAt || version?.created_at || "");
    const recentBadge = options.isLatest && createdAt
      ? `<span class="recent-activity-badge" data-created-at="${html(createdAt)}" hidden></span>`
      : "";
    const lifecycleStatus = getLifecycleStatus(version, uiModel);
    if (lifecycleStatus === "withdrawal_pending") {
      const handlingMode = getLifecycleHandlingMode(version, uiModel);
      if (handlingMode === "immediate_delete") {
        return `
          <span class="version-posted-at">${html(postedAt)}</span>
          <span class="version-withdrawal-detail">削除処理待ち / 取消不可</span>
          ${recentBadge}
        `;
      }
      if (handlingMode === "manual_review") {
        return `
          <span class="version-posted-at">${html(postedAt)}</span>
          <span class="version-withdrawal-detail">DL停止・管理者確認待ち</span>
          <span class="version-withdrawal-help">申請理由と派生版の状態を管理者が確認します。</span>
          ${recentBadge}
        `;
      }
      const scheduledAt = parseApiDate(getLifecycleScheduledAt(version));
      return `
        <span class="version-posted-at">${html(postedAt)}</span>
        <span class="version-withdrawal-detail">DL停止・自動削除待ち</span>
        <span class="version-withdrawal-help">${html(formatPostedAt({ createdAt: scheduledAt?.toISOString() || "" }).replace(/^投稿/, ""))}以降、追記や参照がなければ自動削除します。</span>
        ${recentBadge}
      `;
    }
    if (lifecycleStatus === "processing") {
      return `<span class="version-posted-at">${html(postedAt)}</span><span class="version-withdrawal-detail">取り下げ処理中</span>${recentBadge}`;
    }
    if (lifecycleStatus === "tombstoned") {
      return `<span class="version-posted-at">${html(postedAt)}</span><span class="version-withdrawal-detail">派生版を維持するため、版ツリー上の履歴だけ残っています。</span>${recentBadge}`;
    }
    if (!isWithin24Hours(version)) {
      return `<span class="version-posted-at">${html(postedAt)}</span>${recentBadge}`;
    }

    const tooltip = hasChildVersions(version)
      ? "24時間以内ですが、派生版があるため管理操作では即時非表示になりません"
      : "管理操作により一覧から非表示になる可能性があります";
    return `
      <span class="version-posted-at">${html(postedAt)}</span>
      <span class="within-24h-badge" title="${html(tooltip)}">24h以内</span>
      ${recentBadge}
    `;
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

  window.BmsVersionLabels = {
    branchSegmentToNumber,
    buildVersionPathLabel,
    buildFromLabel,
    getBranchPath,
    getDisplayVersion
  };

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

  function buildChildrenByNodeKey(treeNodes) {
    const childrenByKey = new Map();
    for (const node of treeNodes) {
      if (!node.parent) {
        continue;
      }

      const parentKey = getNodeKey(node.parent);
      const children = childrenByKey.get(parentKey) || [];
      children.push(node);
      childrenByKey.set(parentKey, children);
    }
    return childrenByKey;
  }

  function getBranchSegments(branchPath) {
    const parts = String(branchPath || "root").split("/").filter(Boolean);
    return parts[0] === "root" ? parts.slice(1) : parts;
  }

  function getBranchDepth(branchPath) {
    return getBranchSegments(branchPath).length;
  }

  function getBranchPathAtDepth(branchPath, depth) {
    if (depth <= 0) {
      return "root";
    }

    const segments = getBranchSegments(branchPath).slice(0, depth);
    return ["root", ...segments].join("/");
  }

  function isDescendantBranchPath(branchPath, ancestorPath) {
    const normalizedPath = getBranchPathAtDepth(branchPath, getBranchDepth(branchPath));
    const normalizedAncestor = getBranchPathAtDepth(ancestorPath, getBranchDepth(ancestorPath));
    if (normalizedAncestor === "root") {
      return normalizedPath !== "root" && normalizedPath.startsWith("root/");
    }

    return normalizedPath.startsWith(`${normalizedAncestor}/`);
  }

  function hasLaterSiblingAtDepth(visibleRows, rowIndex, branchPath, depth) {
    if (depth <= 0) {
      return false;
    }

    const parentPath = getBranchPathAtDepth(branchPath, depth - 1);
    const currentPath = getBranchPathAtDepth(branchPath, depth);
    return visibleRows.slice(rowIndex + 1).some((rowInfo) => {
      if (rowInfo.depth < depth) {
        return false;
      }

      return getBranchPathAtDepth(rowInfo.branchPath, depth - 1) === parentPath &&
        getBranchPathAtDepth(rowInfo.branchPath, depth) !== currentPath;
    });
  }

  function hasLaterDescendant(visibleRows, rowIndex, branchPath) {
    return visibleRows.slice(rowIndex + 1).some((rowInfo) => isDescendantBranchPath(rowInfo.branchPath, branchPath));
  }

  function renderTreeConnector(depth) {
    if (depth <= 0) {
      return `<span class="tree-connector tree-connector-root" aria-hidden="true"><span class="tree-root-mark"></span></span>`;
    }

    const slots = Array.from({ length: depth }, (_, index) => `
      <span class="tree-connector-slot" data-tree-level="${index + 1}"></span>
    `).join("");
    return `<span class="tree-connector tree-connector-grid" style="--connector-depth: ${depth};" aria-hidden="true">${slots}</span>`;
  }

  function applyVisibleTreeConnectors(list) {
    if (!list) {
      return;
    }

    const visibleRows = Array.from(list.querySelectorAll(":scope > .version-row.version-tree-row"))
      .filter((row) => !row.hidden && !row.hasAttribute("hidden"))
      .map((row) => {
        const branchPath = row.dataset.branchPath || "root";
        const depth = Number.isFinite(Number(row.dataset.depth))
          ? Number(row.dataset.depth)
          : getBranchDepth(branchPath);
        return { row, branchPath, depth };
      });

    visibleRows.forEach((rowInfo, rowIndex) => {
      const connector = rowInfo.row.querySelector(".tree-connector");
      if (!connector) {
        return;
      }

      const currentContinues = hasLaterDescendant(visibleRows, rowIndex, rowInfo.branchPath) ||
        hasLaterSiblingAtDepth(visibleRows, rowIndex, rowInfo.branchPath, rowInfo.depth);
      connector.classList.toggle("continues-below", currentContinues);

      const slots = Array.from(connector.querySelectorAll(".tree-connector-slot"));
      slots.forEach((slot, index) => {
        const level = index + 1;
        const isCurrent = level === rowInfo.depth;
        slot.classList.toggle("is-current-branch", isCurrent);
        slot.classList.toggle("has-ancestor-line", !isCurrent && hasLaterSiblingAtDepth(visibleRows, rowIndex, rowInfo.branchPath, level));
        slot.classList.toggle("continues-below", isCurrent && currentContinues);
        slot.classList.toggle("is-terminal", isCurrent && !currentContinues);
      });
    });
  }

  function isCompleted(version, progress) {
    if (isRejected(version)) return false;
    if (typeof version?.completed === "boolean") return version.completed;
    return Boolean(version?.completedAt || version?.completed_at);
  }

  function isRejected(version) {
    return version?.isRejected === true || version?.is_rejected === true;
  }

  function resolveAllowAppend(version, uiModel = null) {
    const model = uiModel || makeVersionUiModel(version, { hasProgressMap: true });
    return model?.append.allowedByPolicy === true;
  }

  function isCollapsedByCompletion(version) {
    return version?.collapsedByCompletion === true || version?.collapsed_by_completion === true;
  }

  function getCollapsedByVersionId(version) {
    return version?.collapsedByVersionId || version?.collapsed_by_version_id || "";
  }

  function getCollapsedReason(version) {
    return version?.collapsedReason || version?.collapsed_reason || "";
  }

  function isDownloadBlocked(version, uiModel = null) {
    const model = uiModel || makeVersionUiModel(version, { hasProgressMap: true });
    return model?.download.available !== true;
  }

  function getLifecycleStatus(version, uiModel = null) {
    if (uiModel?.lifecycle.state) {
      return uiModel.lifecycle.state;
    }
    const rawStatus = version?.lifecycleStatus ?? version?.lifecycle_status;
    return window.BmsVersionUiModel?.normalizeLifecycleState?.(rawStatus) || "unknown";
  }

  function getLifecycleRequestMode(version) {
    return String(version?.requestMode || version?.request_mode || "");
  }

  function getLifecycleHandlingMode(version, uiModel = null) {
    if (uiModel?.lifecycle.handlingMode) {
      return uiModel.lifecycle.handlingMode;
    }
    return "";
  }

  function getLifecycleScheduledAt(version) {
    return version?.scheduledAt || version?.scheduled_at || "";
  }

  function isDeleteRequested(version) {
    return version?.deleteRequested === true || version?.delete_requested === true;
  }

  function isWithdrawn(version) {
    return version?.withdrawn === true || Boolean(version?.withdrawnAt || version?.withdrawn_at);
  }

  function isHiddenVersion(version) {
    return version?.hidden === true || version?.isHidden === true || version?.is_hidden === true;
  }

  function getDownloadBlockReason(version) {
    return version?.downloadBlockReason || version?.download_block_reason || "download blocked";
  }

  function getProgress(version) {
    const progress = Number(version?.progress);
    return Number.isFinite(progress) ? progress : 0;
  }

  function isSupersededIntermediateNode(node) {
    const version = node.version;
    return getDownloadBlockReason(version) === completedCollapseReason &&
      getProgress(version) < 100 &&
      Boolean(isCollapsedByCompletion(version) || getCollapsedReason(version) === completedCollapseReason) &&
      !isHiddenVersion(version);
  }

  function inferCompletedDescendantId(node, treeNodes) {
    const branchPath = getBranchPath(node.version);
    const descendantPrefix = branchPath === "root" ? "root/" : `${branchPath}/`;
    const candidates = treeNodes
      .filter((candidate) => {
        const candidatePath = getBranchPath(candidate.version);
        return candidatePath.startsWith(descendantPrefix) &&
          isCompleted(candidate.version, getProgress(candidate.version)) &&
          !isHiddenVersion(candidate.version) &&
          getVersionId(candidate.version);
      })
      .sort((a, b) => {
        const depthDiff = a.depth - b.depth;
        if (depthDiff !== 0) {
          return depthDiff;
        }
        return getCreatedAtTime(a.version) - getCreatedAtTime(b.version);
      });

    return candidates[0] ? getVersionId(candidates[0].version) : "";
  }

  function getCollapseGroupId(node, treeNodes) {
    return getCollapsedByVersionId(node.version) || inferCompletedDescendantId(node, treeNodes);
  }

  function hasVisibleNonGroupChild(node, groupId, childrenByNodeKey, treeNodes) {
    const children = childrenByNodeKey.get(getNodeKey(node.version)) || [];
    return children.some((child) => {
      const childVersion = child.version;
      if (getVersionId(childVersion) === groupId) {
        return false;
      }

      if (isSupersededIntermediateNode(child) && getCollapseGroupId(child, treeNodes) === groupId) {
        return false;
      }

      return !isHiddenVersion(childVersion);
    });
  }

  function shouldCollapseIntermediateNode(node, childrenByNodeKey, completionIds, treeNodes) {
    if (node.depth === 0 || !isSupersededIntermediateNode(node)) {
      return false;
    }

    const groupId = getCollapseGroupId(node, treeNodes);
    if (!groupId || !completionIds.has(groupId)) {
      return false;
    }

    return !hasVisibleNonGroupChild(node, groupId, childrenByNodeKey, treeNodes);
  }

  function buildIntermediateGroups(treeNodes, childrenByNodeKey) {
    const completionIds = new Set(treeNodes.map((node) => getVersionId(node.version)).filter(Boolean));
    const groups = new Map();

    for (const node of treeNodes) {
      if (!shouldCollapseIntermediateNode(node, childrenByNodeKey, completionIds, treeNodes)) {
        continue;
      }

      const groupId = getCollapseGroupId(node, treeNodes);
      const nodes = groups.get(groupId) || [];
      nodes.push(node);
      groups.set(groupId, nodes);
    }

    return groups;
  }

  function renderProgressBadges() {
    return "";
  }

  function renderStateBadges(node, progress, uiModel) {
    const version = node.version;
    const badges = [];
    const lifecycleStatus = getLifecycleStatus(version, uiModel);

    if (lifecycleStatus === "withdrawal_pending") {
      const handlingMode = getLifecycleHandlingMode(version, uiModel);
      const label = handlingMode === "grace_auto_delete"
        ? "DL停止・自動削除待ち"
        : handlingMode === "manual_review"
          ? "DL停止・管理者確認待ち"
          : "取り下げ申請中";
      badges.push(`<span class="withdrawal-pending-badge">${label}</span>`);
    } else if (lifecycleStatus === "processing") {
      badges.push(`<span class="withdrawal-processing-badge">取り下げ処理中</span>`);
    } else if (lifecycleStatus === "tombstoned") {
      badges.push(`<span class="withdrawal-tombstone-badge">履歴のみ</span>`);
    }

    if (lifecycleStatus === "legacy_withdrawn" || isWithdrawn(version)) {
      badges.push(`<span class="withdrawn-badge">取り下げ済み</span>`);
    } else {
      if (isRejected(version)) {
        badges.push(`<span class="rejected-badge compact">没譜面</span>`);
      } else if (isCompleted(version, progress)) {
        badges.push(`<span class="completed-badge compact">完成</span>`);
      }

      if (lifecycleStatus === "legacy_delete_pending" || isDeleteRequested(version)) {
        badges.push(`<span class="delete-requested-badge">削除申請中</span>`);
      } else if (isHiddenVersion(version)) {
        badges.push(`<span class="hidden-badge">非表示</span>`);
      }
    }

    return badges.slice(0, 2).join("");
  }

  function renderAppendPolicyInfo(version, uiModel) {
    if (!uiModel || resolveAllowAppend(version, uiModel)) {
      return "";
    }

    const descriptionId = `append-policy-description-${html(getVersionId(version))}`;
    return `
      <span class="version-append-policy-line" id="${descriptionId}">
        <span class="append-policy-state-badge">追記受付停止</span>
        <span class="visually-hidden">この版からの新しい追記は停止されています。</span>
      </span>
    `;
  }

  function enhanceDownloadControl(row, version, uiModel, displayVersionLabel, forceBlocked = false) {
    const actions = row.querySelector(".version-actions");
    if (!actions) {
      return;
    }

    const existingDownload = actions.querySelector(".version-download-control");
    if (!existingDownload) {
      return;
    }

    const blocked = forceBlocked || isDownloadBlocked(version, uiModel);
    if (blocked) {
      const disabled = document.createElement("span");
      disabled.className = "version-download-control download-disabled download-button download-blocked-control";
      disabled.title = "この版はダウンロードできません";
      disabled.setAttribute("aria-label", `${displayVersionLabel} はダウンロードできません`);
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
      existingDownload.title = "この版はダウンロードできません";
      existingDownload.setAttribute("aria-label", `${displayVersionLabel} はダウンロードできません`);
    }
  }

  function enhanceOriginControl(row, displayVersionLabel) {
    const originLink = row.querySelector(".version-actions .version-origin-link");
    if (!originLink) {
      return;
    }

    originLink.title = "原曲・本体の配布ページを開く";
    originLink.setAttribute("aria-label", `${displayVersionLabel} の原曲・本体の配布ページを開く（外部サイト）`);
  }

  function lockAppendControl(row, title = "完成版に置き換え済みの中間履歴のため追記できません") {
    const actions = row.querySelector(".version-actions");
    if (!actions) {
      return;
    }

    const appendControl = actions.querySelector(".append-policy-control")
      || actions.querySelector(".append-version-button, button.secondary:not(.intermediate-toggle-button)");
    if (!appendControl) {
      return;
    }

    const locked = document.createElement("button");
    locked.className = "secondary append-disabled-intermediate";
    locked.type = "button";
    locked.disabled = true;
    locked.title = title;
    locked.textContent = "追記不可";
    appendControl.replaceWith(locked);
  }

  function ensureManagementControl(row, version, uiModel, chartId, displayVersionLabel) {
    const actions = row.querySelector(".version-actions");
    if (!actions || uiModel?.management.visible !== true || actions.querySelector(".version-management-button")) {
      return;
    }

    const button = document.createElement("button");
    button.className = "secondary version-management-button";
    button.type = "button";
    button.textContent = "…";
    button.title = `${displayVersionLabel} の投稿管理`;
    button.setAttribute("aria-label", `${displayVersionLabel} の投稿管理`);
    button.dataset.versionId = getVersionId(version);
    button.dataset.chartId = chartId || "";
    button.dataset.versionLabel = displayVersionLabel;
    button.dataset.author = String(version?.author || "未入力");
    button.dataset.withdrawn = isWithdrawn(version) ? "true" : "false";
    button.dataset.deleteRequested = isDeleteRequested(version) ? "true" : "false";
    button.dataset.allowAppend = uiModel.append.allowedByPolicy ? "true" : "false";
    button.dataset.appendAvailable = uiModel.append.available ? "true" : "false";
    button.dataset.downloadAvailable = uiModel.download.available ? "true" : "false";
    button.dataset.lifecycleStatus = getLifecycleStatus(version, uiModel);
    button.dataset.requestMode = getLifecycleRequestMode(version);
    button.dataset.handlingMode = getLifecycleHandlingMode(version, uiModel);
    button.dataset.scheduledAt = String(getLifecycleScheduledAt(version));
    button.dataset.canCancelWithdrawal = version?.canCancelWithdrawal === true ? "true" : "false";
    button.dataset.createdAt = String(version?.createdAt || version?.created_at || "");
    button.dataset.within24Hours = isWithin24Hours(version) ? "true" : "false";
    button.dataset.hasDescendants = hasChildVersions(version) ? "true" : "false";
    actions.appendChild(button);
  }

  function ensureGroupGutter(row) {
    let gutter = row.querySelector(":scope > .group-gutter-cell");
    if (!gutter) {
      gutter = document.createElement("div");
      gutter.className = "group-gutter-cell";
      row.insertBefore(gutter, row.firstElementChild);
    }
    return gutter;
  }

  function clearGroupGutterControl(row) {
    const gutter = ensureGroupGutter(row);
    gutter.innerHTML = "";
    gutter.classList.remove("has-toggle");
    row.classList.remove("has-intermediate-group-control", "is-group-expanded");
    delete row.dataset.intermediateGroupCount;
  }

  function setGroupGutterControl(row, groupId, count, expanded) {
    const gutter = ensureGroupGutter(row);
    const actionText = expanded ? "隠す" : "表示";
    const label = `中間履歴 ${count}件を${actionText}`;
    row.classList.add("has-intermediate-group-control");
    row.classList.toggle("is-group-expanded", expanded);
    row.dataset.intermediateGroupCount = String(count);
    gutter.classList.add("has-toggle");
    gutter.innerHTML = `
      <button class="intermediate-toggle-button group-toggle-button" type="button" data-collapsed-group-id="${html(groupId)}" data-count="${count}" aria-expanded="${expanded ? "true" : "false"}" aria-label="${html(label)}" title="${html(label)}">
        ${expanded ? `−${count}` : `+${count}`}
      </button>
    `;
  }

  function applyColumnClasses(row, version) {
    ensureGroupGutter(row);
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
      const comment = cleanVersionComment(version?.comment ?? "");
      commentValue.textContent = comment;
      commentValue.title = comment;
    }
  }

  function enhanceRow(row, node, options = {}) {
    const version = node.version;
    const branchPath = getBranchPath(version);
    const displayVersionLabel = buildVersionPathLabel(branchPath);
    const versionChartName = getVersionChartName(version, options.entry);
    const parentText = buildFromLabel(node.parent);
    const progress = getProgress(version);
    const completed = isCompleted(version, progress);
    const rejected = isRejected(version);
    const collapsed = isCollapsedByCompletion(version);
    const deleteRequested = isDeleteRequested(version);
    const withdrawn = isWithdrawn(version);
    const hidden = isHiddenVersion(version);
    const supersededIntermediate = isSupersededIntermediateNode(node);
    const uiModel = makeVersionUiModel(version, {
      hasProgressMap: true,
      isSupersededIntermediate: supersededIntermediate
    });
    const lifecycleStatus = getLifecycleStatus(version, uiModel);
    const publicDataRedacted = lifecycleStatus === "processing" || lifecycleStatus === "tombstoned";
    const blocked = isDownloadBlocked(version, uiModel);
    const tag = row.querySelector(".version-tag");
    const actions = row.querySelector(":scope > .version-actions");
    const progressBlock = [...row.querySelectorAll(".meta-block")]
      .find((block) => block.querySelector(".progress-pill"));

    applyColumnClasses(row, version);
    clearGroupGutterControl(row);

    row.classList.add("version-tree-row");
    row.classList.toggle("is-completed", completed);
    row.classList.toggle("is-rejected", rejected);
    row.classList.toggle("is-leaf", !node.hasChildren);
    row.classList.toggle("is-collapsed-by-completion", collapsed);
    row.classList.toggle("is-download-blocked", blocked || supersededIntermediate);
    row.classList.toggle("is-delete-requested", deleteRequested);
    row.classList.toggle("is-withdrawn", withdrawn);
    row.classList.toggle("is-hidden-version", hidden);
    row.classList.toggle("is-withdrawal-pending", lifecycleStatus === "withdrawal_pending");
    row.classList.toggle("is-withdrawal-processing", lifecycleStatus === "processing");
    row.classList.toggle("is-withdrawal-tombstone", lifecycleStatus === "tombstoned");
    row.classList.toggle("is-intermediate-history", supersededIntermediate);
    row.dataset.versionId = getVersionId(version);
    row.dataset.parentVersionId = getParentVersionId(version);
    row.dataset.chartId = getChartId(options.entry);
    row.dataset.depth = String(node.depth);
    row.dataset.branchPath = branchPath;
    row.dataset.parentBranchPath = node.parent ? getBranchPath(node.parent) : "";
    row.style.setProperty("--tree-depth", String(node.depth));
    const miniView = getMiniViewInfo(version);
    if (miniView) {
      row.dataset.miniviewAvailable = "true";
      row.dataset.miniviewMode = miniView.mode;
      row.dataset.miniviewUrl = miniView.url;
    } else {
      delete row.dataset.miniviewAvailable;
      delete row.dataset.miniviewMode;
      delete row.dataset.miniviewUrl;
    }

    if (options.collapsedGroupId) {
      row.dataset.collapsedGroupId = options.collapsedGroupId;
      row.hidden = !options.expanded;
    } else {
      delete row.dataset.collapsedGroupId;
      row.hidden = false;
    }

    if (tag) {
      const leafText = node.hasChildren ? "" : " / 末端";
      const titleText = `displayVersion: ${getDisplayVersion(version)} / branchPath: ${branchPath} / 差分名: ${versionChartName}${leafText}`;
      tag.classList.add("version-tree-tag");
      tag.style.setProperty("--tree-depth", String(node.depth));
      tag.title = titleText;
      tag.innerHTML = publicDataRedacted ? `
        ${renderTreeConnector(node.depth)}
        <span class="version-label-stack">
          <span class="version-title-line">
            <span class="version-main-label">${html(displayVersionLabel)}</span>
            <span class="version-state-badges">${renderStateBadges(node, progress, uiModel)}</span>
          </span>
          <span class="version-redacted-message">${html(lifecycleStatus === "tombstoned"
            ? "投稿者により取り下げられました"
            : "取り下げ処理中")}</span>
          <span class="version-parent-line" title="${html(titleText)}">${html(parentText)}</span>
          <span class="version-lifecycle-line">${renderLifecycleMeta(version, uiModel, { isLatest: options.isLatest })}</span>
        </span>
      ` : `
        ${renderTreeConnector(node.depth)}
        <span class="version-label-stack">
          <span class="version-title-line">
            <span class="version-main-label">${html(displayVersionLabel)}</span>
            <span class="version-state-badges">${renderStateBadges(node, progress, uiModel)}</span>
          </span>
          <span class="version-chart-name-line">
            <span class="version-chart-name-label">差分名：</span>
            <span class="version-chart-name" title="${html(versionChartName)}">${html(versionChartName)}</span>
          </span>
          ${renderAppendPolicyInfo(version, uiModel)}
          <span class="version-parent-line" title="${html(titleText)}">${html(parentText)}</span>
          <span class="version-lifecycle-line">${renderLifecycleMeta(version, uiModel, { isLatest: options.isLatest })}</span>
        </span>
      `;
    }

    if (publicDataRedacted) {
      const cells = Array.from(row.querySelectorAll(":scope > .meta-block"));
      cells.forEach((cell) => {
        cell.replaceChildren();
        cell.setAttribute("aria-hidden", "true");
      });
      actions?.replaceChildren();
      return;
    }

    if (uiModel?.canShowActions !== true) {
      actions?.replaceChildren();
      return;
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

    enhanceOriginControl(row, displayVersionLabel);
    enhanceDownloadControl(row, version, uiModel, displayVersionLabel, supersededIntermediate);
    ensureManagementControl(row, version, uiModel, getChartId(options.entry), displayVersionLabel);
    if (supersededIntermediate) {
      lockAppendControl(row, "完成版に置き換え済みの中間履歴のため追記できません");
    }
  }

  function createVersionListHeader() {
    const header = document.createElement("div");
    header.className = "version-list-header";
    header.setAttribute("aria-hidden", "true");
    header.innerHTML = `
      <span class="group-gutter-header" title="中間履歴の開閉"></span>
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

  function setIntermediateGroupExpanded(list, groupId, expanded) {
    if (!list || !groupId) {
      return;
    }

    const rows = Array.from(list.querySelectorAll(".version-row.is-intermediate-history"));
    rows.forEach((row) => {
      if (row.dataset.collapsedGroupId === groupId) {
        row.hidden = !expanded;
      }
    });

    const buttons = Array.from(list.querySelectorAll(".intermediate-toggle-button"));
    buttons.forEach((button) => {
      if (button.dataset.collapsedGroupId !== groupId) {
        return;
      }

      const count = button.dataset.count || "0";
      const actionText = expanded ? "隠す" : "表示";
      const label = `中間履歴 ${count}件を${actionText}`;
      button.setAttribute("aria-expanded", expanded ? "true" : "false");
      button.setAttribute("aria-label", label);
      button.title = label;
      button.textContent = expanded ? `−${count}` : `+${count}`;
      button.closest(".version-row")?.classList.toggle("is-group-expanded", expanded);
    });

    applyVisibleTreeConnectors(list);
    window.scheduleChartMiniViewMount?.(list);
  }

  function revealVersionRow(root, versionId) {
    const targetId = String(versionId || "");
    if (!root || !targetId) {
      return null;
    }

    const row = Array.from(root.querySelectorAll(".version-row[data-version-id]"))
      .find((candidate) => candidate.dataset.versionId === targetId) || null;
    if (!row) {
      return null;
    }

    const groupId = row.dataset.collapsedGroupId || "";
    if (row.hidden && groupId) {
      expandedIntermediateGroups.add(groupId);
      setIntermediateGroupExpanded(row.closest(".version-list"), groupId, true);
    }
    return row;
  }

  function getChartId(entry) {
    const chart = entry?.chart || {};
    return chart.id || chart.chartId || entry?.chartId || "";
  }

  function findAppendContext(chartId, parentVersionId) {
    for (const entry of latestCharts) {
      if (getChartId(entry) !== chartId) {
        continue;
      }

      const versions = Array.isArray(entry.versions) ? entry.versions : [];
      const version = versions.find((item) => getVersionId(item) === parentVersionId);
      if (version) {
        return { entry, version, versions };
      }
    }

    return null;
  }

  function updateAppendContextLabels(button) {
    const context = findAppendContext(button.dataset.chartId || "", button.dataset.parentVersionId || "");
    if (!context) {
      return;
    }

    const lookup = buildLookup(context.versions);
    const parent = getParentVersion(context.version, lookup);
    const currentLabel = buildVersionPathLabel(getBranchPath(context.version));
    const fromLabel = buildFromLabel(parent);
    const rawTitle = `displayVersion: ${getDisplayVersion(context.version)} / branchPath: ${getBranchPath(context.version)}`;
    const appendContextTitle = document.querySelector("#appendContextTitle");
    const appendParentVersion = document.querySelector("#appendParentVersion");
    const appendParentChartName = document.querySelector("#appendParentChartName");

    if (appendContextTitle) {
      appendContextTitle.textContent = `追記投稿: ${currentLabel} から`;
      appendContextTitle.title = rawTitle;
    }

    if (appendParentVersion) {
      appendParentVersion.innerHTML = `
        <span class="append-version-label">${html(currentLabel)}</span>
        <span class="append-version-from">${html(fromLabel)}</span>
      `;
      appendParentVersion.title = rawTitle;
    }

    if (appendParentChartName) {
      appendParentChartName.textContent = getVersionChartName(context.version, context.entry);
    }
  }

  interactionRoot.addEventListener("click", (event) => {
    const appendButton = event.target.closest(".append-version-button");
    if (appendButton) {
      window.setTimeout(() => updateAppendContextLabels(appendButton), 0);
      return;
    }

    const button = event.target.closest(".intermediate-toggle-button");
    if (!button) {
      return;
    }

    event.preventDefault();
    const groupId = button.dataset.collapsedGroupId || "";
    const nextExpanded = !expandedIntermediateGroups.has(groupId);
    if (nextExpanded) {
      expandedIntermediateGroups.add(groupId);
    } else {
      expandedIntermediateGroups.delete(groupId);
    }

    setIntermediateGroupExpanded(button.closest(".version-list"), groupId, nextExpanded);
  });

  function enhanceTreeDisplay(data) {
    const charts = Array.isArray(data?.charts) ? data.charts : [];
    const nextChartIds = new Set(charts.map(getChartId));
    latestCharts = [
      ...charts,
      ...latestCharts.filter((entry) => {
        const chartId = getChartId(entry);
        return chartId && !nextChartIds.has(chartId);
      })
    ];
    const chartGroups = Array.from(listElement.querySelectorAll(".chart-group"));

    charts.forEach((entry, chartIndex) => {
      const group = chartGroups[chartIndex];
      if (!group) {
        return;
      }

      const list = group.querySelector(".version-list");
      const versions = Array.isArray(entry.versions) ? entry.versions : [];
      group.dataset.chartId = getChartId(entry);
      const latestVersion = versions
        .slice()
        .sort((left, right) => {
          const timeDiff = getCreatedAtTime(right) - getCreatedAtTime(left);
          return timeDiff || String(getVersionId(right)).localeCompare(String(getVersionId(left)));
        })[0];
      const latestVersionKey = getVersionId(latestVersion);
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
      const childrenByNodeKey = buildChildrenByNodeKey(treeNodes);
      const intermediateGroups = buildIntermediateGroups(treeNodes, childrenByNodeKey);
      const collapsedKeys = new Set();
      const collapsedRowsByGroup = new Map();

      treeNodes.forEach((node) => {
        const row = rowsByVersion.get(getNodeKey(node.version));
        if (!row) {
          return;
        }

        const groupId = getCollapseGroupId(node, treeNodes);
        const collapsible = intermediateGroups.has(groupId) && intermediateGroups.get(groupId)?.includes(node);
        const expanded = groupId ? expandedIntermediateGroups.has(groupId) : false;
        const commonOptions = {
          entry,
          isLatest: getVersionId(node.version) === latestVersionKey
        };
        enhanceRow(row, node, collapsible
          ? { ...commonOptions, collapsedGroupId: groupId, expanded }
          : commonOptions);

        if (collapsible) {
          collapsedKeys.add(getNodeKey(node.version));
          const groupedRows = collapsedRowsByGroup.get(groupId) || [];
          groupedRows.push(row);
          collapsedRowsByGroup.set(groupId, groupedRows);
        }
      });

      const fragment = document.createDocumentFragment();
      treeNodes.forEach((node) => {
        const row = rowsByVersion.get(getNodeKey(node.version));
        if (!row) {
          return;
        }

        if (collapsedKeys.has(getNodeKey(node.version))) {
          return;
        }

        const versionId = getVersionId(node.version);
        const groupedRows = collapsedRowsByGroup.get(versionId) || [];
        if (groupedRows.length > 0) {
          const expanded = expandedIntermediateGroups.has(versionId);
          setGroupGutterControl(row, versionId, groupedRows.length, expanded);
          groupedRows.forEach((groupedRow) => {
            groupedRow.hidden = !expanded;
            fragment.appendChild(groupedRow);
          });
        }

        fragment.appendChild(row);
      });

      if (fragment.childNodes.length > 0) {
        list.innerHTML = "";
        list.appendChild(createVersionListHeader());
        list.appendChild(fragment);
        applyVisibleTreeConnectors(list);
      }
    });
  }

  function renderChartsAsTree(data) {
    baseRenderCharts(data);
    enhanceTreeDisplay(data);
    window.scheduleProgressImageThumbnailMount?.(listElement);
    window.scheduleChartMiniViewMount?.(listElement);
  }

  try {
    renderCharts = renderChartsAsTree;
  } catch (error) {
    window.renderCharts = renderChartsAsTree;
  }

  window.revealChartVersionRow = revealVersionRow;
})();
