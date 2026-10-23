/* drawing-state.js - isolated mutable state for drawing operations. */

(function () {
  class DrawingState {
    constructor(initial = {}) {
      this.activeTool = initial.activeTool || "select";
      this.activeToolId = initial.activeToolId || this.activeTool;
      this.previousTool = initial.previousTool || null;
      this.toolMode = initial.toolMode || "SINGLE_USE";
      this.creationState = initial.creationState || "IDLE";
      this.temporaryDrawingId = initial.temporaryDrawingId || null;
      this.anchorCount = Number.isFinite(initial.anchorCount) ? initial.anchorCount : 0;
      this.requiredAnchors = Number.isFinite(initial.requiredAnchors) ? initial.requiredAnchors : 0;
      this.currentPointerPosition = initial.currentPointerPosition || null;
      this.currentLogicalPosition = initial.currentLogicalPosition || null;
      this.lastCreatedDrawingId = initial.lastCreatedDrawingId || null;
      this.selectedDrawingIds = Array.isArray(initial.selectedDrawingIds) ? [...initial.selectedDrawingIds] : [];
      this.hoveredDrawingId = initial.hoveredDrawingId || null;
      this.isCreating = !!initial.isCreating;
      this.isDragging = !!initial.isDragging;
      this.isResizing = !!initial.isResizing;
      this.isEditing = !!initial.isEditing;
      this.magnetEnabled = initial.magnetEnabled ?? true;
      this.snapResult = initial.snapResult || { snapped: false };
      this.currentOperation = initial.currentOperation || null;
      this.temporaryDrawing = initial.temporaryDrawing || null;
      this.activeLayer = Number.isFinite(initial.activeLayer) ? initial.activeLayer : 0;
      this.settings = { ...(initial.settings || {}) };
    }

    setActiveTool(toolId) {
      this.previousTool = this.activeToolId || this.activeTool;
      this.activeTool = toolId || "select";
      this.activeToolId = this.activeTool;
      this.creationState = this.activeTool === "select" ? "IDLE" : "TOOL_ACTIVE";
    }

    setSelected(ids = []) {
      this.selectedDrawingIds = [...new Set(ids.filter(Boolean))];
    }

    clearSelection() {
      this.selectedDrawingIds = [];
      this.hoveredDrawingId = null;
    }

    startTemporary(drawing, operation = "create") {
      this.temporaryDrawing = drawing;
      this.temporaryDrawingId = drawing?.id || null;
      this.currentOperation = operation;
      this.isCreating = operation === "create";
      this.creationState = operation === "create" ? "CREATING" : this.creationState;
      this.anchorCount = drawing?.anchors?.length || 0;
    }

    clearTemporary() {
      this.temporaryDrawing = null;
      this.temporaryDrawingId = null;
      this.currentOperation = null;
      this.isCreating = false;
      this.anchorCount = 0;
    }

    snapshot() {
      return {
        activeTool: this.activeTool,
        selectedDrawingIds: [...this.selectedDrawingIds],
        hoveredDrawingId: this.hoveredDrawingId,
        isCreating: this.isCreating,
        isDragging: this.isDragging,
        isResizing: this.isResizing,
        isEditing: this.isEditing,
        magnetEnabled: this.magnetEnabled,
        snapResult: this.snapResult,
        currentOperation: this.currentOperation,
        temporaryDrawing: this.temporaryDrawing,
        activeLayer: this.activeLayer,
        settings: { ...this.settings },
      };
    }
  }

  window.IntenseDrawing = window.IntenseDrawing || {};
  window.IntenseDrawing.DrawingState = DrawingState;
})();
