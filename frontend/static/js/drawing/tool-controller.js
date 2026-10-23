/* tool-controller.js - routes chart pointer events through active drawing tools. */

(function () {
  const { DrawingEvents = {}, DrawingTypes = {} } = window.IntenseDrawing || {};

  const CreationStates = Object.freeze({
    IDLE: "IDLE",
    TOOL_ACTIVE: "TOOL_ACTIVE",
    CREATING: "CREATING",
    PREVIEWING: "PREVIEWING",
    WAITING_FOR_ANCHOR: "WAITING_FOR_ANCHOR",
    COMPLETED: "COMPLETED",
    CANCELLED: "CANCELLED",
    ERROR: "ERROR",
  });

  const ToolModes = Object.freeze({
    SINGLE_USE: "SINGLE_USE",
    PERSISTENT: "PERSISTENT",
  });

  class DrawingToolController {
    constructor(engine, options = {}) {
      this.engine = engine;
      this.defaultToolId = options.defaultToolId || DrawingTypes.SELECT || "select";
    }

    activateTool(toolId, options = {}) {
      this.cancel({ silent: true });
      const tool = this.engine.toolRegistry.setActiveTool(toolId, { engine: this.engine, options });
      this.engine.state.setActiveTool(toolId);
      this.engine.state.toolMode = options.toolMode || (tool.persistent ? ToolModes.PERSISTENT : ToolModes.SINGLE_USE);
      this.engine.state.requiredAnchors = tool.requiredAnchors || 0;
      this.engine.state.creationState = toolId === this.defaultToolId ? CreationStates.IDLE : CreationStates.TOOL_ACTIVE;
      return tool;
    }

    clearActiveTool() {
      this.cancel({ silent: true });
      this.engine.toolRegistry.clearActiveTool({ engine: this.engine });
      this.engine.state.setActiveTool(this.defaultToolId);
      this.engine.state.creationState = CreationStates.IDLE;
    }

    getActiveTool() {
      return this.engine.toolRegistry.getActiveTool();
    }

    pointerDown(event) {
      return this.routePointer("onPointerDown", event);
    }

    pointerMove(event) {
      return this.routePointer("onPointerMove", event);
    }

    pointerUp(event) {
      return this.routePointer("onPointerUp", event);
    }

    doubleClick(event) {
      return this.routePointer("onDoubleClick", event);
    }

    keyDown(event) {
      const tool = this.getActiveTool();
      if (!tool) return false;
      if (event.key === "Escape") {
        this.cancel();
        return true;
      }
      if (event.key === "Enter" && this.engine.state.temporaryDrawing) {
        return !!tool.onKeyDown?.(this.contextFor(event, null));
      }
      return !!tool.onKeyDown?.(this.contextFor(event, null));
    }

    routePointer(method, pointerEvent) {
      const tool = this.getActiveTool();
      if (!tool || tool.id === this.defaultToolId) return false;
      if (method === "onPointerDown") this.pointerStart = { x: pointerEvent.clientX, y: pointerEvent.clientY };
      if (method === "onPointerUp") {
        const start = this.pointerStart;
        this.pointerStart = null;
        if (start && Math.hypot(pointerEvent.clientX - start.x, pointerEvent.clientY - start.y) < 3) return false;
      }
      const rawLogical = this.engine.coordinateManager.screenToLogical(pointerEvent.clientX, pointerEvent.clientY);
      const snap = this.engine.snapLogical?.(rawLogical, { event: pointerEvent, operation: "create" });
      const logical = snap?.snapped ? snap.logical : rawLogical;
      if (!logical) return false;
      this.engine.state.currentPointerPosition = { x: pointerEvent.clientX, y: pointerEvent.clientY };
      this.engine.state.currentLogicalPosition = logical;
      try {
        const handled = tool[method]?.(this.contextFor(pointerEvent, logical));
        if (handled) this.engine.renderer.requestRender({ reason: "tool-pointer", toolId: tool.id, method });
        return !!handled;
      } catch (error) {
        console.error("Drawing tool failed", error);
        this.engine.state.creationState = CreationStates.ERROR;
        this.cancel();
        return true;
      }
    }

    contextFor(sourceEvent, logical) {
      return {
        engine: this.engine,
        state: this.engine.state,
        tool: this.getActiveTool(),
        event: sourceEvent,
        logical,
        coordinateManager: this.engine.coordinateManager,
        complete: (tool, drawing) => this.complete(tool, drawing),
        cancel: () => this.cancel(),
      };
    }

    startTemporary(tool, anchors) {
      const drawing = this.engine.factory.create(tool.drawingType || tool.id, {
        anchors,
        style: tool.defaultStyle || {},
        visible: true,
        locked: false,
        symbol: this.engine.options.getSymbol?.() || null,
        timeframeVisibility: "all",
        properties: { ...(tool.defaultProperties || {}), toolId: tool.id, version: tool.version || 1 },
        metadata: { ...(tool.defaultMetadata || {}), preview: true },
      });
      this.engine.state.startTemporary(drawing, "create");
      this.engine.state.requiredAnchors = tool.requiredAnchors || anchors.length;
      this.engine.state.creationState = anchors.length ? CreationStates.WAITING_FOR_ANCHOR : CreationStates.CREATING;
      this.engine.events.emit(DrawingEvents.DRAWING_CREATION_STARTED, { drawingId: drawing.id, type: drawing.type, drawing });
      return drawing;
    }

    updateTemporary(tool, anchors) {
      let drawing = this.engine.state.temporaryDrawing;
      if (!drawing) drawing = this.startTemporary(tool, anchors);
      drawing = {
        ...drawing,
        anchors,
        updatedAt: Date.now(),
      };
      this.engine.state.temporaryDrawing = drawing;
      this.engine.state.temporaryDrawingId = drawing.id;
      this.engine.state.anchorCount = anchors.length;
      this.engine.state.creationState = CreationStates.PREVIEWING;
      this.engine.events.emit(DrawingEvents.DRAWING_PREVIEW_UPDATED, { drawingId: drawing.id, type: drawing.type, drawing });
      return drawing;
    }

    complete(tool, drawing) {
      if (!drawing || (drawing.anchors || []).length < (tool.requiredAnchors || 0)) return null;
      const persistent = this.engine.createDrawing(tool.drawingType || tool.id, {
        ...drawing,
        id: undefined,
        metadata: { ...(drawing.metadata || {}), preview: false },
        properties: { ...(tool.defaultProperties || {}), ...(drawing.properties || {}), toolId: tool.id, version: tool.version || 1 },
      });
      this.engine.state.lastCreatedDrawingId = persistent.id;
      this.engine.state.setSelected([persistent.id]);
      this.engine.state.creationState = CreationStates.COMPLETED;
      this.engine.state.clearTemporary();
      this.engine.events.emit(DrawingEvents.DRAWING_CREATION_COMPLETED, { drawingId: persistent.id, type: persistent.type, drawing: persistent });
      if (this.engine.state.toolMode === ToolModes.SINGLE_USE) this.activateTool(this.defaultToolId);
      else this.engine.state.creationState = CreationStates.TOOL_ACTIVE;
      this.engine.renderer.requestRender({ reason: "tool-complete", drawingId: persistent.id });
      return persistent;
    }

    cancel(options = {}) {
      this.pointerStart = null;
      const temporaryDrawing = this.engine.state.temporaryDrawing;
      this.engine.state.clearTemporary();
      this.engine.state.creationState = CreationStates.CANCELLED;
      if (!options.silent) {
        this.engine.events.emit(DrawingEvents.DRAWING_CREATION_CANCELLED, { drawingId: temporaryDrawing?.id || null, drawing: temporaryDrawing });
      }
      this.engine.renderer.requestRender({ reason: "tool-cancel" });
    }
  }

  function createAnchorTool({ id, drawingType, name, category, icon, requiredAnchors, cursor = "crosshair" }) {
    return {
      id,
      drawingType,
      name,
      category,
      icon,
      cursor,
      requiredAnchors,
      persistent: false,
      canPreview: true,
      defaultStyle: { color: "#d1d4dc", width: 1.5, opacity: 1 },
      onPointerMove(ctx) {
        if (!ctx.logical) return false;
        const committedCount = ctx.state.temporaryDrawing?.metadata?.committedAnchorCount || 0;
        const committed = ctx.state.temporaryDrawing?.anchors?.slice(0, committedCount) || [];
        const anchors = committed.length
          ? [...committed, ctx.logical]
          : [ctx.logical];
        ctx.engine.toolController.updateTemporary(this, anchors);
        return true;
      },
      onPointerDown(ctx) {
        if (!ctx.logical) return false;
        const committedCount = ctx.state.temporaryDrawing?.metadata?.committedAnchorCount || 0;
        const existing = ctx.state.temporaryDrawing?.anchors?.slice(0, committedCount) || [];
        const anchors = requiredAnchors === 1 ? [ctx.logical] : [...existing, ctx.logical];
        const temporary = ctx.engine.toolController.updateTemporary(this, anchors);
        temporary.metadata = { ...(temporary.metadata || {}), committedAnchorCount: anchors.length };
        ctx.state.temporaryDrawing = temporary;
        if (anchors.length >= requiredAnchors) ctx.complete(this, temporary);
        return true;
      },
      cancel(ctx) {
        ctx?.cancel?.();
      },
    };
  }

  function registerBasicCreationTools(registry) {
    if (window.IntenseDrawing.registerProfessionalDrawingTools) {
      window.IntenseDrawing.registerProfessionalDrawingTools(registry);
      return;
    }
    const categories = window.IntenseDrawing.ToolCategories;
    const types = window.IntenseDrawing.DrawingTypes;
    [
      createAnchorTool({ id: types.HORIZONTAL_LINE, drawingType: types.HORIZONTAL_LINE, name: "Horizontal Line", category: categories.LINES, icon: "horizontal-line", requiredAnchors: 1 }),
      createAnchorTool({ id: types.VERTICAL_LINE, drawingType: types.VERTICAL_LINE, name: "Vertical Line", category: categories.LINES, icon: "vertical-line", requiredAnchors: 1 }),
      createAnchorTool({ id: types.TREND_LINE, drawingType: types.TREND_LINE, name: "Trend Line", category: categories.LINES, icon: "trend-line", requiredAnchors: 2 }),
    ].forEach((tool) => {
      if (registry.hasTool(tool.id)) registry.unregisterTool(tool.id);
      registry.registerTool(tool);
    });
  }

  window.IntenseDrawing = window.IntenseDrawing || {};
  window.IntenseDrawing.CreationStates = CreationStates;
  window.IntenseDrawing.ToolModes = ToolModes;
  window.IntenseDrawing.DrawingToolController = DrawingToolController;
  window.IntenseDrawing.registerBasicCreationTools = registerBasicCreationTools;
})();
