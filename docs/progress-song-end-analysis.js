(() => {
  const defaultBpm = 130;
  const normalPlayNoteChannelRanges = [[11, 19], [21, 29]];
  const longNoteChannelRanges = [[51, 59], [61, 69]];
  const timeProgressChannels = new Set(["01", "02", "03", "08", "09"]);

  function isInChannelRanges(channel, ranges) {
    if (!/^\d{2}$/.test(channel)) {
      return false;
    }

    const numericChannel = Number(channel);
    return ranges.some(([min, max]) => numericChannel >= min && numericChannel <= max);
  }

  function isNormalPlayNoteChannel(channel) {
    return isInChannelRanges(channel, normalPlayNoteChannelRanges);
  }

  function isLongNoteChannel(channel) {
    return isInChannelRanges(channel, longNoteChannelRanges);
  }

  function isPlayNoteChannel(channel) {
    return isNormalPlayNoteChannel(channel) || isLongNoteChannel(channel);
  }

  function parseNumber(value) {
    const numberValue = Number.parseFloat(value);
    return Number.isFinite(numberValue) ? numberValue : null;
  }

  function splitDataObjects(data) {
    const pairs = [];
    const cleanData = String(data || "").trim();
    const pairCount = Math.floor(cleanData.length / 2);

    for (let pairIndex = 0; pairIndex < pairCount; pairIndex += 1) {
      const objectId = cleanData.slice(pairIndex * 2, pairIndex * 2 + 2).toUpperCase();
      if (objectId !== "00") {
        pairs.push({ objectId, pairIndex, pairCount });
      }
    }

    return pairs;
  }

  function hasNonZeroDataObject(data) {
    return splitDataObjects(data).length > 0;
  }

  function isTimeProgressChannel(channel) {
    return timeProgressChannels.has(channel) || isPlayNoteChannel(channel);
  }

  function hasTimeProgressData(channel, data) {
    if (channel === "02") {
      const length = parseNumber(data);
      return Boolean(length && length > 0);
    }

    return isTimeProgressChannel(channel) && hasNonZeroDataObject(data);
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

  function getStandardPosition(event, measureStarts, measureLengths) {
    return measureStarts[event.measure] + event.fraction * getMeasureLength(event.measure, measureLengths);
  }

  function positionToMeasure(standardPosition, measureStarts, measureLengths, maxMeasure) {
    for (let measure = 0; measure <= maxMeasure; measure += 1) {
      const start = measureStarts[measure];
      const end = start + getMeasureLength(measure, measureLengths);
      if (standardPosition >= start && standardPosition < end) {
        return measure;
      }
    }

    return maxMeasure;
  }

  function addMeasureNotes(measureCounts, measure, count) {
    if (count <= 0) {
      return;
    }

    measureCounts.set(measure, (measureCounts.get(measure) || 0) + count);
  }

  function comparePlayEvents(a, b) {
    return a.standardPosition - b.standardPosition || a.channel.localeCompare(b.channel);
  }

  function collectLongNoteStarts(longNoteEvents, measureCounts) {
    const activeByChannel = new Map();
    const starts = [];

    for (const event of [...longNoteEvents].sort(comparePlayEvents)) {
      const isActive = activeByChannel.get(event.channel) || false;
      if (!isActive) {
        starts.push({ ...event });
        addMeasureNotes(measureCounts, event.measure, 1);
      }

      activeByChannel.set(event.channel, !isActive);
    }

    return starts;
  }

  function addTimelineEvent(eventsByMeasure, event) {
    const events = eventsByMeasure.get(event.measure) || [];
    events.push(event);
    eventsByMeasure.set(event.measure, events);
  }

  function getEventPriority(event) {
    if (event.kind === "bpm") {
      return 0;
    }

    if (event.kind === "stop") {
      return 1;
    }

    return 2;
  }

  function applyTimingToNotes(playEvents, timingEvents, maxMeasure, measureLengths, initialBpm) {
    const eventsByMeasure = new Map();

    for (const event of timingEvents) {
      addTimelineEvent(eventsByMeasure, event);
    }

    for (const event of playEvents) {
      addTimelineEvent(eventsByMeasure, { ...event, kind: "note", noteRef: event });
    }

    let currentBpm = Number.isFinite(initialBpm) && initialBpm > 0 ? initialBpm : defaultBpm;
    let timeSec = 0;

    for (let measure = 0; measure <= maxMeasure; measure += 1) {
      const measureLength = getMeasureLength(measure, measureLengths);
      const events = (eventsByMeasure.get(measure) || [])
        .filter((event) => Number.isFinite(event.fraction))
        .sort((a, b) => a.fraction - b.fraction || getEventPriority(a) - getEventPriority(b));
      let lastFraction = 0;

      for (const event of events) {
        const fraction = Math.min(Math.max(event.fraction, 0), 1);
        const deltaBeats = Math.max(0, fraction - lastFraction) * measureLength * 4;
        timeSec += deltaBeats * 60 / currentBpm;
        lastFraction = Math.max(lastFraction, fraction);

        if (event.kind === "bpm" && Number.isFinite(event.value) && event.value > 0) {
          currentBpm = event.value;
        } else if (event.kind === "stop" && Number.isFinite(event.value) && event.value > 0) {
          timeSec += (event.value / 192) * 4 * 60 / currentBpm;
        } else if (event.kind === "note" && event.noteRef) {
          event.noteRef.timeSec = timeSec;
        }
      }

      const restBeats = Math.max(0, 1 - lastFraction) * measureLength * 4;
      timeSec += restBeats * 60 / currentBpm;
    }
  }

  function estimateTimeForPosition(standardPosition, playEvents) {
    const timedEvents = playEvents
      .filter((event) => Number.isFinite(event.standardPosition) && Number.isFinite(event.timeSec))
      .sort(comparePlayEvents);

    if (timedEvents.length === 0) {
      return null;
    }

    const firstEvent = timedEvents[0];
    const lastEvent = timedEvents[timedEvents.length - 1];

    if (standardPosition <= firstEvent.standardPosition) {
      return firstEvent.timeSec;
    }

    if (standardPosition >= lastEvent.standardPosition) {
      return lastEvent.timeSec;
    }

    for (let index = 1; index < timedEvents.length; index += 1) {
      const previous = timedEvents[index - 1];
      const next = timedEvents[index];
      if (standardPosition <= next.standardPosition) {
        const positionSpan = next.standardPosition - previous.standardPosition;
        if (positionSpan <= 0) {
          return next.timeSec;
        }

        const ratio = (standardPosition - previous.standardPosition) / positionSpan;
        return previous.timeSec + (next.timeSec - previous.timeSec) * ratio;
      }
    }

    return lastEvent.timeSec;
  }

  function buildDensityBins(playEvents) {
    const timedEvents = playEvents.filter((event) => Number.isFinite(event.timeSec));

    if (timedEvents.length === 0) {
      return [];
    }

    const firstTimeSec = Math.min(...timedEvents.map((event) => event.timeSec));
    const lastTimeSec = Math.max(...timedEvents.map((event) => event.timeSec));
    const binCount = Math.max(1, Math.floor(lastTimeSec - firstTimeSec) + 1);
    const bins = Array.from({ length: binCount }, (_, second) => ({ second, playNotes: 0 }));

    for (const event of timedEvents) {
      const second = Math.min(binCount - 1, Math.max(0, Math.floor(event.timeSec - firstTimeSec)));
      bins[second].playNotes += 1;
    }

    return bins;
  }

  function buildStandardBlocks(playEvents, measureStarts, measureLengths, maxMeasure, firstBlockPosition, lastBlockEndPosition) {
    if (playEvents.length === 0 || !Number.isFinite(firstBlockPosition) || !Number.isFinite(lastBlockEndPosition)) {
      return [];
    }

    const blockCount = Math.max(1, Math.ceil(lastBlockEndPosition - firstBlockPosition));
    return Array.from({ length: blockCount }, (_, index) => {
      const startPosition = firstBlockPosition + index;
      const endPosition = Math.min(startPosition + 1, lastBlockEndPosition);
      const blockNotes = playEvents.filter((event) => event.standardPosition >= startPosition && event.standardPosition < endPosition);

      return {
        index,
        startMeasure: positionToMeasure(startPosition, measureStarts, measureLengths, maxMeasure),
        endMeasure: positionToMeasure(endPosition - 0.000001, measureStarts, measureLengths, maxMeasure),
        startStandardPosition: startPosition,
        endStandardPosition: endPosition,
        startTimeSec: estimateTimeForPosition(startPosition, playEvents),
        endTimeSec: estimateTimeForPosition(endPosition, playEvents),
        playNotes: blockNotes.length
      };
    });
  }

  function emptyAnalysis() {
    return {
      playNotes: 0,
      firstMeasure: null,
      lastMeasure: null,
      firstPlayableMeasure: null,
      lastPlayableMeasure: null,
      displayFirstMeasure: null,
      displayLastMeasure: null,
      targetMeasureCount: 0,
      blockMode: "standardized_measure",
      lnPolicy: "count_start_only",
      densityBins: [],
      standardBlocks: [],
      fallback: false
    };
  }

  function analyzeBmsProgressTextSongEnd(text) {
    const bpmDefinitions = new Map();
    const stopDefinitions = new Map();
    const measureLengths = new Map();
    const measureCounts = new Map();
    const normalNoteEvents = [];
    const longNoteEvents = [];
    const timingEvents = [];
    const timeProgressMeasures = [];
    let initialBpm = defaultBpm;

    for (const rawLine of String(text || "").split(/\r?\n/)) {
      const line = rawLine.replace(/^\uFEFF/, "").trim();
      if (!line) {
        continue;
      }

      const indexedBpmMatch = line.match(/^#BPM([0-9A-Za-z]{2})\s+([0-9.]+)$/i);
      if (indexedBpmMatch) {
        const bpm = parseNumber(indexedBpmMatch[2]);
        if (bpm && bpm > 0) {
          bpmDefinitions.set(indexedBpmMatch[1].toUpperCase(), bpm);
        }
        continue;
      }

      const baseBpmMatch = line.match(/^#BPM\s+([0-9.]+)$/i);
      if (baseBpmMatch) {
        const bpm = parseNumber(baseBpmMatch[1]);
        if (bpm && bpm > 0) {
          initialBpm = bpm;
        }
        continue;
      }

      const stopMatch = line.match(/^#STOP([0-9A-Za-z]{2})\s+([0-9.]+)$/i);
      if (stopMatch) {
        const stopValue = parseNumber(stopMatch[2]);
        if (stopValue && stopValue > 0) {
          stopDefinitions.set(stopMatch[1].toUpperCase(), stopValue);
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

      if (!/^\d{2}$/.test(channel)) {
        continue;
      }

      if (hasTimeProgressData(channel, data)) {
        timeProgressMeasures.push(measure);
      }

      if (channel === "02") {
        const length = parseNumber(data);
        if (length && length > 0) {
          measureLengths.set(measure, length);
        }
        continue;
      }

      const pairs = splitDataObjects(data);
      if (pairs.length === 0) {
        continue;
      }

      for (const pair of pairs) {
        const fraction = pair.pairCount > 0 ? pair.pairIndex / pair.pairCount : 0;

        if (channel === "03") {
          const bpm = Number.parseInt(pair.objectId, 16);
          if (Number.isFinite(bpm) && bpm > 0) {
            timingEvents.push({ kind: "bpm", measure, fraction, value: bpm });
          }
          continue;
        }

        if (channel === "08") {
          const bpm = bpmDefinitions.get(pair.objectId);
          if (bpm && bpm > 0) {
            timingEvents.push({ kind: "bpm", measure, fraction, value: bpm });
          }
          continue;
        }

        if (channel === "09") {
          const stopValue = stopDefinitions.get(pair.objectId);
          if (stopValue && stopValue > 0) {
            timingEvents.push({ kind: "stop", measure, fraction, value: stopValue });
          }
          continue;
        }

        if (!isPlayNoteChannel(channel)) {
          continue;
        }

        const event = { measure, channel, fraction, pairIndex: pair.pairIndex, pairCount: pair.pairCount };
        if (isLongNoteChannel(channel)) {
          longNoteEvents.push(event);
        } else {
          normalNoteEvents.push(event);
          addMeasureNotes(measureCounts, measure, 1);
        }
      }
    }

    const provisionalMaxMeasure = Math.max(0, ...timeProgressMeasures, ...normalNoteEvents.map((event) => event.measure), ...longNoteEvents.map((event) => event.measure));
    const measureStarts = buildMeasureStarts(provisionalMaxMeasure, measureLengths);
    const preparedNormalNotes = normalNoteEvents.map((event) => ({
      ...event,
      standardPosition: getStandardPosition(event, measureStarts, measureLengths)
    }));
    const preparedLongNotes = longNoteEvents.map((event) => ({
      ...event,
      standardPosition: getStandardPosition(event, measureStarts, measureLengths)
    }));
    const playEvents = [...preparedNormalNotes, ...collectLongNoteStarts(preparedLongNotes, measureCounts)]
      .sort(comparePlayEvents);

    if (playEvents.length === 0) {
      return emptyAnalysis();
    }

    const firstPlayableMeasure = Math.min(...playEvents.map((event) => event.measure));
    const lastPlayableMeasure = Math.max(...playEvents.map((event) => event.measure));
    const displayFirstMeasure = firstPlayableMeasure;
    const displayLastMeasure = Math.max(
      lastPlayableMeasure,
      ...timeProgressMeasures.filter((measure) => measure >= displayFirstMeasure)
    );
    const maxMeasure = Math.max(provisionalMaxMeasure, displayLastMeasure);
    const displayMeasureStarts = buildMeasureStarts(maxMeasure, measureLengths);

    const playableEvents = playEvents.map((event) => ({
      ...event,
      standardPosition: getStandardPosition(event, displayMeasureStarts, measureLengths)
    })).sort(comparePlayEvents);

    try {
      applyTimingToNotes(playableEvents, timingEvents, maxMeasure, measureLengths, initialBpm);
    } catch (error) {
      console.error("[progress-map-timing] failed to estimate note timing", {
        code: "PROGRESS_MAP_TIMING_FALLBACK",
        message: error instanceof Error ? error.message : String(error)
      });
    }

    const firstStandardPosition = displayMeasureStarts[displayFirstMeasure];
    const displayEndPosition = displayMeasureStarts[displayLastMeasure] + getMeasureLength(displayLastMeasure, measureLengths);
    for (const event of playableEvents) {
      if (!Number.isFinite(event.timeSec)) {
        event.timeSec = (event.standardPosition - firstStandardPosition) * 2;
      }
    }

    const standardBlocks = buildStandardBlocks(
      playableEvents,
      displayMeasureStarts,
      measureLengths,
      maxMeasure,
      firstStandardPosition,
      displayEndPosition
    );

    return {
      playNotes: playableEvents.length,
      firstMeasure: displayFirstMeasure,
      lastMeasure: displayLastMeasure,
      firstPlayableMeasure,
      lastPlayableMeasure,
      displayFirstMeasure,
      displayLastMeasure,
      targetMeasureCount: displayLastMeasure - displayFirstMeasure + 1,
      blockMode: "standardized_measure",
      lnPolicy: "count_start_only",
      densityBins: buildDensityBins(playableEvents),
      standardBlocks,
      fallback: false
    };
  }

  window.analyzeBmsProgressText = analyzeBmsProgressTextSongEnd;
})();
