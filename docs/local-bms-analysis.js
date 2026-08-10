(() => {
  const MINI_VIEW_PAYLOAD_MAX_BYTES = 32 * 1024;
  const MINI_VIEW_MAX_EVENTS = 50_000;
  const LANE_COUNT = 8;
  const CONTROL_FLOW_PATTERN = /^#(?:RANDOM|SETRANDOM|ENDRANDOM|IF|ELSEIF|ELSE|ENDIF|SWITCH|SETSWITCH|CASE|SKIP|DEF|ENDSW)\b/i;
  const SECOND_PLAYER_CHANNEL_PATTERN = /^(?:2[1-9]|6[1-9])$/;
  const MINI_VIEW_LANE_ORDER = [
    "scratch",
    "key1",
    "key2",
    "key3",
    "key4",
    "key5",
    "key6",
    "key7"
  ];
  const NORMAL_LANES = new Map([
    ["16", 0],
    ["11", 1],
    ["12", 2],
    ["13", 3],
    ["14", 4],
    ["15", 5],
    ["18", 6],
    ["19", 7]
  ]);
  const LONG_LANES = new Map([
    ["56", 0],
    ["51", 1],
    ["52", 2],
    ["53", 3],
    ["54", 4],
    ["55", 5],
    ["58", 6],
    ["59", 7]
  ]);
  const MINE_LANES = new Map([
    ["D6", 0],
    ["D1", 1],
    ["D2", 2],
    ["D3", 3],
    ["D4", 4],
    ["D5", 5],
    ["D8", 6],
    ["D9", 7]
  ]);
  const analysisPromises = new WeakMap();

  function unsupported(code, message, detail) {
    return {
      miniView: {
        schemaVersion: 3,
        status: "unsupported",
        mode: null,
        reasonCode: code
      },
      warning: { code, message, detail }
    };
  }

  function parseMetadataText(text) {
    const metadata = {};
    const supported = new Set(["TITLE", "SUBTITLE", "ARTIST", "SUBARTIST", "PLAYLEVEL"]);
    for (const rawLine of String(text || "").split(/\r?\n/)) {
      const match = rawLine.replace(/^\uFEFF/, "").trim().match(/^#([A-Za-z0-9]+)\s+(.+)$/);
      if (!match) {
        continue;
      }
      const key = match[1].toUpperCase();
      if (supported.has(key) && !metadata[key]) {
        metadata[key] = match[2].trim();
      }
    }
    return metadata;
  }

  function scoreDecodedText(text) {
    const metadata = parseMetadataText(text);
    const values = Object.values(metadata).filter(Boolean);
    return values.length * 100 + values.join("").length - (text.match(/\uFFFD/g) || []).length * 20;
  }

  function decodeBmsBuffer(buffer) {
    const candidates = ["utf-8", "shift-jis"].map((encoding) => {
      const text = new TextDecoder(encoding, { fatal: false }).decode(buffer);
      return { encoding, text, score: scoreDecodedText(text) };
    }).sort((left, right) => right.score - left.score);
    if (!candidates[0]) {
      throw new Error("Failed to decode BMS text as UTF-8 or Shift_JIS.");
    }
    return candidates[0];
  }

  function hasNonZeroObject(data) {
    const pairCount = Math.floor(data.length / 2);
    for (let index = 0; index < pairCount; index += 1) {
      if (data.slice(index * 2, index * 2 + 2).toUpperCase() !== "00") {
        return true;
      }
    }
    return false;
  }

  function splitObjects(data) {
    const normalized = data.trim();
    if (normalized.length === 0 || normalized.length % 2 !== 0 || !/^[0-9A-Za-z]+$/.test(normalized)) {
      return null;
    }
    const pairCount = normalized.length / 2;
    const result = [];
    for (let index = 0; index < pairCount; index += 1) {
      const objectId = normalized.slice(index * 2, index * 2 + 2).toUpperCase();
      if (objectId !== "00") {
        result.push({ objectId, fraction: index / pairCount, pairIndex: index, pairCount });
      }
    }
    return result;
  }

  function getExtension(fileName) {
    const baseName = String(fileName || "").split(/[\\/]/).pop() || "";
    const dotIndex = baseName.lastIndexOf(".");
    return dotIndex >= 0 ? baseName.slice(dotIndex).toLowerCase() : "";
  }

  function getMeasureLength(measure, measureLengths) {
    const value = measureLengths.get(measure);
    return Number.isFinite(value) && value > 0 ? value : 1;
  }

  function buildMeasureStarts(maxMeasure, measureLengths) {
    const starts = [];
    let position = 0;
    for (let measure = 0; measure <= maxMeasure + 1; measure += 1) {
      starts[measure] = position;
      position += getMeasureLength(measure, measureLengths);
    }
    return starts;
  }

  function compareEvents(left, right) {
    return Number(left.position) - Number(right.position)
      || left.lane - right.lane
      || left.objectId.localeCompare(right.objectId);
  }

  function greatestCommonDivisor(left, right) {
    let a = Math.abs(left);
    let b = Math.abs(right);
    while (b > 0) {
      const remainder = a % b;
      a = b;
      b = remainder;
    }
    return a || 1;
  }

  function normalizeBpmEvents(events) {
    const finalByPosition = new Map();
    for (const event of [...events].sort((left, right) => left.sourceOrder - right.sourceOrder)) {
      const divisor = greatestCommonDivisor(event.numerator, event.denominator);
      const numerator = event.numerator / divisor;
      const denominator = event.denominator / divisor;
      finalByPosition.set(`${event.measure}:${numerator}/${denominator}`, {
        ...event,
        numerator,
        denominator
      });
    }
    return [...finalByPosition.values()].sort((left, right) => (
      left.measure - right.measure
      || left.numerator / left.denominator - right.numerator / right.denominator
      || left.sourceOrder - right.sourceOrder
    ));
  }

  function bytesToBase64(bytes) {
    let binary = "";
    for (let index = 0; index < bytes.length; index += 1) {
      binary += String.fromCharCode(bytes[index]);
    }
    return btoa(binary);
  }

  function appendVarint(target, value) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error("Chart miniview varint value is invalid.");
    }
    let remaining = value;
    do {
      const next = remaining % 128;
      remaining = Math.floor(remaining / 128);
      target.push(next | (remaining > 0 ? 0x80 : 0));
    } while (remaining > 0);
  }

  function encodePackedEvents(events) {
    const sorted = [...events].sort((left, right) => (
      left.measure - right.measure
      || left.lane - right.lane
      || left.kind - right.kind
      || left.denominator - right.denominator
      || left.numerator - right.numerator
    ));
    const groups = [];
    for (const event of sorted) {
      if (
        !Number.isSafeInteger(event.measure)
        || event.measure < 0
        || !Number.isSafeInteger(event.lane)
        || event.lane < 0
        || event.lane >= LANE_COUNT
        || !Number.isSafeInteger(event.numerator)
        || event.numerator < 0
        || !Number.isSafeInteger(event.denominator)
        || event.denominator <= 0
        || event.numerator >= event.denominator
      ) {
        throw new Error("Chart miniview contains an invalid exact event.");
      }
      const previous = groups.at(-1);
      const first = previous?.[0];
      if (
        first
        && first.measure === event.measure
        && first.lane === event.lane
        && first.kind === event.kind
        && first.denominator === event.denominator
      ) {
        previous.push(event);
      } else {
        groups.push([event]);
      }
    }

    const bytes = [];
    let previousMeasure = 0;
    for (const group of groups) {
      const first = group[0];
      appendVarint(bytes, first.measure - previousMeasure);
      previousMeasure = first.measure;
      bytes.push((first.kind << 3) | first.lane);
      appendVarint(bytes, first.denominator);
      appendVarint(bytes, group.length);
      let previousNumerator = 0;
      for (const event of group) {
        appendVarint(bytes, event.numerator - previousNumerator);
        previousNumerator = event.numerator;
      }
    }
    return { data: bytesToBase64(Uint8Array.from(bytes)), groupCount: groups.length };
  }

  function buildPayload(taps, longNotes, mines, initialBpm, bpmEvents, measureStarts, measureLengths, analysis) {
    const displayStartMeasure = analysis.displayFirstMeasure;
    const displayEndMeasure = analysis.displayLastMeasure;
    if (!Number.isInteger(displayStartMeasure) || !Number.isInteger(displayEndMeasure) || displayEndMeasure < displayStartMeasure) {
      return null;
    }
    const startMeasure = mines.reduce((minimum, event) => Math.min(minimum, event.measure), displayStartMeasure);
    const endMeasure = mines.reduce((maximum, event) => Math.max(maximum, event.measure), displayEndMeasure);
    const startPosition = measureStarts[startMeasure];
    const endPosition = measureStarts[endMeasure + 1];
    if (!Number.isFinite(startPosition) || !Number.isFinite(endPosition) || endPosition <= startPosition) {
      return null;
    }
    const packed = encodePackedEvents([
      ...taps.map((event) => ({
        lane: event.lane,
        measure: event.measure,
        numerator: event.pairIndex,
        denominator: event.pairCount,
        kind: 0
      })),
      ...longNotes.flatMap((interval) => ([
        {
          lane: interval.lane,
          measure: interval.startEvent.measure,
          numerator: interval.startEvent.pairIndex,
          denominator: interval.startEvent.pairCount,
          kind: 1
        },
        {
          lane: interval.lane,
          measure: interval.endEvent.measure,
          numerator: interval.endEvent.pairIndex,
          denominator: interval.endEvent.pairCount,
          kind: 2
        }
      ])),
      ...mines.map((event) => ({
        lane: event.lane,
        measure: event.measure,
        numerator: event.pairIndex,
        denominator: event.pairCount,
        kind: 3
      }))
    ]);
    const lengthOverrides = [...measureLengths.entries()]
      .filter(([measure, length]) => measure >= 0 && measure <= endMeasure && Number.isFinite(length) && length > 0 && length !== 1)
      .sort(([left], [right]) => left - right);
    return {
      schemaVersion: 3,
      mode: "7key-sp",
      laneOrder: [...MINI_VIEW_LANE_ORDER],
      startMeasure,
      endMeasure,
      startPosition,
      endPosition,
      noteCount: taps.length + longNotes.length,
      tapCount: taps.length,
      longNoteCount: longNotes.length,
      mineCount: mines.length,
      eventEncoding: "grouped-varint-v1",
      eventGroupCount: packed.groupCount,
      eventData: packed.data,
      measureLengths: lengthOverrides,
      initialBpm,
      bpmEvents: bpmEvents
        .filter((event) => event.measure <= endMeasure)
        .map((event) => [event.measure, event.numerator, event.denominator, event.bpm])
    };
  }

  function analyzeMiniViewText(text, sourceFileName, analysis) {
    try {
      const lines = String(text || "").split(/\r?\n/);
      if (lines.some((rawLine) => CONTROL_FLOW_PATTERN.test(rawLine.replace(/^\uFEFF/, "").trim()))) {
        return unsupported("MINIVIEW_RANDOM_UNSUPPORTED", "Chart miniview does not support BMS control-flow directives.");
      }

      const normalEvents = [];
      const longEvents = [];
      const mineEvents = [];
      const rawBpmEvents = [];
      const bpmDefinitions = new Map();
      const measureLengths = new Map();
      const lnObjects = new Set();
      const seenPlayableLines = new Set();
      let usesExtendedKeys = false;
      let initialBpm = null;
      let bpmSourceOrder = 0;

      for (const rawLine of lines) {
        const line = rawLine.replace(/^\uFEFF/, "").trim();
        const indexedBpmMatch = line.match(/^#BPM([0-9A-Za-z]{2})\s+([0-9.]+)$/i);
        if (indexedBpmMatch) {
          const value = Number.parseFloat(indexedBpmMatch[2]);
          if (Number.isFinite(value) && value > 0) {
            bpmDefinitions.set(indexedBpmMatch[1].toUpperCase(), value);
          }
          continue;
        }
        const initialBpmMatch = line.match(/^#BPM\s+([0-9.]+)$/i);
        if (initialBpmMatch) {
          const value = Number.parseFloat(initialBpmMatch[1]);
          if (Number.isFinite(value) && value > 0) {
            initialBpm = value;
          }
        }
      }

      for (const rawLine of lines) {
        const line = rawLine.replace(/^\uFEFF/, "").trim();
        const playerMatch = line.match(/^#PLAYER\s+(\d+)$/i);
        if (playerMatch) {
          if (Number(playerMatch[1]) !== 1) {
            return unsupported("MINIVIEW_UNSUPPORTED_MODE", "Chart miniview supports 7key single play only.");
          }
          continue;
        }
        const lnTypeMatch = line.match(/^#LNTYPE\s+(\d+)$/i);
        if (lnTypeMatch) {
          if (Number(lnTypeMatch[1]) === 2) {
            return unsupported("MINIVIEW_LNTYPE2_UNSUPPORTED", "Chart miniview does not support LNTYPE 2.");
          }
          if (Number(lnTypeMatch[1]) !== 1) {
            return unsupported("MINIVIEW_GENERATION_FAILED", "Chart miniview found an unsupported LNTYPE value.");
          }
          continue;
        }
        const lnObjectMatch = line.match(/^#LNOBJ\s+([0-9A-Za-z]{2})$/i);
        if (lnObjectMatch) {
          const value = lnObjectMatch[1].toUpperCase();
          if (value !== "00") {
            lnObjects.add(value);
          }
          continue;
        }

        const dataMatch = line.match(/^#(\d{3})([0-9A-Za-z]{2}):(.+)$/);
        if (!dataMatch) {
          continue;
        }
        const measure = Number(dataMatch[1]);
        const channel = dataMatch[2].toUpperCase();
        const data = dataMatch[3].trim();
        if (channel === "02") {
          const length = Number.parseFloat(data);
          if (Number.isFinite(length) && length > 0) {
            measureLengths.set(measure, length);
          }
          continue;
        }
        if (channel === "03" || channel === "08") {
          const objects = splitObjects(data);
          if (objects) {
            for (const object of objects) {
              const bpm = channel === "03"
                ? Number.parseInt(object.objectId, 16)
                : bpmDefinitions.get(object.objectId);
              if (Number.isFinite(bpm) && Number(bpm) > 0) {
                rawBpmEvents.push({
                  measure,
                  numerator: object.pairIndex,
                  denominator: object.pairCount,
                  bpm: Number(bpm),
                  sourceOrder: bpmSourceOrder++
                });
              }
            }
          }
          if (normalEvents.length + longEvents.length + mineEvents.length + rawBpmEvents.length > MINI_VIEW_MAX_EVENTS) {
            return unsupported("MINIVIEW_TOO_COMPLEX", "Chart miniview event count exceeds the safe limit.");
          }
          continue;
        }
        if (!hasNonZeroObject(data)) {
          continue;
        }
        const mineLane = MINE_LANES.get(channel);
        if (mineLane !== undefined) {
          const lineKey = `${measure}:${channel}`;
          if (seenPlayableLines.has(lineKey)) {
            return unsupported("MINIVIEW_GENERATION_FAILED", "Chart miniview does not support duplicated playable channel lines.", lineKey);
          }
          seenPlayableLines.add(lineKey);
          const objects = splitObjects(data);
          if (!objects) {
            return unsupported("MINIVIEW_GENERATION_FAILED", "Chart miniview found malformed playable channel data.", lineKey);
          }
          mineEvents.push(...objects.map((object) => ({
            lane: mineLane,
            measure,
            fraction: object.fraction,
            pairIndex: object.pairIndex,
            pairCount: object.pairCount,
            objectId: object.objectId
          })));
          if (channel === "D8" || channel === "D9") {
            usesExtendedKeys = true;
          }
          if (normalEvents.length + longEvents.length + mineEvents.length + rawBpmEvents.length > MINI_VIEW_MAX_EVENTS) {
            return unsupported("MINIVIEW_TOO_COMPLEX", "Chart miniview event count exceeds the safe limit.");
          }
          continue;
        }
        if (/^E[1-9]$/i.test(channel) || channel === "D7") {
          return unsupported("MINIVIEW_UNSUPPORTED_MODE", "Chart miniview found an unsupported mine channel.", `channel=${channel}`);
        }
        if (SECOND_PLAYER_CHANNEL_PATTERN.test(channel)) {
          return unsupported("MINIVIEW_UNSUPPORTED_MODE", "Chart miniview supports 7key single play only.");
        }
        if (["17", "27", "57", "67"].includes(channel)) {
          return unsupported("MINIVIEW_UNSUPPORTED_MODE", "Chart miniview found a special playable channel.", `channel=${channel}`);
        }
        const lane = NORMAL_LANES.get(channel) ?? LONG_LANES.get(channel);
        if (lane === undefined) {
          continue;
        }
        const lineKey = `${measure}:${channel}`;
        if (seenPlayableLines.has(lineKey)) {
          return unsupported("MINIVIEW_GENERATION_FAILED", "Chart miniview does not support duplicated playable channel lines.", lineKey);
        }
        seenPlayableLines.add(lineKey);
        const objects = splitObjects(data);
        if (!objects) {
          return unsupported("MINIVIEW_GENERATION_FAILED", "Chart miniview found malformed playable channel data.", lineKey);
        }
        for (const object of objects) {
          const event = {
            lane,
            measure,
            fraction: object.fraction,
            pairIndex: object.pairIndex,
            pairCount: object.pairCount,
            objectId: object.objectId
          };
          if (NORMAL_LANES.has(channel)) {
            normalEvents.push(event);
          } else {
            longEvents.push(event);
          }
          if (["18", "19", "58", "59"].includes(channel)) {
            usesExtendedKeys = true;
          }
        }
        if (normalEvents.length + longEvents.length + mineEvents.length + rawBpmEvents.length > MINI_VIEW_MAX_EVENTS) {
          return unsupported("MINIVIEW_TOO_COMPLEX", "Chart miniview event count exceeds the safe limit.");
        }
      }

      const extension = getExtension(sourceFileName);
      if (extension === ".pms" || (extension !== ".bme" && !usesExtendedKeys)) {
        return unsupported("MINIVIEW_UNSUPPORTED_MODE", "Chart key mode cannot be identified safely as 7key single play.");
      }
      if (!Number.isInteger(analysis?.displayFirstMeasure) || !Number.isInteger(analysis?.displayLastMeasure)) {
        return unsupported("MINIVIEW_UNSUPPORTED_MODE", "Chart miniview requires playable notes.");
      }

      const maxMeasure = Math.max(
        analysis.displayLastMeasure,
        ...normalEvents.map((event) => event.measure),
        ...longEvents.map((event) => event.measure),
        ...mineEvents.map((event) => event.measure)
      );
      const measureStarts = buildMeasureStarts(maxMeasure, measureLengths);
      const positionEvent = (event) => ({
        ...event,
        position: measureStarts[event.measure] + event.fraction * getMeasureLength(event.measure, measureLengths)
      });
      const positionedNormal = normalEvents.map(positionEvent).sort(compareEvents);
      const positionedLong = longEvents.map(positionEvent).sort(compareEvents);
      const positionedMines = mineEvents.map(positionEvent).sort(compareEvents);
      const taps = [];
      const longNotes = [];

      for (let lane = 0; lane < LANE_COUNT; lane += 1) {
        const laneNormal = positionedNormal.filter((event) => event.lane === lane);
        const consumed = new Set();
        let previous = null;
        for (const event of laneNormal) {
          if (lnObjects.has(event.objectId)) {
            if (!previous || Number(previous.position) >= Number(event.position)) {
              return unsupported("MINIVIEW_MALFORMED_LN", "LNOBJ has no valid preceding note.", `lane=${lane}`);
            }
            consumed.add(previous);
            consumed.add(event);
            longNotes.push({
              lane,
              startEvent: previous,
              endEvent: event,
              startPosition: Number(previous.position),
              endPosition: Number(event.position)
            });
            previous = null;
          } else {
            previous = event;
          }
        }
        taps.push(...laneNormal.filter((event) => !consumed.has(event) && !lnObjects.has(event.objectId)));

        const laneLong = positionedLong.filter((event) => event.lane === lane);
        if (laneLong.length % 2 !== 0) {
          return unsupported("MINIVIEW_MALFORMED_LN", "Long-note channel has an unclosed interval.", `lane=${lane}`);
        }
        for (let index = 0; index < laneLong.length; index += 2) {
          const start = Number(laneLong[index].position);
          const end = Number(laneLong[index + 1].position);
          if (!(end > start)) {
            return unsupported("MINIVIEW_MALFORMED_LN", "Long-note interval has an invalid endpoint.", `lane=${lane}`);
          }
          longNotes.push({
            lane,
            startEvent: laneLong[index],
            endEvent: laneLong[index + 1],
            startPosition: start,
            endPosition: end
          });
        }
      }

      for (let lane = 0; lane < LANE_COUNT; lane += 1) {
        const laneIntervals = longNotes
          .filter((item) => item.lane === lane)
          .sort((left, right) => left.startPosition - right.startPosition || left.endPosition - right.endPosition);
        for (let index = 1; index < laneIntervals.length; index += 1) {
          if (laneIntervals[index].startPosition <= laneIntervals[index - 1].endPosition) {
            return unsupported("MINIVIEW_MALFORMED_LN", "Long-note intervals overlap.", `lane=${lane}`);
          }
        }
        const laneTaps = taps.filter((event) => event.lane === lane).sort(compareEvents);
        for (let index = 1; index < laneTaps.length; index += 1) {
          if (Number(laneTaps[index].position) === Number(laneTaps[index - 1].position)) {
            return unsupported("MINIVIEW_GENERATION_FAILED", "Duplicate notes share the same lane position.", `lane=${lane}`);
          }
        }
        if (laneTaps.some((tap) => laneIntervals.some((interval) => (
          Number(tap.position) >= interval.startPosition && Number(tap.position) <= interval.endPosition
        )))) {
          return unsupported("MINIVIEW_MALFORMED_LN", "A normal note overlaps a long-note interval.", `lane=${lane}`);
        }
      }

      const bpmEvents = normalizeBpmEvents(rawBpmEvents);
      const payload = buildPayload(taps, longNotes, positionedMines, initialBpm, bpmEvents, measureStarts, measureLengths, analysis);
      if (!payload) {
        return unsupported("MINIVIEW_GENERATION_FAILED", "Chart miniview could not build a display range.");
      }
      const miniView = {
        schemaVersion: 3,
        status: "ready",
        mode: "7key-sp",
        payload
      };
      const byteLength = new TextEncoder().encode(JSON.stringify(miniView)).byteLength;
      if (byteLength > MINI_VIEW_PAYLOAD_MAX_BYTES) {
        return unsupported("MINIVIEW_TOO_COMPLEX", "Chart miniview payload exceeds 32 KiB.", `bytes=${byteLength}`);
      }
      return { miniView, warning: null };
    } catch (error) {
      return unsupported(
        "MINIVIEW_GENERATION_FAILED",
        "Chart miniview generation failed.",
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  async function readSelectedFile(file) {
    const extension = getExtension(file?.name);
    if (extension === ".zip") {
      if (!window.BmsZipReader?.extractSingleBms) {
        throw new Error("ZIP reader is unavailable.");
      }
      return window.BmsZipReader.extractSingleBms(file);
    }
    return {
      fileName: file.name,
      buffer: await file.arrayBuffer()
    };
  }

  function analyze(file, progressAnalyzer) {
    if (!(file instanceof Blob) || typeof progressAnalyzer !== "function") {
      return Promise.reject(new Error("Local BMS analysis input is invalid."));
    }
    const cached = analysisPromises.get(file);
    if (cached) {
      return cached;
    }
    const promise = (async () => {
      const source = await readSelectedFile(file);
      const decoded = decodeBmsBuffer(source.buffer);
      const progressAnalysis = progressAnalyzer(decoded.text);
      const miniViewResult = analyzeMiniViewText(decoded.text, source.fileName, progressAnalysis);
      return {
        file,
        sourceFileName: source.fileName,
        text: decoded.text,
        encoding: decoded.encoding,
        progressAnalysis,
        miniView: miniViewResult.miniView,
        miniViewWarning: miniViewResult.warning
      };
    })();
    analysisPromises.set(file, promise);
    promise.catch(() => analysisPromises.delete(file));
    return promise;
  }

  window.BmsLocalChartAnalysis = Object.freeze({
    analyze,
    analyzeMiniViewText,
    limits: Object.freeze({
      maxEvents: MINI_VIEW_MAX_EVENTS,
      maxPayloadBytes: MINI_VIEW_PAYLOAD_MAX_BYTES
    })
  });
})();
