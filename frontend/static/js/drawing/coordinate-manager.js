/* coordinate-manager.js - central time/price coordinate service for drawings. */

(function () {
  class CoordinateManager {
    constructor(adapter = {}) {
      this.adapter = adapter;
      this.debugEnabled = false;
    }

    setAdapter(adapter = {}) {
      this.adapter = adapter;
    }

    getDevicePixelRatio() {
      return this.adapter.getDevicePixelRatio?.() || (typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1);
    }

    getChartBounds() {
      const rect = this.adapter.getContainerRect?.();
      if (!rect) return null;
      return {
        left: rect.left || 0,
        top: rect.top || 0,
        right: rect.right ?? (rect.left || 0) + rect.width,
        bottom: rect.bottom ?? (rect.top || 0) + rect.height,
        width: rect.width,
        height: rect.height,
      };
    }

    getCoordinateContext() {
      const containerRect = this.getChartBounds();
      const metrics = this.adapter.getMetrics?.(containerRect) || null;
      const windowState = this.adapter.getWindowState?.() || null;
      const plotRect = containerRect && metrics ? {
        left: 0,
        top: metrics.topPad || 0,
        right: metrics.chartWidth,
        bottom: containerRect.height - metrics.bottomAxis,
        width: metrics.chartWidth,
        height: Math.max(1, containerRect.height - metrics.bottomAxis - (metrics.topPad || 0)),
      } : null;
      return {
        containerRect,
        plotRect,
        width: containerRect?.width || 0,
        height: containerRect?.height || 0,
        devicePixelRatio: this.getDevicePixelRatio(),
        metrics,
        windowState,
        timeScale: {
          logicalStart: windowState?.logicalStart ?? 0,
          start: windowState?.start ?? 0,
          end: windowState?.end ?? 0,
          candleW: metrics?.candleW ?? 1,
          totalSlots: metrics?.totalSlots ?? 1,
        },
        priceScale: {
          hi: windowState?.hi ?? 1,
          lo: windowState?.lo ?? 0,
          topPad: metrics?.topPad ?? 0,
          priceHeight: metrics?.priceHeight ?? 1,
        },
      };
    }

    screenToContainer(x, y) {
      const rect = this.getChartBounds();
      if (!rect || !Number.isFinite(x) || !Number.isFinite(y)) return null;
      return { x: x - rect.left, y: y - rect.top };
    }

    containerToPlot(point) {
      const ctx = this.getCoordinateContext();
      if (!point || !ctx.plotRect) return null;
      return {
        x: point.x - ctx.plotRect.left,
        y: point.y - ctx.plotRect.top,
        inPlot: point.x >= ctx.plotRect.left
          && point.x <= ctx.plotRect.right
          && point.y >= ctx.plotRect.top
          && point.y <= ctx.plotRect.bottom,
      };
    }

    screenToPlot(x, y) {
      const container = this.screenToContainer(x, y);
      return this.containerToPlot(container);
    }

    screenToLogical(x, y) {
      const container = this.screenToContainer(x, y);
      if (!container) return null;
      return this.containerToLogical(container);
    }

    containerToLogical(point) {
      const ctx = this.getCoordinateContext();
      if (!ctx.containerRect || !ctx.metrics || !ctx.windowState || !point) return null;
      const clampedX = Math.max(0, Math.min(ctx.metrics.chartWidth, point.x));
      const clampedY = Math.max(ctx.metrics.topPad, Math.min(ctx.containerRect.height - ctx.metrics.bottomAxis, point.y));
      const indexFloat = this.xToIndex(clampedX, ctx);
      const timestamp = this.indexToTime(indexFloat);
      const price = this.yToPrice(clampedY, ctx);
      if (!Number.isFinite(timestamp) || !Number.isFinite(price)) return null;
      return {
        type: "time-price",
        time: timestamp,
        price,
        metadata: {
          candleIndex: Math.round(indexFloat),
          indexFloat,
          source: "coordinate-manager",
        },
      };
    }

    plotToLogical(point) {
      const ctx = this.getCoordinateContext();
      if (!ctx.plotRect || !point) return null;
      return this.containerToLogical({
        x: point.x + ctx.plotRect.left,
        y: point.y + ctx.plotRect.top,
      });
    }

    logicalToScreen(timeOrAnchor, price) {
      const container = this.logicalToContainer(timeOrAnchor, price);
      const rect = this.getChartBounds();
      if (!container || !rect) return null;
      return { x: rect.left + container.x, y: rect.top + container.y, offscreen: !!container.offscreen };
    }

    logicalToPlot(timeOrAnchor, price) {
      const container = this.logicalToContainer(timeOrAnchor, price);
      const ctx = this.getCoordinateContext();
      if (!container || !ctx.plotRect) return null;
      return {
        x: container.x - ctx.plotRect.left,
        y: container.y - ctx.plotRect.top,
        offscreen: !!container.offscreen,
      };
    }

    logicalToContainer(timeOrAnchor, price) {
      const ctx = this.getCoordinateContext();
      if (!ctx.containerRect || !ctx.metrics || !ctx.windowState) return null;
      const anchor = typeof timeOrAnchor === "object" ? timeOrAnchor : { time: timeOrAnchor, timestamp: timeOrAnchor, price };
      const normalized = this.normalizeAnchor(anchor, { allowIncomplete: false });
      if (!normalized) return null;
      const x = this.timeToX(normalized.time, ctx);
      const y = this.priceToY(normalized.price, ctx);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      return {
        x,
        y,
        offscreen: x < 0 || x > ctx.metrics.chartWidth || y < ctx.metrics.topPad || y > ctx.containerRect.height - ctx.metrics.bottomAxis,
      };
    }

    timeToX(time, context = this.getCoordinateContext()) {
      const timestamp = this.timeToTimestamp(time);
      const index = this.timeToIndex(timestamp);
      if (!Number.isFinite(index) || !context?.metrics || !context.windowState) return null;
      return (index - context.windowState.logicalStart) * context.metrics.candleW + context.metrics.candleW * 0.5;
    }

    priceToY(price, context = this.getCoordinateContext()) {
      const p = this.normalizePrice(price);
      if (!Number.isFinite(p) || !context?.metrics || !context.windowState) return null;
      const range = context.windowState.hi - context.windowState.lo || 1;
      const ySpan = Math.max(1, context.metrics.priceHeight - context.metrics.topPad);
      return context.metrics.topPad + ((context.windowState.hi - p) / range) * ySpan;
    }

    xToTime(x, context = this.getCoordinateContext()) {
      const index = this.xToIndex(x, context);
      return this.indexToTime(index);
    }

    yToPrice(y, context = this.getCoordinateContext()) {
      if (!context?.metrics || !context.windowState || !Number.isFinite(y)) return null;
      const range = context.windowState.hi - context.windowState.lo || 1;
      const ySpan = Math.max(1, context.metrics.priceHeight - context.metrics.topPad);
      return context.windowState.hi - ((y - context.metrics.topPad) / ySpan) * range;
    }

    xToIndex(x, context = this.getCoordinateContext()) {
      if (!context?.metrics || !context.windowState || !Number.isFinite(x)) return null;
      return context.windowState.logicalStart + (x / Math.max(1, context.metrics.candleW)) - 0.5;
    }

    timeToIndex(time) {
      const timestamp = this.timeToTimestamp(time);
      if (!Number.isFinite(timestamp)) return null;
      const candles = this.adapter.getCandles?.() || [];
      if (!candles.length) return null;
      let lo = 0;
      let hi = candles.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (this.timeToTimestamp(candles[mid].time ?? candles[mid].date) < timestamp) lo = mid + 1;
        else hi = mid;
      }
      const at = i => this.timeToTimestamp(candles[i].time ?? candles[i].date);
      if (!this.adapter.continuousTime) {
        if (lo > 0 && Math.abs(at(lo - 1) - timestamp) < Math.abs(at(lo) - timestamp)) lo--;
        return lo;
      }
      const step = this.adapter.getTimeframeMs?.() || (candles.length > 1 ? at(1) - at(0) : 60000);
      if (timestamp < at(0)) return (timestamp - at(0)) / step;
      if (timestamp > at(candles.length - 1)) return candles.length - 1 + (timestamp - at(candles.length - 1)) / step;
      if (lo === 0 || timestamp === at(lo)) return lo;
      return lo - 1 + (timestamp - at(lo - 1)) / (at(lo) - at(lo - 1) || step);
    }

    indexToTime(index) {
      const candles = this.adapter.getCandles?.() || [];
      if (!candles.length || !Number.isFinite(index)) return null;
      if (!this.adapter.continuousTime) {
        const rounded = Math.max(0, Math.min(candles.length - 1, Math.round(index)));
        return this.timeToTimestamp(candles[rounded].time ?? candles[rounded].date);
      }
      const at = i => this.timeToTimestamp(candles[i].time ?? candles[i].date);
      const step = this.adapter.getTimeframeMs?.() || (candles.length > 1 ? at(1) - at(0) : 60000);
      if (index < 0) return at(0) + index * step;
      if (index >= candles.length - 1) return at(candles.length - 1) + (index - candles.length + 1) * step;
      const left = Math.floor(index);
      return at(left) + (index - left) * (at(left + 1) - at(left));
    }

    normalizeTime(value) {
      return this.timeToTimestamp(value);
    }

    toChartTime(value) {
      return Math.floor(this.timeToTimestamp(value) / 1000);
    }

    fromChartTime(value) {
      if (typeof value === "object" && value && "timestamp" in value) return value.timestamp * 1000;
      if (typeof value === "number" && value < 100000000000) return value * 1000;
      return this.timeToTimestamp(value);
    }

    timeToTimestamp(value) {
      if (value instanceof Date) return value.getTime();
      if (typeof value === "number") return value < 100000000000 ? value * 1000 : value;
      if (typeof value === "string") {
        const parsed = Date.parse(value);
        return Number.isFinite(parsed) ? parsed : null;
      }
      if (value && typeof value === "object") {
        if (Number.isFinite(value.time)) return this.timeToTimestamp(value.time);
        if (Number.isFinite(value.timestamp)) return this.timeToTimestamp(value.timestamp);
      }
      return null;
    }

    timestampToTime(timestamp) {
      return this.timeToTimestamp(timestamp);
    }

    normalizePrice(price) {
      const numeric = typeof price === "string" ? Number(price) : price;
      return Number.isFinite(numeric) ? numeric : null;
    }

    validatePrice(price) {
      const numeric = this.normalizePrice(price);
      return Number.isFinite(numeric) && Math.abs(numeric) < 1e12;
    }

    createAnchor(time, price, metadata = {}) {
      const anchor = {
        type: "time-price",
        time: this.normalizeTime(time),
        price: this.normalizePrice(price),
        metadata: { ...metadata },
      };
      return this.validateAnchor(anchor) ? anchor : null;
    }

    normalizeAnchor(anchor = {}, options = {}) {
      let time = this.normalizeTime(anchor.time ?? anchor.timestamp ?? anchor.date);
      if (time == null && Number.isFinite(anchor.index)) {
        const candles = this.adapter.getCandles?.() || [];
        const candle = candles[Math.max(0, Math.min(candles.length - 1, Math.round(anchor.index)))];
        time = this.normalizeTime(candle?.time ?? candle?.date);
      }
      const price = this.normalizePrice(anchor.price);
      if ((time == null || price == null) && options.allowIncomplete) {
        return { type: "time-price", time, price, metadata: { ...(anchor.metadata || {}) } };
      }
      const normalized = {
        ...anchor,
        type: "time-price",
        time,
        timestamp: time,
        price,
        metadata: {
          ...(anchor.metadata || {}),
          candleIndex: anchor.metadata?.candleIndex ?? anchor.candleIndex ?? anchor.index,
        },
      };
      return this.validateAnchor(normalized) ? normalized : null;
    }

    validateAnchor(anchor, options = {}) {
      if (!anchor) return false;
      if (options.allowIncomplete && (anchor.time == null || anchor.price == null)) return true;
      return Number.isFinite(this.timeToTimestamp(anchor.time ?? anchor.timestamp))
        && this.validatePrice(anchor.price);
    }

    getAnchorScreenPosition(anchor) {
      return this.logicalToScreen(anchor);
    }

    getAnchorLogicalPosition(screenPoint) {
      if (!screenPoint) return null;
      return this.screenToLogical(screenPoint.x, screenPoint.y);
    }

    updateAnchor(anchor, changes = {}) {
      return this.normalizeAnchor({ ...anchor, ...changes });
    }

    serializeAnchor(anchor) {
      const normalized = this.normalizeAnchor(anchor);
      return normalized ? {
        type: "time-price",
        time: normalized.time,
        timestamp: normalized.time,
        price: normalized.price,
        metadata: { ...(normalized.metadata || {}) },
      } : null;
    }

    deserializeAnchor(data) {
      return this.normalizeAnchor(data);
    }

    validateCoordinate(point) {
      return !!point && Number.isFinite(point.x) && Number.isFinite(point.y);
    }

    setDebug(enabled) {
      this.debugEnabled = !!enabled;
    }

    getDebugSnapshot(screenPoint = null) {
      const logical = screenPoint ? this.getAnchorLogicalPosition(screenPoint) : null;
      const ctx = this.getCoordinateContext();
      return {
        screen: screenPoint,
        logical,
        devicePixelRatio: ctx.devicePixelRatio,
        container: ctx.containerRect ? { width: ctx.containerRect.width, height: ctx.containerRect.height } : null,
        plot: ctx.plotRect ? { width: ctx.plotRect.width, height: ctx.plotRect.height } : null,
      };
    }
  }

  window.IntenseDrawing = window.IntenseDrawing || {};
  window.IntenseDrawing.CoordinateManager = CoordinateManager;
})();
