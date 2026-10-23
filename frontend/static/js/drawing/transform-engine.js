/* transform-engine.js - logical move, resize, and handle geometry for drawings. */

(function () {
  const { DrawingTypes = {} } = window.IntenseDrawing || {};

  const TransformStates = Object.freeze({
    IDLE: "IDLE",
    MOVING: "MOVING",
    RESIZING: "RESIZING",
    ROTATING: "ROTATING",
    CANCELLED: "CANCELLED",
    COMMITTED: "COMMITTED",
  });

  const LEGACY_TYPE = {
    trendLine: DrawingTypes.TREND_LINE,
    horizontalLine: DrawingTypes.HORIZONTAL_LINE,
    verticalLine: DrawingTypes.VERTICAL_LINE,
    rectangle: DrawingTypes.RECTANGLE,
    ellipse: DrawingTypes.ELLIPSE,
    };

  class TransformEngine {
    constructor(engine, options = {}) {
      this.engine = engine;
      this.handleSize = options.handleSize || 10;
      this.hitTolerance = options.hitTolerance || 10;
      this.state = TransformStates.IDLE;
      this.operation = null;
    }

    getHandles(drawing) {
      if (!drawing?.anchors?.length || drawing.locked) return [];
      const type = this.normalizeType(drawing.type || drawing.properties?.legacyType);
      if ([DrawingTypes.LONG_POSITION, DrawingTypes.SHORT_POSITION].includes(type)) return this.getPositionHandles(drawing);
      if ([DrawingTypes.RECTANGLE, DrawingTypes.ELLIPSE].includes(type) && drawing.anchors.length >= 2) return this.getRectangleHandles(drawing);
      return this.getAnchorHandles(drawing);
    }

    getAnchorHandles(drawing) {
      return (drawing.anchors || []).map((anchor, index) => {
        const screen = this.project(anchor);
        return screen ? {
          id: `anchor-${index}`,
          kind: "anchor",
          drawingId: drawing.id,
          anchorIndex: index,
          cursor: this.cursorForAnchor(drawing, index),
          screen,
          logical: anchor,
        } : null;
      }).filter(Boolean);
    }

    getRectangleHandles(drawing) {
      const [a, b] = drawing.anchors;
      const pa = this.project(a);
      const pb = this.project(b);
      if (!pa || !pb) return [];
      const left = Math.min(pa.x, pb.x);
      const right = Math.max(pa.x, pb.x);
      const top = Math.min(pa.y, pb.y);
      const bottom = Math.max(pa.y, pb.y);
      const midX = (left + right) / 2;
      const midY = (top + bottom) / 2;
      return [
        ["nw", left, top, "nwse-resize"],
        ["n", midX, top, "ns-resize"],
        ["ne", right, top, "nesw-resize"],
        ["e", right, midY, "ew-resize"],
        ["se", right, bottom, "nwse-resize"],
        ["s", midX, bottom, "ns-resize"],
        ["sw", left, bottom, "nesw-resize"],
        ["w", left, midY, "ew-resize"],
      ].map(([id, x, y, cursor]) => ({
        id,
        kind: "resize",
        drawingId: drawing.id,
        cursor,
        screen: { x, y },
        metadata: { rect: { left, right, top, bottom } },
      }));
    }

    getPositionHandles(drawing) {
      const geometry = this.positionGeometry(drawing);
      if (!geometry) return [];
      const mk = (id, time, price, cursor) => {
        const logical = this.engine.coordinateManager.createAnchor(time, price, { role: id });
        const screen = logical ? this.project(logical) : null;
        return screen ? { id, kind: "resize", drawingId: drawing.id, cursor, screen, logical } : null;
      };
      return [
        mk("target", geometry.timeRange.start, geometry.takeProfit.price, "ns-resize"),
        mk("entry", geometry.timeRange.start, geometry.entry.price, "ns-resize"),
        mk("stop", geometry.timeRange.start, geometry.stopLoss.price, "ns-resize"),
        mk("start", geometry.timeRange.start, (geometry.stopLoss.price + geometry.entry.price) / 2, "ew-resize"),
        mk("end", geometry.timeRange.end, geometry.entry.price, "ew-resize"),
      ].filter(Boolean);
    }

    hitTestHandle(drawing, point) {
      const handles = this.getHandles(drawing);
      let best = null;
      handles.forEach((handle) => {
        const distance = Math.hypot(point.x - handle.screen.x, point.y - handle.screen.y);
        if (distance <= this.hitTolerance && (!best || distance < best.distance)) best = { ...handle, distance };
      });
      return best;
    }

    startTransform(hit, pointerLogical) {
      if (!hit?.drawing || hit.drawing.locked || !pointerLogical) return false;
      const drawing = this.engine.getDrawing(hit.drawing.id) || hit.drawing;
      const selectedIds = hit.hitType === "handle" || hit.hitType === "anchor" ? [drawing.id] : this.engine.state.selectedDrawingIds;
      const ids = selectedIds.length ? selectedIds : [drawing.id];
      this.operation = {
        mode: hit.hitType === "handle" || hit.hitType === "anchor" ? "resize" : "move",
        handle: hit.handle || null,
        ids,
        startLogical: { ...pointerLogical },
        lastLogical: { ...pointerLogical },
        before: ids.map((id) => this.engine.getDrawing(id)).filter(Boolean),
      };
      this.state = this.operation.mode === "resize" ? TransformStates.RESIZING : TransformStates.MOVING;
      return true;
    }

    updateTransform(pointerLogical, options = {}) {
      if (!this.operation || !pointerLogical) return false;
      const snap = this.engine.snapLogical?.(pointerLogical, {
        operation: this.operation.mode,
        excludeDrawingId: this.operation.ids.length === 1 ? this.operation.ids[0] : null,
        disableForGroupMove: this.operation.mode === "move",
        selectedCount: this.operation.ids.length,
        event: options.event,
      });
      const activeLogical = snap?.snapped ? snap.logical : pointerLogical;
      if (this.operation.mode === "resize") return this.updateResize(activeLogical, snap);
      return this.updateMove(activeLogical);
    }

    updateMove(pointerLogical) {
      const previous = this.operation.lastLogical;
      const deltaTime = Number(pointerLogical.time) - Number(previous.time);
      const deltaPrice = Number(pointerLogical.price) - Number(previous.price);
      this.operation.ids.forEach((id) => {
        const drawing = this.engine.getDrawing(id);
        if (!drawing || drawing.locked) return;
      const type = this.normalizeType(drawing.type || drawing.properties?.legacyType);
      const anchors = (drawing.anchors || []).map((anchor) => this.engine.coordinateManager.createAnchor(
          type === DrawingTypes.HORIZONTAL_LINE ? Number(anchor.time ?? anchor.timestamp) : Number(anchor.time ?? anchor.timestamp) + deltaTime,
          type === DrawingTypes.VERTICAL_LINE ? Number(anchor.price) : Number(anchor.price) + deltaPrice,
          { ...(anchor.metadata || {}), source: "transform-move" },
        )).filter(Boolean);
        const changes = { anchors };
        if ([DrawingTypes.LONG_POSITION, DrawingTypes.SHORT_POSITION].includes(type)) {
          changes.geometry = this.movePositionGeometry(drawing, deltaTime, deltaPrice);
        }
        this.engine.updateDrawing(id, changes);
      });
      this.operation.lastLogical = { ...pointerLogical };
      return true;
    }

    updateResize(pointerLogical, snap) {
      const id = this.operation.ids[0];
      const drawing = this.engine.getDrawing(id);
      if (!drawing || drawing.locked) return false;
      const type = this.normalizeType(drawing.type || drawing.properties?.legacyType);
      const handle = this.operation.handle;
      let anchors;
      let geometry = null;
      if ([DrawingTypes.LONG_POSITION, DrawingTypes.SHORT_POSITION].includes(type) && handle?.kind === "resize") {
        geometry = this.resizePositionGeometry(drawing, handle.id, pointerLogical);
        anchors = this.positionAnchors(geometry);
      } else
      if ([DrawingTypes.RECTANGLE, DrawingTypes.ELLIPSE].includes(type) && drawing.anchors.length >= 2 && handle?.kind === "resize") {
        anchors = this.resizeRectangle(drawing, handle.id, pointerLogical);
      } else {
        const anchorIndex = Number.isFinite(handle?.anchorIndex) ? handle.anchorIndex : 0;
        const resizeTime = type === DrawingTypes.HORIZONTAL_LINE ? drawing.anchors[anchorIndex]?.time ?? drawing.anchors[anchorIndex]?.timestamp : pointerLogical.time;
        const resizePrice = type === DrawingTypes.VERTICAL_LINE ? drawing.anchors[anchorIndex]?.price : pointerLogical.price;
        anchors = (drawing.anchors || []).map((anchor, index) => (
          index === anchorIndex
            ? this.engine.coordinateManager.createAnchor(resizeTime, resizePrice, { ...(anchor.metadata || {}), source: "transform-anchor", snap: snap?.snapped ? snap.snapType : null })
            : anchor
        ));
      }
      this.engine.updateDrawing(id, { anchors: anchors.filter(Boolean), ...(geometry ? { geometry } : {}) });
      return true;
    }

    positionGeometry(drawing) {
      const anchors = drawing.anchors || [];
      const entry = drawing.geometry?.entry || anchors.find((a) => a.metadata?.role === "entry") || anchors[0];
      const stop = drawing.geometry?.stopLoss || anchors.find((a) => a.metadata?.role === "stop") || anchors[1];
      const target = drawing.geometry?.takeProfit || anchors.find((a) => a.metadata?.role === "target") || anchors[2];
      const start = drawing.geometry?.timeRange?.start ?? anchors.find((a) => a.metadata?.role === "start")?.time ?? anchors[3]?.time ?? entry?.time;
      const end = drawing.geometry?.timeRange?.end ?? anchors.find((a) => a.metadata?.role === "end")?.time ?? anchors[4]?.time ?? entry?.time;
      if (!entry || !stop || !target) return null;
      return {
        direction: [DrawingTypes.SHORT_POSITION, 'shortPosition'].includes(drawing.type) ? "short" : "long",
        entry: { time: Number(entry.time ?? entry.timestamp), price: Number(entry.price) },
        stopLoss: { price: Number(stop.price) },
        takeProfit: { price: Number(target.price) },
        timeRange: { start: Number(start), end: Number(end) },
      };
    }

    positionAnchors(geometry) {
      if (!geometry) return [];
      return [
        this.engine.coordinateManager.createAnchor(geometry.entry.time, geometry.entry.price, { role: "entry" }),
        this.engine.coordinateManager.createAnchor(geometry.entry.time, geometry.stopLoss.price, { role: "stop" }),
        this.engine.coordinateManager.createAnchor(geometry.entry.time, geometry.takeProfit.price, { role: "target" }),
        this.engine.coordinateManager.createAnchor(geometry.timeRange.start, geometry.entry.price, { role: "start" }),
        this.engine.coordinateManager.createAnchor(geometry.timeRange.end, geometry.entry.price, { role: "end" }),
      ].filter(Boolean);
    }

    movePositionGeometry(drawing, deltaTime, deltaPrice) {
      const geometry = this.positionGeometry(drawing);
      if (!geometry) return drawing.geometry || null;
      return {
        ...geometry,
        entry: { time: geometry.entry.time + deltaTime, price: geometry.entry.price + deltaPrice },
        stopLoss: { price: geometry.stopLoss.price + deltaPrice },
        takeProfit: { price: geometry.takeProfit.price + deltaPrice },
        timeRange: { start: geometry.timeRange.start + deltaTime, end: geometry.timeRange.end + deltaTime },
      };
    }

    resizePositionGeometry(drawing, handleId, pointerLogical) {
      const geometry = this.positionGeometry(drawing);
      if (!geometry) return drawing.geometry || null;
      const isShort = geometry.direction === "short" || drawing.type === DrawingTypes.SHORT_POSITION;
      const next = {
        ...geometry,
        entry: { ...geometry.entry },
        stopLoss: { ...geometry.stopLoss },
        takeProfit: { ...geometry.takeProfit },
        timeRange: { ...geometry.timeRange },
      };
      const minDistance = Math.max(Math.abs(next.entry.price) * 0.00001, 0.00001);
      if (handleId === "entry") {
        // Entry is independent. Moving the body is the operation that translates all levels.
        const low = Math.min(next.stopLoss.price, next.takeProfit.price) + minDistance;
        const high = Math.max(next.stopLoss.price, next.takeProfit.price) - minDistance;
        if (low < high) next.entry.price = Math.max(low, Math.min(high, Number(pointerLogical.price)));
      } else if (handleId === "stop") {
        next.stopLoss.price = Number(pointerLogical.price);
      } else if (handleId === "target") {
        next.takeProfit.price = Number(pointerLogical.price);
      } else if (handleId === "start") {
        next.timeRange.start = Math.min(Number(pointerLogical.time), next.timeRange.end - 1);
      } else if (handleId === "end") {
        next.timeRange.end = Math.max(Number(pointerLogical.time), next.timeRange.start + 1);
      }
      if (isShort) {
        next.stopLoss.price = Math.max(next.stopLoss.price, next.entry.price + minDistance);
        next.takeProfit.price = Math.min(next.takeProfit.price, next.entry.price - minDistance);
      } else {
        next.stopLoss.price = Math.min(next.stopLoss.price, next.entry.price - minDistance);
        next.takeProfit.price = Math.max(next.takeProfit.price, next.entry.price + minDistance);
      }
      if (next.timeRange.start > next.timeRange.end) {
        const swap = next.timeRange.start;
        next.timeRange.start = next.timeRange.end;
        next.timeRange.end = swap;
      }
      return next;
    }

    resizeRectangle(drawing, handleId, pointerLogical) {
      const [a, b] = drawing.anchors;
      let leftTime = Math.min(a.time ?? a.timestamp, b.time ?? b.timestamp);
      let rightTime = Math.max(a.time ?? a.timestamp, b.time ?? b.timestamp);
      let topPrice = Math.max(a.price, b.price);
      let bottomPrice = Math.min(a.price, b.price);
      if (handleId.includes("w")) leftTime = pointerLogical.time;
      if (handleId.includes("e")) rightTime = pointerLogical.time;
      if (handleId.includes("n")) topPrice = pointerLogical.price;
      if (handleId.includes("s")) bottomPrice = pointerLogical.price;
      if (handleId === "n") topPrice = pointerLogical.price;
      if (handleId === "s") bottomPrice = pointerLogical.price;
      if (handleId === "e") rightTime = pointerLogical.time;
      if (handleId === "w") leftTime = pointerLogical.time;
      const minTime = Math.min(leftTime, rightTime);
      const maxTime = Math.max(leftTime, rightTime);
      const minPrice = Math.min(bottomPrice, topPrice);
      const maxPrice = Math.max(bottomPrice, topPrice);
      return [
        this.engine.coordinateManager.createAnchor(minTime, maxPrice, { source: "transform-rect-a" }),
        this.engine.coordinateManager.createAnchor(maxTime, minPrice, { source: "transform-rect-b" }),
      ];
    }

    commitTransform() {
      if (!this.operation) return null;
      const result = {
        mode: this.operation.mode,
        drawingIds: [...this.operation.ids],
        before: this.operation.before,
        after: this.operation.ids.map((id) => this.engine.getDrawing(id)).filter(Boolean),
      };
      this.operation = null;
      this.state = TransformStates.COMMITTED;
      return result;
    }

    cancelTransform() {
      if (!this.operation) return false;
      this.operation.before.forEach((drawing) => this.engine.updateDrawing(drawing.id, drawing));
      this.operation = null;
      this.state = TransformStates.CANCELLED;
      return true;
    }

    project(anchor) {
      return this.engine.coordinateManager?.logicalToScreen?.(anchor.time ?? anchor.timestamp, anchor.price) || null;
    }

    cursorForAnchor(drawing) {
      const type = this.normalizeType(drawing.type || drawing.properties?.legacyType);
      if (type === DrawingTypes.HORIZONTAL_LINE) return "ns-resize";
      if (type === DrawingTypes.VERTICAL_LINE) return "ew-resize";
      return "move";
    }

    normalizeType(type) {
      return window.IntenseDrawing.LegacyDrawingTypeMap?.[type] || LEGACY_TYPE[type] || type;
    }
  }

  window.IntenseDrawing = window.IntenseDrawing || {};
  window.IntenseDrawing.TransformStates = TransformStates;
  window.IntenseDrawing.TransformEngine = TransformEngine;
})();
