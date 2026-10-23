/* drawing-manager.js - controlled collection owner for drawing objects. */

(function () {
  const {
    DrawingEvents = {},
    DrawingObjectFactory,
    cloneDrawingValue,
  } = window.IntenseDrawing || {};

  class DrawingManager {
    constructor(options = {}) {
      this.factory = options.factory || new DrawingObjectFactory();
      this.events = options.events || null;
      this.drawings = new Map();
    }

    createDrawing(type, attrs = {}, options = {}) {
      if (this.engine && !options.direct) return this.engine.createDrawing(type, attrs);
      const drawing = this.factory.create(type, attrs);
      this.registerDrawing(drawing);
      this.events?.emit?.(DrawingEvents.DRAWING_CREATED, { drawingId: drawing.id, type: drawing.type, drawing: this.getDrawing(drawing.id) });
      return this.getDrawing(drawing.id);
    }

    registerDrawing(drawing) {
      if (!drawing?.id) throw new Error("Drawing must have a stable id.");
      const normalized = this.factory.create(drawing.type, drawing);
      this.drawings.set(normalized.id, normalized);
      return this.getDrawing(normalized.id);
    }

    importDrawings(drawings = [], options = {}) {
      if (options.clear) this.drawings.clear();
      drawings.forEach((drawing) => {
        const normalized = options.legacy ? this.factory.fromLegacy(drawing) : this.factory.create(drawing.type, drawing);
        this.drawings.set(normalized.id, normalized);
      });
      return this.getDrawings();
    }

    getDrawing(id) {
      const drawing = this.drawings.get(id);
      return drawing ? cloneDrawingValue(drawing) : null;
    }

    getDrawings(filter = null) {
      const rows = Array.from(this.drawings.values()).map((drawing) => cloneDrawingValue(drawing));
      return typeof filter === "function" ? rows.filter(filter) : rows;
    }

    updateDrawing(id, changes = {}, options = {}) {
      if (Array.isArray(id)) return this.updatePreview(id);
      const previous = this.drawings.get(id);
      if (!previous) return null;
      if (this.engine && !options.direct) {
        const lifecycleOnly = Object.keys(changes).every(key => key === "locked" || key === "visible");
        if (previous.locked && !lifecycleOnly) return null;
        const next = this.factory.create(previous.type, {
          ...previous, ...changes, style: { ...previous.style, ...changes.style },
        });
        return this.engine.updateDrawingsWithHistory([cloneDrawingValue(previous)], [next], "Update Drawing");
      }
      const next = {
        ...previous,
        ...changes,
        anchors: changes.anchors ? cloneDrawingValue(changes.anchors) : cloneDrawingValue(previous.anchors),
        geometry: Object.prototype.hasOwnProperty.call(changes, "geometry") ? cloneDrawingValue(changes.geometry) : cloneDrawingValue(previous.geometry),
        style: { ...(previous.style || {}), ...(changes.style || {}) },
        properties: { ...(previous.properties || {}), ...(changes.properties || {}) },
        metadata: { ...(previous.metadata || {}), ...(changes.metadata || {}) },
        updatedAt: Date.now(),
      };
      this.drawings.set(id, next);
      this.events?.emit?.(DrawingEvents.DRAWING_UPDATED, {
        drawingId: id,
        previousState: cloneDrawingValue(previous),
        nextState: this.getDrawing(id),
      });
      return this.getDrawing(id);
    }

    deleteDrawing(id, options = {}) {
      if (this.engine && !options.direct) return this.engine.deleteDrawing(id);
      const drawing = this.drawings.get(id);
      if (!drawing) return null;
      this.drawings.delete(id);
      this.events?.emit?.(DrawingEvents.DRAWING_DELETED, { drawingId: id, drawing: cloneDrawingValue(drawing) });
      return cloneDrawingValue(drawing);
    }

    clearDrawings() {
      const previous = this.getDrawings();
      this.drawings.clear();
      previous.forEach((drawing) => this.events?.emit?.(DrawingEvents.DRAWING_DELETED, { drawingId: drawing.id, drawing }));
    }

    hasDrawing(id) {
      return this.drawings.has(id);
    }

    // Collection mutations above are used by history commands. User-facing
    // operations below go through the existing engine so there is one history.
    attachEngine(engine) { this.engine = engine; return this; }
    getToolState() {
      const state = this.engine.state;
      return { activeTool: state.activeTool, drawingMode: state.toolMode,
        selectedDrawingId: state.selectedDrawingIds[0] || null, isDrawing: state.isCreating };
    }
    selectDrawing(id) { return this.engine.selectDrawing(id); }
    deleteSelected() { return this.engine.deleteDrawings(this.engine.state.selectedDrawingIds); }
    deleteAll() { return this.engine.deleteDrawings(this.getDrawings().map(d => d.id)); }
    removeDrawing(id) { return this.engine.deleteDrawing(id); }
    editDrawing(id, patch) {
      const drawing = this.getDrawing(id);
      if (!drawing || drawing.locked) return null;
      return this.engine.updateDrawingProperties([id], patch);
    }
    setLocked(id, locked) { return this.engine.updateDrawingProperties([id], { locked: !!locked }); }
    setVisible(id, visible) { return this.engine.updateDrawingProperties([id], { visible: !!visible }); }
    duplicateDrawing(id, options = {}) {
      this.selectDrawing(id);
      return this.engine.duplicateSelectedDrawings(options);
    }
    moveDrawing(id, deltaTime, deltaPrice) {
      const before = this.getDrawing(id);
      if (!before || before.locked || !Number.isFinite(deltaTime) || !Number.isFinite(deltaPrice)) return null;
      const after = { ...before, anchors: before.anchors.map(a => this.engine.createAnchor((a.time ?? a.timestamp) + deltaTime, a.price + deltaPrice, a.metadata)) };
      if (before.geometry?.entry) after.geometry = this.engine.transformEngine.movePositionGeometry(before, deltaTime, deltaPrice);
      return this.engine.updateDrawingsWithHistory([before], [after], "Move Drawing");
    }
    moveAnchor(id, index, timestamp, price) {
      const before = this.getDrawing(id);
      const anchor = this.engine.createAnchor(timestamp, price, before?.anchors[index]?.metadata);
      if (!before || before.locked || !anchor || !before.anchors[index]) return null;
      const after = { ...before, anchors: before.anchors.map((a, i) => i === index ? anchor : a) };
      if (before.geometry?.entry) after.geometry = this.engine.transformEngine.positionGeometry({ ...after, geometry: null });
      return this.engine.updateDrawingsWithHistory([before], [after], "Move Anchor");
    }
    startDrawing(toolId, anchor) {
      this.engine.activateTool(toolId);
      const tool = this.engine.toolController.getActiveTool();
      if (!tool || !anchor) return null;
      return this.engine.toolController.startTemporary(tool, [anchor]);
    }
    updatePreview(anchors) {
      const tool = this.engine.toolController.getActiveTool();
      if (!tool || !this.engine.state.temporaryDrawing) return null;
      const result = this.engine.toolController.updateTemporary(tool, anchors);
      this.engine.renderer.requestRender({ reason: "preview" });
      return result;
    }
    finishDrawing() {
      return this.engine.toolController.complete(this.engine.toolController.getActiveTool(), this.engine.state.temporaryDrawing);
    }
    cancelDrawing() { return this.engine.toolController.cancel(); }
    hitTest(point, options) { return this.engine.hitTest(point, options); }
    render(viewport) { return this.engine.render(viewport); }
    undo() { return this.engine.undo(); }
    redo() { return this.engine.redo(); }
  }

  window.IntenseDrawing = window.IntenseDrawing || {};
  window.IntenseDrawing.DrawingManager = DrawingManager;
})();
