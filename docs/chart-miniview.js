(() => {
  const listElement = document.querySelector("#chartList");
  const dialog = document.querySelector("#chartMiniViewDialog");
  const dialogCanvas = document.querySelector("#chartMiniViewDialogCanvas");
  const dialogTitle = document.querySelector("#chartMiniViewDialogTitle");
  const dialogSummary = document.querySelector("#chartMiniViewDialogSummary");
  const payloadCache = new Map();
  const pendingRequests = new Map();
  const requestQueue = [];
  const maxConcurrentRequests = 4;
  let activeRequests = 0;
  let observer = null;
  let scheduled = false;
  let lastDialogTrigger = null;

  if (!listElement) {
    return;
  }

  function apiUrl(path) {
    const base = typeof API_BASE_URL === "string" ? API_BASE_URL : window.location.origin;
    return new URL(path, `${base.replace(/\/$/, "")}/`).href;
  }

  function decodeBits(value, resolution) {
    const binary = atob(String(value || ""));
    const expectedBytes = Math.ceil(resolution / 8);
    if (binary.length !== expectedBytes) {
      throw new Error("Invalid chart miniview bitset length.");
    }
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }

  function bitAt(bits, index) {
    return (bits[index >> 3] & (1 << (index & 7))) !== 0;
  }

  function normalizePayload(value) {
    if (!value || typeof value !== "object") {
      throw new Error("Chart miniview payload is missing.");
    }
    const resolution = Number(value.resolution);
    if (
      value.schemaVersion !== 1
      || value.mode !== "7key-sp"
      || !Number.isInteger(resolution)
      || resolution <= 0
      || resolution > 4096
      || !Array.isArray(value.laneOrder)
      || value.laneOrder.length !== 8
    ) {
      throw new Error("Chart miniview payload is unsupported.");
    }

    const readLaneBits = (source) => {
      if (!Array.isArray(source) || source.length !== 8) {
        throw new Error("Chart miniview lane data is invalid.");
      }
      return source.map((item) => decodeBits(item, resolution));
    };

    return {
      ...value,
      resolution,
      tapBitsets: readLaneBits(value.tapBits),
      longActiveBitsets: readLaneBits(value.longActiveBits),
      longStartBitsets: readLaneBits(value.longStartBits),
      longEndBitsets: readLaneBits(value.longEndBits),
      measureBitset: decodeBits(value.measureBits, resolution)
    };
  }

  function drawPlaceholder(canvas) {
    const width = Math.max(48, Math.round(canvas.getBoundingClientRect().width || 70));
    const height = Math.max(56, Math.round(canvas.getBoundingClientRect().height || 68));
    const ratio = Math.min(Number(window.devicePixelRatio) || 1, 2);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.fillStyle = "#f5f8f7";
    context.fillRect(0, 0, width, height);
    context.strokeStyle = "#d6e1dd";
    context.lineWidth = 1;
    for (let lane = 1; lane < 8; lane += 1) {
      const x = Math.round(lane * width / 8) + 0.5;
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, height);
      context.stroke();
    }
  }

  function drawPayload(canvas, payload, large = false) {
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(large ? 240 : 52, Math.round(rect.width || (large ? 360 : 70)));
    const height = Math.max(large ? 360 : 56, Math.round(rect.height || (large ? 640 : 68)));
    const ratio = Math.min(Number(window.devicePixelRatio) || 1, 2);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);

    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Canvas 2D context is unavailable.");
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);

    const padding = large ? 10 : 3;
    const plotX = padding;
    const plotY = padding;
    const plotWidth = Math.max(1, width - padding * 2);
    const plotHeight = Math.max(1, height - padding * 2);
    const laneWidth = plotWidth / 8;
    const yForIndex = (index) => plotY + index / Math.max(payload.resolution - 1, 1) * plotHeight;

    context.fillStyle = "#f9fbfa";
    context.fillRect(plotX, plotY, plotWidth, plotHeight);
    context.fillStyle = "#e7efec";
    context.fillRect(plotX, plotY, laneWidth, plotHeight);

    context.strokeStyle = "rgba(68, 99, 91, 0.18)";
    context.lineWidth = 1;
    for (let lane = 1; lane < 8; lane += 1) {
      const x = plotX + lane * laneWidth;
      context.beginPath();
      context.moveTo(x, plotY);
      context.lineTo(x, plotY + plotHeight);
      context.stroke();
    }

    context.strokeStyle = "rgba(76, 99, 92, 0.22)";
    context.lineWidth = large ? 1 : 0.7;
    for (let index = 0; index < payload.resolution; index += 1) {
      if (!bitAt(payload.measureBitset, index)) {
        continue;
      }
      const y = yForIndex(index);
      context.beginPath();
      context.moveTo(plotX, y);
      context.lineTo(plotX + plotWidth, y);
      context.stroke();
    }

    for (let lane = 0; lane < 8; lane += 1) {
      const x = plotX + lane * laneWidth;
      const activeBits = payload.longActiveBitsets[lane];
      context.fillStyle = lane === 0 ? "rgba(190, 119, 50, 0.7)" : "rgba(54, 124, 164, 0.58)";
      let runStart = -1;
      for (let index = 0; index <= payload.resolution; index += 1) {
        const active = index < payload.resolution && bitAt(activeBits, index);
        if (active && runStart < 0) {
          runStart = index;
        } else if (!active && runStart >= 0) {
          const yStart = yForIndex(runStart);
          const yEnd = yForIndex(Math.max(runStart + 1, index - 1));
          context.fillRect(x + laneWidth * 0.27, yStart, Math.max(1, laneWidth * 0.46), Math.max(1, yEnd - yStart));
          runStart = -1;
        }
      }
    }

    for (let lane = 0; lane < 8; lane += 1) {
      const x = plotX + lane * laneWidth;
      const tapBits = payload.tapBitsets[lane];
      const startBits = payload.longStartBitsets[lane];
      const endBits = payload.longEndBitsets[lane];
      for (let index = 0; index < payload.resolution; index += 1) {
        const y = yForIndex(index);
        if (bitAt(tapBits, index)) {
          context.fillStyle = lane === 0 ? "#b66f28" : "#176f5a";
          context.fillRect(x + 0.6, y - (large ? 1 : 0.5), Math.max(1, laneWidth - 1.2), large ? 2 : 1);
        }
        if (bitAt(startBits, index) || bitAt(endBits, index)) {
          context.fillStyle = lane === 0 ? "#8e4f17" : "#275f8b";
          context.fillRect(x + laneWidth * 0.12, y - 1, Math.max(1, laneWidth * 0.76), large ? 2.5 : 1.5);
        }
      }
    }

    context.strokeStyle = "#7c918a";
    context.lineWidth = 1;
    context.strokeRect(plotX + 0.5, plotY + 0.5, Math.max(0, plotWidth - 1), Math.max(0, plotHeight - 1));
  }

  async function fetchPayloadFromNetwork(url) {
    return fetch(apiUrl(url), {
      headers: { Accept: "application/json" }
    }).then(async (response) => {
      if (!response.ok) {
        throw new Error(`Chart miniview request failed (${response.status}).`);
      }
      const body = await response.json();
      return normalizePayload(body?.miniView);
    });
  }

  function paintRowVersion(versionId, payload) {
    listElement.querySelectorAll(`.chart-miniview-button[data-version-id="${CSS.escape(versionId)}"]`).forEach((button) => {
      const canvas = button.querySelector("canvas");
      if (!canvas) {
        return;
      }
      drawPayload(canvas, payload);
      button.dataset.state = "ready";
      button.title = "譜面ミニビューを拡大表示";
      button.setAttribute(
        "aria-label",
        `譜面ミニビューを開く。7key、通常ノート${payload.tapCount}、LN${payload.longNoteCount}`
      );
    });
  }

  function pumpQueue() {
    while (activeRequests < maxConcurrentRequests && requestQueue.length > 0) {
      const task = requestQueue.shift();
      if (!task.priority && (!task.button.isConnected || task.button.closest(".version-row")?.hidden)) {
        pendingRequests.delete(task.versionId);
        task.reject(new Error("Chart miniview load was canceled."));
        continue;
      }

      activeRequests += 1;
      task.button.dataset.state = "loading";
      fetchPayloadFromNetwork(task.url)
        .then((payload) => {
          payloadCache.set(task.versionId, payload);
          task.resolve(payload);
        }, task.reject)
        .finally(() => {
          pendingRequests.delete(task.versionId);
          activeRequests -= 1;
          pumpQueue();
        });
    }
  }

  function requestPayload(versionId, url, button, priority = false) {
    if (payloadCache.has(versionId)) {
      return Promise.resolve(payloadCache.get(versionId));
    }
    if (pendingRequests.has(versionId)) {
      return pendingRequests.get(versionId);
    }

    let resolveRequest;
    let rejectRequest;
    const promise = new Promise((resolve, reject) => {
      resolveRequest = resolve;
      rejectRequest = reject;
    });
    pendingRequests.set(versionId, promise);
    const task = {
      versionId,
      url,
      button,
      priority,
      resolve: resolveRequest,
      reject: rejectRequest
    };
    if (priority) {
      requestQueue.unshift(task);
    } else {
      requestQueue.push(task);
    }
    pumpQueue();
    return promise;
  }

  function queueLoad(button) {
    const versionId = button.dataset.versionId || "";
    const url = button.dataset.miniviewUrl || "";
    if (!versionId || !url) {
      return;
    }
    const cached = payloadCache.get(versionId);
    if (cached) {
      paintRowVersion(versionId, cached);
      return;
    }
    if (pendingRequests.has(versionId)) {
      return;
    }
    requestPayload(versionId, url, button)
      .then((payload) => paintRowVersion(versionId, payload))
      .catch((error) => {
        if (!button.isConnected || button.closest(".version-row")?.hidden) {
          return;
        }
        button.dataset.state = "error";
        button.title = "譜面ミニビューを読み込めませんでした";
        console.warn("[chart-miniview] failed to load", {
          versionId,
          message: error instanceof Error ? error.message : String(error)
        });
      });
  }

  function ensureObserver() {
    if (observer || typeof IntersectionObserver !== "function") {
      return observer;
    }
    observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          queueLoad(entry.target);
          observer.unobserve(entry.target);
        }
      });
    }, { rootMargin: "240px 0px" });
    return observer;
  }

  function ensureProgressSlot(cell) {
    let slot = cell.querySelector(":scope > .progress-thumbnail-slot");
    if (slot) {
      return slot;
    }
    slot = document.createElement("div");
    slot.className = "progress-thumbnail-slot";
    Array.from(cell.childNodes).forEach((node) => slot.appendChild(node));
    cell.appendChild(slot);
    return slot;
  }

  function mount(root = listElement) {
    const localObserver = ensureObserver();
    root.querySelectorAll('.version-row[data-miniview-available="true"]').forEach((row) => {
      if (row.hidden) {
        return;
      }
      const cell = row.querySelector(":scope > .thumbnail-cell, :scope > .progress-thumbnail-block");
      if (!cell) {
        return;
      }
      ensureProgressSlot(cell);
      cell.classList.add("has-chart-miniview");
      cell.classList.remove("is-empty");

      let shell = cell.querySelector(":scope > .chart-miniview-shell");
      if (!shell) {
        shell = document.createElement("div");
        shell.className = "chart-miniview-shell";
        shell.innerHTML = `
          <button class="chart-miniview-button" type="button" data-state="idle">
            <canvas class="chart-miniview-canvas" aria-hidden="true"></canvas>
          </button>
        `;
        cell.appendChild(shell);
      }

      const button = shell.querySelector(".chart-miniview-button");
      const canvas = shell.querySelector("canvas");
      if (!button || !canvas) {
        return;
      }
      button.dataset.versionId = row.dataset.versionId || "";
      button.dataset.miniviewUrl = row.dataset.miniviewUrl || "";
      button.setAttribute("aria-label", "譜面ミニビューを読み込んで開く");
      button.title = "譜面ミニビュー";
      drawPlaceholder(canvas);

      const cached = payloadCache.get(button.dataset.versionId);
      if (cached) {
        paintRowVersion(button.dataset.versionId, cached);
      } else if (localObserver) {
        localObserver.observe(button);
      } else {
        queueLoad(button);
      }
    });
  }

  function schedule(root = listElement) {
    if (scheduled) {
      return;
    }
    scheduled = true;
    window.requestAnimationFrame(() => {
      scheduled = false;
      mount(root);
    });
  }

  async function openDialog(button) {
    if (!dialog || !dialogCanvas) {
      return;
    }
    const versionId = button.dataset.versionId || "";
    const url = button.dataset.miniviewUrl || "";
    if (!versionId || !url) {
      return;
    }

    lastDialogTrigger = button;
    if (dialogTitle) {
      dialogTitle.textContent = "譜面ミニビュー";
    }
    if (dialogSummary) {
      dialogSummary.textContent = "読み込み中です。";
    }
    if (!dialog.open) {
      dialog.showModal();
    }

    try {
      const payload = await requestPayload(versionId, url, button, true);
      drawPayload(dialogCanvas, payload, true);
      if (dialogSummary) {
        dialogSummary.textContent = `7key SP / 通常ノート ${payload.tapCount} / LN ${payload.longNoteCount} / 小節 ${payload.startMeasure}-${payload.endMeasure}`;
      }
      paintRowVersion(versionId, payload);
    } catch (error) {
      drawPlaceholder(dialogCanvas);
      if (dialogSummary) {
        dialogSummary.textContent = "譜面ミニビューを読み込めませんでした。";
      }
    }
  }

  listElement.addEventListener("click", (event) => {
    const button = event.target.closest(".chart-miniview-button");
    if (button) {
      openDialog(button);
    }
  });

  dialog?.querySelectorAll("[data-chart-miniview-close]").forEach((button) => {
    button.addEventListener("click", () => dialog.close());
  });
  dialog?.addEventListener("click", (event) => {
    if (event.target === dialog) {
      dialog.close();
    }
  });
  dialog?.addEventListener("close", () => {
    lastDialogTrigger?.focus();
    lastDialogTrigger = null;
  });

  let resizeTimer = 0;
  window.addEventListener("resize", () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      listElement.querySelectorAll(".chart-miniview-button[data-version-id]").forEach((button) => {
        const payload = payloadCache.get(button.dataset.versionId || "");
        const canvas = button.querySelector("canvas");
        if (payload && canvas) {
          drawPayload(canvas, payload);
        }
      });
    }, 120);
  });

  window.scheduleChartMiniViewMount = schedule;
  window.debugChartMiniViews = () => ({
    availableRows: listElement.querySelectorAll('[data-miniview-available="true"]').length,
    mountedButtons: listElement.querySelectorAll(".chart-miniview-button").length,
    readyButtons: listElement.querySelectorAll('.chart-miniview-button[data-state="ready"]').length,
    cachedVersions: payloadCache.size,
    activeRequests,
    queuedRequests: requestQueue.length
  });
})();
