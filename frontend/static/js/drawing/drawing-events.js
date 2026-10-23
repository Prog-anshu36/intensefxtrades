/* drawing-events.js - drawing-domain event names and emitter adapter. */

(function () {
  const DrawingEvents = Object.freeze({
    DRAWING_CREATED: "DRAWING_CREATED",
    DRAWING_UPDATED: "DRAWING_UPDATED",
    DRAWING_DELETED: "DRAWING_DELETED",
    DRAWING_SELECTED: "DRAWING_SELECTED",
    DRAWING_DESELECTED: "DRAWING_DESELECTED",
    DRAWING_SELECTION_CHANGED: "DRAWING_SELECTION_CHANGED",
    DRAWING_HOVERED: "DRAWING_HOVERED",
    DRAWING_HOVER_CLEARED: "DRAWING_HOVER_CLEARED",
    DRAWING_DRAG_STARTED: "DRAWING_DRAG_STARTED",
    DRAWING_DRAG_UPDATED: "DRAWING_DRAG_UPDATED",
    DRAWING_DRAG_ENDED: "DRAWING_DRAG_ENDED",
    DRAWING_DRAG_CANCELLED: "DRAWING_DRAG_CANCELLED",
    SNAP_CHANGED: "SNAP_CHANGED",
    SNAP_CLEARED: "SNAP_CLEARED",
    MAGNET_CHANGED: "MAGNET_CHANGED",
    COMMAND_EXECUTED: "COMMAND_EXECUTED",
    COMMAND_UNDONE: "COMMAND_UNDONE",
    COMMAND_REDONE: "COMMAND_REDONE",
    HISTORY_CHANGED: "HISTORY_CHANGED",
    DRAWING_PROPERTIES_UPDATED: "DRAWING_PROPERTIES_UPDATED",
    DRAWING_STYLE_UPDATED: "DRAWING_STYLE_UPDATED",
    DRAWING_TOOL_CHANGED: "DRAWING_TOOL_CHANGED",
    DRAWING_CREATION_STARTED: "DRAWING_CREATION_STARTED",
    DRAWING_PREVIEW_UPDATED: "DRAWING_PREVIEW_UPDATED",
    DRAWING_CREATION_CANCELLED: "DRAWING_CREATION_CANCELLED",
    DRAWING_CREATION_COMPLETED: "DRAWING_CREATION_COMPLETED",
    DRAWING_RENDER_REQUESTED: "DRAWING_RENDER_REQUESTED",
    TOOL_ACTIVATED: "TOOL_ACTIVATED",
    TOOL_DEACTIVATED: "TOOL_DEACTIVATED",
    TOOL_CHANGED: "TOOL_CHANGED",
  });

  class DrawingEventEmitter {
    constructor(target = window, namespace = "tfb:drawing") {
      this.target = target;
      this.namespace = namespace;
      this.listeners = new Map();
    }

    emit(type, detail = {}) {
      const event = {
        type,
        at: Date.now(),
        detail,
      };
      const localListeners = this.listeners.get(type) || [];
      localListeners.forEach((listener) => listener(event));
      if (this.target?.dispatchEvent && typeof CustomEvent !== "undefined") {
        this.target.dispatchEvent(new CustomEvent(`${this.namespace}:${type}`, { detail: event }));
      }
      return event;
    }

    on(type, listener) {
      const next = this.listeners.get(type) || [];
      next.push(listener);
      this.listeners.set(type, next);
      return () => this.off(type, listener);
    }

    off(type, listener) {
      const next = (this.listeners.get(type) || []).filter((item) => item !== listener);
      if (next.length) this.listeners.set(type, next);
      else this.listeners.delete(type);
    }
  }

  window.IntenseDrawing = window.IntenseDrawing || {};
  window.IntenseDrawing.DrawingEvents = DrawingEvents;
  window.IntenseDrawing.DrawingEventEmitter = DrawingEventEmitter;
})();
