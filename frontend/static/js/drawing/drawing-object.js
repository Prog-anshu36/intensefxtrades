/* drawing-object.js - normalized drawing object factory and migration adapter. */

(function () {
  const { DrawingTypes = {}, LegacyDrawingTypeMap = {}, DrawingStyleDefaults = {}, DrawingPropertyDefaults = {} } = window.IntenseDrawing || {};

  function clone(value) {
    if (typeof structuredClone === "function") return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  class DrawingObjectFactory {
    constructor(options = {}) {
      this.prefix = options.prefix || "drawing";
      this.counter = Number(options.startCounter || 0);
      this.coordinateManager = options.coordinateManager || null;
    }

    createId() {
      this.counter += 1;
      const suffix = String(this.counter).padStart(6, "0");
      return `${this.prefix}_${suffix}_${Date.now().toString(36)}`;
    }

    create(type, attrs = {}) {
      const now = Date.now();
      return {
        id: attrs.id || this.createId(),
        type: type || attrs.type || DrawingTypes.TEST_POINT,
        version: Number.isFinite(attrs.version) ? attrs.version : Number(attrs.properties?.version || attrs.metadata?.version || 1),
        anchors: this.normalizeAnchors(attrs.anchors),
        geometry: attrs.geometry ? clone(attrs.geometry) : null,
        style: { ...DrawingStyleDefaults, ...(attrs.style || {}) },
        properties: { ...DrawingPropertyDefaults, ...(attrs.properties || {}) },
        visible: attrs.visible ?? true,
        locked: attrs.locked ?? false,
        selected: attrs.selected ?? false,
        layer: Number.isFinite(attrs.layer) ? attrs.layer : 0,
        symbol: attrs.symbol ?? null,
        timeframeVisibility: attrs.timeframeVisibility || attrs.timeframeScope || "all",
        metadata: { ...(attrs.metadata || {}) },
        createdAt: attrs.createdAt || now,
        updatedAt: attrs.updatedAt || now,
      };
    }

    normalizeAnchors(anchors) {
      if (!Array.isArray(anchors)) return [];
      return anchors
        .map((anchor) => this.coordinateManager?.normalizeAnchor ? this.coordinateManager.normalizeAnchor(anchor, { allowIncomplete: true }) : clone(anchor))
        .filter(Boolean);
    }

    fromLegacy(legacy = {}) {
      return this.create(LegacyDrawingTypeMap[legacy.type] || legacy.type || DrawingTypes.TEST_POINT, {
        ...legacy,
        properties: {
          ...(legacy.properties || {}),
          legacyType: legacy.type,
        },
        timeframeVisibility: legacy.timeframeVisibility || legacy.timeframeScope || "all",
      });
    }
  }

  window.IntenseDrawing = window.IntenseDrawing || {};
  window.IntenseDrawing.DrawingObjectFactory = DrawingObjectFactory;
  window.IntenseDrawing.cloneDrawingValue = clone;
})();
