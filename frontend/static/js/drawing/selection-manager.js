/* selection-manager.js - selection, hover, and logical object manipulation. */

(function () {
  const { DrawingEvents = {} } = window.IntenseDrawing || {};

  const SelectionInteractionState = Object.freeze({
    IDLE: "IDLE",
    HOVERED: "HOVERED",
    SELECTED: "SELECTED",
    DRAGGING_OBJECT: "DRAGGING_OBJECT",
    DRAGGING_ANCHOR: "DRAGGING_ANCHOR",
    BOX_SELECTING: "BOX_SELECTING",
  });

  class SelectionManager {
    constructor(engine, options = {}) {
      this.engine = engine;
      this.events = engine.events;
      this.hitTestEngine = options.hitTestEngine;
      this.state = SelectionInteractionState.IDLE;
      this.drag = null;
      this.boxSelection = null;
    }

    select(id, options = {}) {
      if (!id || !this.engine.manager.hasDrawing(id)) return this.clearSelection();
      const previousIds = this.getSelectedIds();
      let nextIds;
      if (options.toggle) {
        nextIds = previousIds.includes(id) ? previousIds.filter((item) => item !== id) : [...previousIds, id];
      } else if (options.append) {
        nextIds = previousIds.includes(id) ? previousIds : [...previousIds, id];
      } else {
        nextIds = [id];
      }
      this.setSelection(nextIds, { reason: options.reason || "select" });
      return this.getSelectedIds();
    }

    deselect(id) {
      this.setSelection(this.getSelectedIds().filter((item) => item !== id), { reason: "deselect" });
    }

    selectMultiple(ids = [], options = {}) {
      const unique = [...new Set(ids.filter((id) => this.engine.manager.hasDrawing(id)))];
      this.setSelection(options.append ? [...this.getSelectedIds(), ...unique] : unique, { reason: options.reason || "selectMultiple" });
    }

    clearSelection(options = {}) {
      this.setSelection([], { reason: options.reason || "clear" });
    }

    setSelection(ids = [], options = {}) {
      const previousIds = this.getSelectedIds();
      const nextIds = [...new Set(ids.filter(Boolean))];
      this.engine.state.setSelected(nextIds);
      this.state = nextIds.length ? SelectionInteractionState.SELECTED : SelectionInteractionState.IDLE;
      previousIds.filter((id) => !nextIds.includes(id)).forEach((id) => {
        this.events?.emit?.(DrawingEvents.DRAWING_DESELECTED, { drawingId: id, selectedDrawingIds: nextIds });
      });
      nextIds.filter((id) => !previousIds.includes(id)).forEach((id) => {
        this.events?.emit?.(DrawingEvents.DRAWING_SELECTED, { drawingId: id, drawing: this.engine.getDrawing(id), selectedDrawingIds: nextIds });
      });
      this.events?.emit?.(DrawingEvents.DRAWING_SELECTION_CHANGED, { previousIds, selectedDrawingIds: nextIds, reason: options.reason });
      this.engine.renderer.requestRender({ reason: "selection", selectedDrawingIds: nextIds });
    }

    hover(id) {
      const previousId = this.engine.state.hoveredDrawingId;
      const nextId = id || null;
      if (previousId === nextId) return;
      this.engine.state.hoveredDrawingId = nextId;
      this.state = nextId && !this.getSelectedIds().length ? SelectionInteractionState.HOVERED : this.state;
      this.events?.emit?.(nextId ? DrawingEvents.DRAWING_HOVERED : DrawingEvents.DRAWING_HOVER_CLEARED, { previousId, drawingId: nextId });
      this.engine.renderer.requestRender({ reason: "hover", drawingId: nextId });
    }

    hitTest(point, options = {}) {
      return this.hitTestEngine?.hitTest?.(point, { selectedIds: this.getSelectedIds(), ...options }) || null;
    }

    startDrag(hit, pointerLogical) {
      if (!hit?.drawing || hit.drawing.locked) return false;
      const drawing = this.engine.getDrawing(hit.drawing.id) || hit.drawing;
      if (!this.isSelected(drawing.id)) this.select(drawing.id);
      const ids = hit.hitType === "anchor" || hit.hitType === "handle" ? [drawing.id] : this.getSelectedIds();
      this.engine.transformEngine?.startTransform?.(hit, pointerLogical);
      this.drag = {
        type: hit.hitType === "anchor" || hit.hitType === "handle" ? "anchor" : "object",
        ids,
        anchorIndex: Number.isFinite(hit.anchorIndex) ? hit.anchorIndex : null,
        startLogical: { ...pointerLogical },
        lastLogical: { ...pointerLogical },
        before: ids.map((id) => this.engine.getDrawing(id)).filter(Boolean),
      };
      this.engine.state.isDragging = this.drag.type === "object";
      this.engine.state.isResizing = this.drag.type === "anchor";
      this.state = this.drag.type === "anchor" ? SelectionInteractionState.DRAGGING_ANCHOR : SelectionInteractionState.DRAGGING_OBJECT;
      this.events?.emit?.(DrawingEvents.DRAWING_DRAG_STARTED, { drawingIds: ids, mode: this.drag.type, anchorIndex: this.drag.anchorIndex });
      return true;
    }

    updateDrag(pointerLogical) {
      if (!this.drag || !pointerLogical) return false;
      if (this.engine.transformEngine?.operation) {
        const updated = this.engine.transformEngine.updateTransform(pointerLogical);
        this.events?.emit?.(DrawingEvents.DRAWING_DRAG_UPDATED, { drawingIds: this.drag.ids, mode: this.drag.type });
        return updated;
      }
      const snap = this.engine.snapLogical?.(pointerLogical, {
        operation: this.drag.type === "anchor" ? "anchor-drag" : "object-drag",
        excludeDrawingId: this.drag.ids.length === 1 ? this.drag.ids[0] : null,
        disableForGroupMove: this.drag.type === "object",
        selectedCount: this.drag.ids.length,
      });
      const activeLogical = snap?.snapped ? snap.logical : pointerLogical;
      if (this.drag.type === "anchor") {
        const id = this.drag.ids[0];
        const drawing = this.engine.getDrawing(id);
        if (!drawing) return false;
        const anchors = (drawing.anchors || []).map((anchor, index) => (
          index === this.drag.anchorIndex ? this.engine.coordinateManager.createAnchor(activeLogical.time, activeLogical.price, { ...anchor.metadata, source: "anchor-drag", snap: snap?.snapped ? snap.snapType : null }) : anchor
        ));
        this.engine.updateDrawing(id, { anchors });
      } else {
        const previous = this.drag.lastLogical;
        const deltaTime = Number(activeLogical.time) - Number(previous.time);
        const deltaPrice = Number(activeLogical.price) - Number(previous.price);
        this.drag.ids.forEach((id) => {
          const drawing = this.engine.getDrawing(id);
          if (!drawing) return;
          const anchors = (drawing.anchors || []).map((anchor) => this.engine.coordinateManager.createAnchor(
            Number(anchor.time ?? anchor.timestamp) + deltaTime,
            Number(anchor.price) + deltaPrice,
            { ...anchor.metadata, source: "object-drag" },
          ));
          this.engine.updateDrawing(id, { anchors });
        });
        this.drag.lastLogical = { ...activeLogical };
      }
      this.events?.emit?.(DrawingEvents.DRAWING_DRAG_UPDATED, { drawingIds: this.drag.ids, mode: this.drag.type });
      return true;
    }

    endDrag() {
      if (!this.drag) return null;
      const result = {
        drawingIds: [...this.drag.ids],
        mode: this.drag.type,
        before: this.drag.before,
        after: this.drag.ids.map((id) => this.engine.getDrawing(id)).filter(Boolean),
      };
      const transformResult = this.engine.transformEngine?.commitTransform?.();
      this.drag = null;
      this.engine.state.isDragging = false;
      this.engine.state.isResizing = false;
      this.state = this.getSelectedIds().length ? SelectionInteractionState.SELECTED : SelectionInteractionState.IDLE;
      this.events?.emit?.(DrawingEvents.DRAWING_DRAG_ENDED, transformResult || result);
      return transformResult || result;
    }

    cancelDrag() {
      if (!this.drag) return false;
      if (!this.engine.transformEngine?.cancelTransform?.()) this.drag.before.forEach((drawing) => this.engine.updateDrawing(drawing.id, drawing));
      const ids = [...this.drag.ids];
      this.drag = null;
      this.engine.state.isDragging = false;
      this.engine.state.isResizing = false;
      this.state = this.getSelectedIds().length ? SelectionInteractionState.SELECTED : SelectionInteractionState.IDLE;
      this.events?.emit?.(DrawingEvents.DRAWING_DRAG_CANCELLED, { drawingIds: ids });
      return true;
    }

    startBoxSelection(point) {
      this.boxSelection = { x1: point.x, y1: point.y, x2: point.x, y2: point.y };
      this.state = SelectionInteractionState.BOX_SELECTING;
    }

    updateBoxSelection(point) {
      if (!this.boxSelection) return null;
      this.boxSelection.x2 = point.x;
      this.boxSelection.y2 = point.y;
      this.engine.renderer.requestRender({ reason: "box-selection" });
      return this.boxSelection;
    }

    completeBoxSelection(options = {}) {
      if (!this.boxSelection) return [];
      const ids = this.hitTestEngine?.hitTestBox?.(this.boxSelection) || [];
      this.boxSelection = null;
      this.selectMultiple(ids, { append: options.append, reason: "box" });
      return ids;
    }

    cancelBoxSelection() {
      if (!this.boxSelection) return false;
      this.boxSelection = null;
      this.state = this.getSelectedIds().length ? SelectionInteractionState.SELECTED : SelectionInteractionState.IDLE;
      this.engine.renderer.requestRender({ reason: "box-selection-cancel" });
      return true;
    }

    isSelected(id) {
      return this.engine.state.selectedDrawingIds.includes(id);
    }

    getSelectedIds() {
      return [...this.engine.state.selectedDrawingIds];
    }

    getSelectedObjects() {
      return this.getSelectedIds().map((id) => this.engine.getDrawing(id)).filter(Boolean);
    }
  }

  window.IntenseDrawing = window.IntenseDrawing || {};
  window.IntenseDrawing.SelectionInteractionState = SelectionInteractionState;
  window.IntenseDrawing.SelectionManager = SelectionManager;
})();
