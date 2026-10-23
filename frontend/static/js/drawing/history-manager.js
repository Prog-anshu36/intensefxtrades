/* history-manager.js - command-based drawing undo/redo and clipboard helpers. */

(function () {
  const { DrawingEvents = {}, cloneDrawingValue } = window.IntenseDrawing || {};

  function clone(value) {
    return cloneDrawingValue ? cloneDrawingValue(value) : JSON.parse(JSON.stringify(value));
  }

  class DrawingCommand {
    constructor(type, label) {
      this.type = type;
      this.label = label || type;
      this.createdAt = Date.now();
    }

    execute() { throw new Error("Command must implement execute()."); }
    undo() { throw new Error("Command must implement undo()."); }
    redo() { return this.execute(); }
  }

  class CreateDrawingCommand extends DrawingCommand {
    constructor(engine, drawing) {
      super("CreateDrawingCommand", "Create Drawing");
      this.engine = engine;
      this.drawing = clone(drawing);
    }

    execute() {
      const created = this.engine.manager.registerDrawing(this.drawing);
      this.engine.events?.emit?.(DrawingEvents.DRAWING_CREATED, { drawingId: created.id, type: created.type, drawing: created });
      this.engine.state.lastCreatedDrawingId = created.id;
      this.engine.selectionManager.select(created.id, { reason: "history-create" });
      return created;
    }

    undo() {
      this.engine.manager.deleteDrawing(this.drawing.id, { direct: true });
      this.engine.selectionManager.clearSelection({ reason: "history-undo-create" });
    }
  }

  class DeleteDrawingsCommand extends DrawingCommand {
    constructor(engine, drawings = []) {
      super("DeleteDrawingsCommand", "Delete Drawings");
      this.engine = engine;
      this.drawings = drawings.map(clone);
      this.previousSelection = [...engine.state.selectedDrawingIds];
    }

    execute() {
      this.drawings.forEach((drawing) => this.engine.manager.deleteDrawing(drawing.id, { direct: true }));
      this.engine.selectionManager.clearSelection({ reason: "history-delete" });
      return this.drawings.length === 1 ? clone(this.drawings[0]) : this.drawings.map(clone);
    }

    undo() {
      this.drawings.forEach((drawing) => this.engine.manager.registerDrawing(drawing));
      this.engine.selectionManager.selectMultiple(this.previousSelection.filter((id) => this.engine.manager.hasDrawing(id)), { reason: "history-undo-delete" });
    }
  }

  class UpdateDrawingsCommand extends DrawingCommand {
    constructor(engine, before = [], after = [], label = "Update Drawings") {
      super("UpdateDrawingsCommand", label);
      this.engine = engine;
      this.before = before.map(clone);
      this.after = after.map(clone);
      this.selection = [...engine.state.selectedDrawingIds];
    }

    execute() {
      this.after.forEach((drawing) => this.engine.manager.registerDrawing(drawing));
      this.engine.selectionManager.selectMultiple(this.selection.filter((id) => this.engine.manager.hasDrawing(id)), { reason: "history-update" });
    }

    undo() {
      this.before.forEach((drawing) => this.engine.manager.registerDrawing(drawing));
      this.engine.selectionManager.selectMultiple(this.selection.filter((id) => this.engine.manager.hasDrawing(id)), { reason: "history-undo-update" });
    }
  }

  class AddDrawingsCommand extends DrawingCommand {
    constructor(engine, drawings = [], previousSelection = []) {
      super("AddDrawingsCommand", "Add Drawings");
      this.engine = engine;
      this.drawings = drawings.map(clone);
      this.previousSelection = [...previousSelection];
    }

    execute() {
      this.drawings.forEach((drawing) => {
        const created = this.engine.manager.registerDrawing(drawing);
        this.engine.events?.emit?.(DrawingEvents.DRAWING_CREATED, { drawingId: created.id, type: created.type, drawing: created });
      });
      this.engine.selectionManager.selectMultiple(this.drawings.map((drawing) => drawing.id), { reason: "history-add" });
    }

    undo() {
      this.drawings.forEach((drawing) => this.engine.manager.deleteDrawing(drawing.id, { direct: true }));
      this.engine.selectionManager.selectMultiple(this.previousSelection.filter((id) => this.engine.manager.hasDrawing(id)), { reason: "history-undo-add" });
    }
  }

  class CommandHistory {
    constructor(engine, options = {}) {
      this.engine = engine;
      this.maxHistorySize = options.maxHistorySize || 250;
      this.undoStack = [];
      this.redoStack = [];
      this.onChange = options.onChange || null;
    }

    execute(command) {
      if (!command?.execute || !command?.undo) return null;
      const result = command.execute();
      this.undoStack.push(command);
      if (this.undoStack.length > this.maxHistorySize) this.undoStack.shift();
      this.redoStack = [];
      this.afterChange(DrawingEvents.COMMAND_EXECUTED, command);
      return result;
    }

    undo() {
      const command = this.undoStack.pop();
      if (!command) return false;
      command.undo();
      this.redoStack.push(command);
      this.afterChange(DrawingEvents.COMMAND_UNDONE, command);
      return true;
    }

    redo() {
      const command = this.redoStack.pop();
      if (!command) return false;
      command.redo();
      this.undoStack.push(command);
      this.afterChange(DrawingEvents.COMMAND_REDONE, command);
      return true;
    }

    canUndo() { return this.undoStack.length > 0; }
    canRedo() { return this.redoStack.length > 0; }
    getUndoCount() { return this.undoStack.length; }
    getRedoCount() { return this.redoStack.length; }
    clear() {
      this.undoStack = [];
      this.redoStack = [];
      this.afterChange(DrawingEvents.HISTORY_CHANGED, null);
    }

    afterChange(eventType, command) {
      this.engine.renderer.requestRender({ reason: "history", commandType: command?.type || null });
      this.engine.events?.emit?.(eventType, { commandType: command?.type || null, canUndo: this.canUndo(), canRedo: this.canRedo() });
      this.engine.events?.emit?.(DrawingEvents.HISTORY_CHANGED, {
        canUndo: this.canUndo(),
        canRedo: this.canRedo(),
        undoCount: this.getUndoCount(),
        redoCount: this.getRedoCount(),
      });
      this.onChange?.(this.snapshot());
    }

    snapshot() {
      return {
        canUndo: this.canUndo(),
        canRedo: this.canRedo(),
        undoCount: this.getUndoCount(),
        redoCount: this.getRedoCount(),
      };
    }
  }

  class DrawingClipboard {
    constructor(engine) {
      this.engine = engine;
      this.items = [];
      this.pasteCount = 0;
    }

    copy(drawings = []) {
      this.items = drawings.map(clone);
      this.pasteCount = 0;
      return this.items.length;
    }

    hasItems() {
      return this.items.length > 0;
    }

    createPasteCopies(offsetCandles = 3, priceOffset = 0) {
      this.pasteCount += 1;
      const delta = offsetCandles * this.pasteCount;
      return this.items.map((drawing) => this.cloneWithOffset(drawing, delta, priceOffset));
    }

    cloneWithOffset(drawing, indexOffset, priceOffset = 0) {
      const copy = clone(drawing);
      copy.id = this.engine.factory.createId();
      copy.layer = (this.engine.getDrawings().reduce((max, item) => Math.max(max, item.layer || 0), 0) || 0) + 1;
      copy.createdAt = Date.now();
      copy.updatedAt = Date.now();
      copy.locked = false;
      copy.selected = false;
      copy.anchors = (copy.anchors || []).map((anchor) => {
        const index = this.engine.coordinateManager.timeToIndex(anchor.time ?? anchor.timestamp);
        const targetIndex = Number.isFinite(index) ? index + indexOffset : null;
        const targetTime = Number.isFinite(targetIndex) ? this.engine.coordinateManager.indexToTime(targetIndex) : (anchor.time ?? anchor.timestamp);
        return this.engine.coordinateManager.createAnchor(targetTime, Number(anchor.price) + priceOffset, { ...(anchor.metadata || {}), source: "clipboard" });
      }).filter(Boolean);
      if (copy.geometry) {
        const shiftTime = (time) => {
          const index = this.engine.coordinateManager.timeToIndex(time);
          return Number.isFinite(index) ? this.engine.coordinateManager.indexToTime(index + indexOffset) : time;
        };
        copy.geometry = {
          ...copy.geometry,
          entry: copy.geometry.entry ? { ...copy.geometry.entry, time: shiftTime(copy.geometry.entry.time), price: Number(copy.geometry.entry.price) + priceOffset } : copy.geometry.entry,
          stopLoss: copy.geometry.stopLoss ? { ...copy.geometry.stopLoss, price: Number(copy.geometry.stopLoss.price) + priceOffset } : copy.geometry.stopLoss,
          takeProfit: copy.geometry.takeProfit ? { ...copy.geometry.takeProfit, price: Number(copy.geometry.takeProfit.price) + priceOffset } : copy.geometry.takeProfit,
          timeRange: copy.geometry.timeRange ? { start: shiftTime(copy.geometry.timeRange.start), end: shiftTime(copy.geometry.timeRange.end) } : copy.geometry.timeRange,
        };
      }
      return copy;
    }
  }

  window.IntenseDrawing = window.IntenseDrawing || {};
  window.IntenseDrawing.DrawingCommand = DrawingCommand;
  window.IntenseDrawing.CreateDrawingCommand = CreateDrawingCommand;
  window.IntenseDrawing.DeleteDrawingsCommand = DeleteDrawingsCommand;
  window.IntenseDrawing.UpdateDrawingsCommand = UpdateDrawingsCommand;
  window.IntenseDrawing.AddDrawingsCommand = AddDrawingsCommand;
  window.IntenseDrawing.CommandHistory = CommandHistory;
  window.IntenseDrawing.DrawingClipboard = DrawingClipboard;
})();
