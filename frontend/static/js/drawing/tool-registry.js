/* tool-registry.js - registry for drawing tools and future tool controllers. */

(function () {
  class DrawingToolRegistry {
    constructor(options = {}) {
      this.tools = new Map();
      this.activeToolId = null;
      this.events = options.events || null;
    }

    registerTool(tool) {
      if (!tool?.id) throw new Error("Drawing tool requires an id.");
      if (this.tools.has(tool.id)) throw new Error(`Drawing tool already registered: ${tool.id}`);
      const normalized = {
        version: 1,
        category: "general",
        icon: tool.id,
        description: "",
        creationMode: "manual",
        capabilities: {},
        shortcuts: [],
        favorite: false,
        cursor: "crosshair",
        requiredAnchors: 0,
        persistent: false,
        canPreview: true,
        activate() {},
        deactivate() {},
        onPointerDown() {},
        onPointerMove() {},
        onPointerUp() {},
        onDoubleClick() {},
        onKeyDown() {},
        cancel() {},
        complete() {},
        preview() { return null; },
        createObject() { return null; },
        ...tool,
      };
      this.tools.set(normalized.id, normalized);
      return normalized;
    }

    unregisterTool(type) {
      return this.tools.delete(type);
    }

    getTool(type) {
      return this.tools.get(type) || null;
    }

    getAllTools() {
      return Array.from(this.tools.values());
    }

    getTools() {
      return this.getAllTools();
    }

    getToolsByCategory(category) {
      return this.getAllTools().filter((tool) => tool.category === category);
    }

    searchTools(query = "") {
      const needle = String(query || "").trim().toLowerCase();
      if (!needle) return this.getAllTools();
      return this.getAllTools().filter((tool) => [
        tool.id,
        tool.name,
        tool.category,
        tool.description,
        ...(tool.shortcuts || []),
      ].some((value) => String(value || "").toLowerCase().includes(needle)));
    }

    hasTool(type) {
      return this.tools.has(type);
    }

    setActiveTool(toolId, context = {}) {
      if (!this.hasTool(toolId)) throw new Error(`Unknown drawing tool: ${toolId}`);
      if (this.activeToolId === toolId) return this.getTool(toolId);
      const previousTool = this.getActiveTool();
      previousTool?.deactivate?.(context);
      if (previousTool) this.events?.emit?.("TOOL_DEACTIVATED", { toolId: previousTool.id, tool: previousTool });
      this.activeToolId = toolId;
      const activeTool = this.getTool(toolId);
      activeTool?.activate?.(context);
      this.events?.emit?.("TOOL_ACTIVATED", { toolId, tool: activeTool });
      this.events?.emit?.("TOOL_CHANGED", { previousToolId: previousTool?.id || null, activeToolId: toolId });
      return activeTool;
    }

    getActiveTool() {
      return this.activeToolId ? this.getTool(this.activeToolId) : null;
    }

    clearActiveTool(context = {}) {
      const previousTool = this.getActiveTool();
      previousTool?.deactivate?.(context);
      if (previousTool) this.events?.emit?.("TOOL_DEACTIVATED", { toolId: previousTool.id, tool: previousTool });
      this.activeToolId = null;
    }
  }

  window.IntenseDrawing = window.IntenseDrawing || {};
  window.IntenseDrawing.DrawingToolRegistry = DrawingToolRegistry;
})();
