/* drawing-workspace-ux.js - persisted drawing UX preferences, groups, templates, and shortcuts. */

(function () {
  const DEFAULT_SHORTCUTS = Object.freeze({
    s: "crosshair",
    v: "crosshair",
    t: "trend",
    h: "hline",
    r: "rect",
    f: "fib",
    b: "brush",
    x: "text",
    a: "arrow",
    e: "extended",
    m: "measure",
  });

  const DEFAULT_FAVORITES = Object.freeze(["trend", "hline", "rect", "fib"]);

  function clone(value) {
    if (typeof structuredClone === "function") return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  class DrawingWorkspaceUX {
    constructor(options = {}) {
      this.storage = options.storage || window.localStorage;
      this.key = options.key || "tfb_drawing_workspace_ux_v1";
      this.state = this.load();
    }

    defaultState() {
      return {
        favorites: [...DEFAULT_FAVORITES],
        shortcuts: { ...DEFAULT_SHORTCUTS },
        toolbarMode: "compact",
        activeTool: "crosshair",
        magnetEnabled: true,
        objectTree: {
          expanded: true,
          search: "",
          filter: "all",
          expandedGroups: {},
          width: 260,
        },
        templates: [
          { id: "tpl_support", name: "Support", style: { color: "#ff3b4f", width: 2, lineStyle: "solid", opacity: 1 }, properties: {} },
          { id: "tpl_resistance", name: "Resistance", style: { color: "#f3c969", width: 2, lineStyle: "dashed", opacity: 1 }, properties: {} },
          { id: "tpl_entry", name: "Entry", style: { color: "#00b894", width: 2, lineStyle: "solid", opacity: 1 }, properties: {} },
        ],
        defaultTemplates: {},
        groups: {},
        groupOrder: [],
      };
    }

    load() {
      try {
        const saved = JSON.parse(this.storage.getItem(this.key) || "null");
        return this.mergeState(this.defaultState(), saved || {});
      } catch {
        return this.defaultState();
      }
    }

    mergeState(base, saved) {
      return {
        ...base,
        ...saved,
        favorites: Array.isArray(saved.favorites) ? saved.favorites : base.favorites,
        shortcuts: { ...base.shortcuts, ...(saved.shortcuts || {}) },
        objectTree: { ...base.objectTree, ...(saved.objectTree || {}) },
        templates: Array.isArray(saved.templates) ? saved.templates : base.templates,
        defaultTemplates: { ...base.defaultTemplates, ...(saved.defaultTemplates || {}) },
        groups: saved.groups && typeof saved.groups === "object" ? saved.groups : base.groups,
        groupOrder: Array.isArray(saved.groupOrder) ? saved.groupOrder : base.groupOrder,
      };
    }

    save() {
      try {
        this.storage.setItem(this.key, JSON.stringify(this.state));
      } catch { /* localStorage can be disabled */ }
      return this.state;
    }

    getState() {
      return this.state;
    }

    setActiveTool(tool) {
      this.state.activeTool = tool || "crosshair";
      return this.save();
    }

    setMagnetEnabled(enabled) {
      this.state.magnetEnabled = !!enabled;
      return this.save();
    }

    setToolbarMode(mode) {
      this.state.toolbarMode = mode === "expanded" ? "expanded" : "compact";
      return this.save();
    }

    setObjectTreePatch(patch = {}) {
      this.state.objectTree = { ...this.state.objectTree, ...patch };
      return this.save();
    }

    toggleFavorite(tool) {
      const current = this.state.favorites || [];
      this.state.favorites = current.includes(tool) ? current.filter((item) => item !== tool) : [...current, tool];
      return this.save();
    }

    moveFavorite(tool, delta) {
      const items = [...(this.state.favorites || [])];
      const index = items.indexOf(tool);
      if (index < 0) return this.state.favorites;
      const next = Math.max(0, Math.min(items.length - 1, index + delta));
      items.splice(index, 1);
      items.splice(next, 0, tool);
      this.state.favorites = items;
      this.save();
      return items;
    }

    resolveShortcut(key) {
      return this.state.shortcuts?.[String(key || "").toLowerCase()] || null;
    }

    createGroup(name = "Group", children = []) {
      const id = `group_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
      this.state.groups[id] = {
        id,
        name,
        children: [...new Set(children)],
        collapsed: false,
        visible: true,
        locked: false,
        previousVisibility: {},
        previousLocks: {},
        orderIndex: this.state.groupOrder.length,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      this.state.groupOrder.push(id);
      this.save();
      return this.state.groups[id];
    }

    updateGroup(id, patch = {}) {
      if (!this.state.groups[id]) return null;
      this.state.groups[id] = { ...this.state.groups[id], ...patch, updatedAt: Date.now() };
      this.save();
      return this.state.groups[id];
    }

    deleteGroup(id) {
      const group = this.state.groups[id];
      if (!group) return null;
      delete this.state.groups[id];
      this.state.groupOrder = this.state.groupOrder.filter((item) => item !== id);
      this.save();
      return group;
    }

    assignToGroup(drawingIds = [], groupId = null) {
      Object.values(this.state.groups).forEach((group) => {
        group.children = (group.children || []).filter((id) => !drawingIds.includes(id));
      });
      if (groupId && this.state.groups[groupId]) {
        this.state.groups[groupId].children = [...new Set([...(this.state.groups[groupId].children || []), ...drawingIds])];
        this.state.groups[groupId].updatedAt = Date.now();
      }
      this.save();
    }

    groupForDrawing(drawingId) {
      return Object.values(this.state.groups).find((group) => (group.children || []).includes(drawingId)) || null;
    }

    saveTemplate(name, sourceDrawing) {
      if (!sourceDrawing) return null;
      const template = {
        id: `tpl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
        name: name || "Drawing Template",
        type: sourceDrawing.type,
        style: clone(sourceDrawing.style || {}),
        properties: clone(sourceDrawing.properties || {}),
        createdAt: Date.now(),
      };
      this.state.templates = [...(this.state.templates || []), template];
      this.save();
      return template;
    }

    setDefaultTemplate(toolType, templateId) {
      if (toolType && templateId) this.state.defaultTemplates[toolType] = templateId;
      return this.save();
    }

    getTemplate(templateId) {
      return (this.state.templates || []).find((template) => template.id === templateId) || null;
    }
  }

  window.IntenseDrawing = window.IntenseDrawing || {};
  window.IntenseDrawing.DrawingWorkspaceUX = DrawingWorkspaceUX;
})();
