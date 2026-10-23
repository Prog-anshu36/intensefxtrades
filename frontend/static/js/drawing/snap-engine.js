/* snap-engine.js - professional magnet snapping for logical drawing anchors. */

(function () {
  const { DrawingEvents = {}, DrawingTypes = {} } = window.IntenseDrawing || {};

  const SnapCandidateTypes = Object.freeze({
    DRAWING_ANCHOR: "drawing-anchor",
    CANDLE_HIGH: "candle-high",
    CANDLE_LOW: "candle-low",
    CANDLE_OPEN: "candle-open",
    CANDLE_CLOSE: "candle-close",
    CANDLE_TIME: "candle-time",
    HORIZONTAL_LINE: "horizontal-line",
    VERTICAL_LINE: "vertical-line",
  });

  const SnapConfig = Object.freeze({
    thresholdPx: 12,
    releaseThresholdPx: 18,
    candidateCandleRadius: 6,
    priorities: Object.freeze({
      [SnapCandidateTypes.DRAWING_ANCHOR]: 0,
      [SnapCandidateTypes.CANDLE_HIGH]: 1,
      [SnapCandidateTypes.CANDLE_LOW]: 1,
      [SnapCandidateTypes.CANDLE_OPEN]: 2,
      [SnapCandidateTypes.CANDLE_CLOSE]: 2,
      [SnapCandidateTypes.HORIZONTAL_LINE]: 1.5,
      [SnapCandidateTypes.VERTICAL_LINE]: 1.5,
      [SnapCandidateTypes.CANDLE_TIME]: 5,
    }),
    labels: Object.freeze({
      [SnapCandidateTypes.DRAWING_ANCHOR]: "Anchor",
      [SnapCandidateTypes.CANDLE_HIGH]: "High",
      [SnapCandidateTypes.CANDLE_LOW]: "Low",
      [SnapCandidateTypes.CANDLE_OPEN]: "Open",
      [SnapCandidateTypes.CANDLE_CLOSE]: "Close",
      [SnapCandidateTypes.CANDLE_TIME]: "Time",
      [SnapCandidateTypes.HORIZONTAL_LINE]: "H-Line",
      [SnapCandidateTypes.VERTICAL_LINE]: "V-Line",
    }),
  });

  function unsnapped(position, reason = "disabled") {
    return {
      snapped: false,
      reason,
      logical: position || null,
      candidate: null,
      candidates: [],
      distancePx: Infinity,
    };
  }

  class SnapEngine {
    constructor(engine, options = {}) {
      this.engine = engine;
      this.config = { ...SnapConfig, ...(options.config || {}) };
      this.lastResult = unsnapped(null);
      this.debug = !!options.debug;
    }

    setMagnetEnabled(enabled) {
      const next = !!enabled;
      this.engine.state.magnetEnabled = next;
      if (!next) this.clearSnap();
      this.engine.events?.emit?.(DrawingEvents.MAGNET_CHANGED, { magnetEnabled: next });
      return next;
    }

    isEnabled(event = null) {
      const base = !!this.engine.state.magnetEnabled;
      if (event?.altKey) return !base;
      return base;
    }

    snap(position, options = {}) {
      if (!position) return this.storeResult(unsnapped(position, "no-position"));
      if (!this.isEnabled(options.event)) return this.storeResult(unsnapped(position, "magnet-off"));
      if (options.disableForGroupMove && options.selectedCount > 1) return this.storeResult(unsnapped(position, "group-move"));
      const candidates = this.getSnapCandidates(position, options);
      const best = this.findBestSnap(position, candidates);
      if (!best) return this.storeResult(unsnapped(position, "no-candidate"));
      return this.storeResult({
        snapped: true,
        logical: best.logical,
        originalLogical: position,
        candidate: best,
        candidates,
        distancePx: best.distancePx,
        snapType: best.type,
        label: this.config.labels[best.type] || best.type,
      });
    }

    getSnapCandidates(position, options = {}) {
      const candidates = [
        ...this.getCandleCandidates(position),
        ...this.getDrawingAnchorCandidates(position, options),
        ...this.getLineLevelCandidates(position, options),
      ];
      return candidates.filter((candidate) => Number.isFinite(candidate.distancePx));
    }

    findBestSnap(position, candidates = []) {
      if (!candidates.length) return null;
      const valid = candidates.filter((candidate) => candidate.distancePx <= this.thresholdForCandidate(candidate));
      if (!valid.length) return null;
      return valid.sort((a, b) => (
        a.score - b.score ||
        a.distancePx - b.distancePx ||
        (a.priority ?? 99) - (b.priority ?? 99)
      ))[0];
    }

    getCandleCandidates(position) {
      const ctx = this.engine.coordinateManager.getCoordinateContext();
      const candles = this.engine.coordinateManager.adapter.getCandles?.() || [];
      if (!ctx?.metrics || !ctx.windowState || !candles.length) return [];
      const indexFloat = position.metadata?.indexFloat ?? this.engine.coordinateManager.timeToIndex(position.time);
      const center = Math.round(indexFloat);
      const min = Math.max(ctx.windowState.start || 0, center - this.config.candidateCandleRadius);
      const replayLimit = this.engine.options.getReplayLimit?.();
      const maxVisible = Number.isFinite(replayLimit) ? replayLimit : (ctx.windowState.end ?? candles.length - 1);
      const max = Math.min(maxVisible, candles.length - 1, center + this.config.candidateCandleRadius);
      const result = [];
      for (let i = min; i <= max; i += 1) {
        const candle = candles[i];
        if (!candle) continue;
        const time = candle.date?.getTime?.() ?? candle.time;
        [["open", SnapCandidateTypes.CANDLE_OPEN], ["high", SnapCandidateTypes.CANDLE_HIGH], ["low", SnapCandidateTypes.CANDLE_LOW], ["close", SnapCandidateTypes.CANDLE_CLOSE]].forEach(([field, type]) => {
          if (!Number.isFinite(candle[field])) return;
          result.push(this.makeCandidate(type, { time, price: candle[field] }, position, { candleIndex: i, field }));
        });
        result.push(this.makeCandidate(SnapCandidateTypes.CANDLE_TIME, { time, price: position.price, partial: "time" }, position, { candleIndex: i }));
      }
      return result;
    }

    getDrawingAnchorCandidates(position, options = {}) {
      const excludeId = options.excludeDrawingId || null;
      return this.engine.getDrawings((drawing) => drawing.visible !== false && drawing.id !== excludeId)
        .flatMap((drawing) => (drawing.anchors || []).map((anchor, anchorIndex) => (
          this.makeCandidate(SnapCandidateTypes.DRAWING_ANCHOR, {
            time: anchor.time ?? anchor.timestamp,
            price: anchor.price,
          }, position, { drawingId: drawing.id, anchorIndex })
        )));
    }

    getLineLevelCandidates(position, options = {}) {
      const excludeId = options.excludeDrawingId || null;
      return this.engine.getDrawings((drawing) => drawing.visible !== false && drawing.id !== excludeId)
        .flatMap((drawing) => {
          const type = drawing.properties?.legacyType === "horizontalLine" ? DrawingTypes.HORIZONTAL_LINE
            : drawing.properties?.legacyType === "verticalLine" ? DrawingTypes.VERTICAL_LINE
              : drawing.type;
          const anchor = drawing.anchors?.[0];
          if (!anchor) return [];
          if (type === DrawingTypes.HORIZONTAL_LINE) {
            return [this.makeCandidate(SnapCandidateTypes.HORIZONTAL_LINE, {
              time: position.time,
              price: anchor.price,
              partial: "price",
            }, position, { drawingId: drawing.id })];
          }
          if (type === DrawingTypes.VERTICAL_LINE) {
            return [this.makeCandidate(SnapCandidateTypes.VERTICAL_LINE, {
              time: anchor.time ?? anchor.timestamp,
              price: position.price,
              partial: "time",
            }, position, { drawingId: drawing.id })];
          }
          return [];
        });
    }

    makeCandidate(type, logicalSeed, original, metadata = {}) {
      const logical = this.engine.coordinateManager.createAnchor(logicalSeed.time, logicalSeed.price, {
        ...metadata,
        snapType: type,
        partial: logicalSeed.partial || "both",
      });
      const originalScreen = this.screenForPosition(original);
      const candidateScreen = this.engine.coordinateManager.logicalToScreen(logical);
      const distancePx = originalScreen && candidateScreen ? Math.hypot(originalScreen.x - candidateScreen.x, originalScreen.y - candidateScreen.y) : Infinity;
      const priority = this.config.priorities[type] ?? 99;
      return {
        type,
        logical,
        screen: candidateScreen,
        distancePx,
        priority,
        score: distancePx + priority * 3,
        metadata,
      };
    }

    thresholdForCandidate(candidate) {
      const base = this.lastResult?.snapped ? this.config.releaseThresholdPx : this.config.thresholdPx;
      if (candidate.type === SnapCandidateTypes.CANDLE_TIME) {
        const candleW = this.engine.coordinateManager.getCoordinateContext()?.metrics?.candleW || base;
        return Math.min(base, Math.max(3, candleW * 0.45));
      }
      return base;
    }

    screenForPosition(position) {
      if (!position) return null;
      const ctx = this.engine.coordinateManager.getCoordinateContext();
      const rect = ctx?.containerRect;
      if (Number.isFinite(position.metadata?.indexFloat) && Number.isFinite(position.price) && ctx?.metrics && ctx.windowState && rect) {
        const x = (position.metadata.indexFloat - ctx.windowState.logicalStart) * ctx.metrics.candleW + ctx.metrics.candleW * 0.5;
        const y = this.engine.coordinateManager.priceToY(position.price, ctx);
        return Number.isFinite(x) && Number.isFinite(y) ? { x: rect.left + x, y: rect.top + y } : null;
      }
      return this.engine.coordinateManager.logicalToScreen(position);
    }

    storeResult(result) {
      this.lastResult = result;
      this.engine.state.snapResult = result;
      this.engine.events?.emit?.(result.snapped ? DrawingEvents.SNAP_CHANGED : DrawingEvents.SNAP_CLEARED, result);
      return result;
    }

    getSnapResult() {
      return this.lastResult;
    }

    clearSnap() {
      return this.storeResult(unsnapped(null, "cleared"));
    }

    isSnapped() {
      return !!this.lastResult?.snapped;
    }

    setDebug(enabled) {
      this.debug = !!enabled;
    }
  }

  window.IntenseDrawing = window.IntenseDrawing || {};
  window.IntenseDrawing.SnapCandidateTypes = SnapCandidateTypes;
  window.IntenseDrawing.SnapConfig = SnapConfig;
  window.IntenseDrawing.SnapEngine = SnapEngine;
})();
