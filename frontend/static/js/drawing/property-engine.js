/* property-engine.js - normalized style and property updates for drawings. */

(function () {
  const { DrawingEvents = {}, DrawingTypes = {}, LegacyDrawingTypeMap = {}, cloneDrawingValue } = window.IntenseDrawing || {};

  const DrawingStyleDefaults = Object.freeze({
    color: "#d1d4dc",
    width: 1.5,
    opacity: 1,
    lineStyle: "solid",
    fillColor: "#3d7fff",
    fillOpacity: 0.16,
    textColor: "#d1d4dc",
    fontSize: 13,
    fontWeight: "400",
    profitColor: "#00b894",
    riskColor: "#ff3b4f",
    entryColor: "#d1d4dc",
    stopColor: "#ff3b4f",
    targetColor: "#00b894",
  });

  const DrawingPropertyDefaults = Object.freeze({
    extendLeft: false,
    extendRight: false,
    labelVisible: false,
    priceLabelVisible: false,
    timeLabelVisible: false,
    backgroundVisible: false,
    showEntry: true,
    showStop: true,
    showTarget: true,
    showRisk: true,
    showReward: true,
    showRR: true,
    showPrice: true,
    showPercentage: true,
    analysisOnly: true,
  });

  const LINE_TYPES = new Set([
    DrawingTypes.TREND_LINE,
    DrawingTypes.HORIZONTAL_LINE,
    DrawingTypes.VERTICAL_LINE,
    DrawingTypes.RAY,
    DrawingTypes.EXTENDED_LINE,
    DrawingTypes.ARROW,
    DrawingTypes.HORIZONTAL_RAY,
    DrawingTypes.VERTICAL_RAY,
    "trendLine",
    "horizontalLine",
    "verticalLine",
    "ray",
    "extendedLine",
  ]);
  const FILL_TYPES = new Set([DrawingTypes.RECTANGLE, DrawingTypes.CIRCLE, DrawingTypes.ELLIPSE, DrawingTypes.TRIANGLE, DrawingTypes.POLYGON, DrawingTypes.PARALLEL_CHANNEL, "rectangle", "circle", "ellipse", "triangle", "polygon", "parallelChannel"]);
  const TEXT_TYPES = new Set([DrawingTypes.TEXT, "text"]);
  const POSITION_TYPES = new Set([DrawingTypes.LONG_POSITION, DrawingTypes.SHORT_POSITION, "longPosition", "shortPosition"]);
  const COMMON_STYLE_KEYS = new Set(["color", "width", "opacity", "lineStyle"]);
  const FILL_STYLE_KEYS = new Set(["fillColor", "fillOpacity"]);
  const TEXT_STYLE_KEYS = new Set(["textColor", "fontSize", "fontWeight"]);
  const POSITION_STYLE_KEYS = new Set(["profitColor", "riskColor", "entryColor", "stopColor", "targetColor", "fillOpacity"]);
  const COMMON_PROPERTY_KEYS = new Set(["labelVisible", "priceLabelVisible", "timeLabelVisible"]);
  const LINE_PROPERTY_KEYS = new Set(["extendLeft", "extendRight"]);
  const FILL_PROPERTY_KEYS = new Set(["backgroundVisible", "extendLeft", "extendRight"]);
  const POSITION_PROPERTY_KEYS = new Set(["showEntry", "showStop", "showTarget", "showRisk", "showReward", "showRR", "showPrice", "showPercentage", "analysisOnly"]);

  function clone(value) {
    if (typeof cloneDrawingValue === "function") return cloneDrawingValue(value);
    if (typeof structuredClone === "function") return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function clamp(value, min, max, fallback) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.max(min, Math.min(max, numeric));
  }

  function normalizeColor(value, fallback) {
    const text = String(value || "").trim();
    if (/^#[0-9a-f]{6}$/i.test(text)) return text;
    if (/^rgba?\(/i.test(text)) return text;
    return fallback;
  }

  function normalizeLineStyle(value) {
    return ["solid", "dashed", "dotted"].includes(value) ? value : "solid";
  }

  function canonicalType(type) {
    return LegacyDrawingTypeMap[type] || type;
  }

  function styleKeysForType(type) {
    const actualType = canonicalType(type);
    const keys = new Set(COMMON_STYLE_KEYS);
    if (FILL_TYPES.has(actualType) || FILL_TYPES.has(type)) FILL_STYLE_KEYS.forEach((key) => keys.add(key));
    if (TEXT_TYPES.has(actualType) || TEXT_TYPES.has(type)) TEXT_STYLE_KEYS.forEach((key) => keys.add(key));
    if (POSITION_TYPES.has(actualType) || POSITION_TYPES.has(type)) POSITION_STYLE_KEYS.forEach((key) => keys.add(key));
    return keys;
  }

  function propertyKeysForType(type) {
    const actualType = canonicalType(type);
    const keys = new Set(COMMON_PROPERTY_KEYS);
    if (actualType === DrawingTypes.FIB_RETRACEMENT) ['levels', 'reverse', 'fibMode', 'extendLeft', 'extendRight'].forEach(key => keys.add(key));
    if (LINE_TYPES.has(actualType) || LINE_TYPES.has(type)) LINE_PROPERTY_KEYS.forEach((key) => keys.add(key));
    if (FILL_TYPES.has(actualType) || FILL_TYPES.has(type)) FILL_PROPERTY_KEYS.forEach((key) => keys.add(key));
    if (POSITION_TYPES.has(actualType) || POSITION_TYPES.has(type)) POSITION_PROPERTY_KEYS.forEach((key) => keys.add(key));
    return keys;
  }

  class PropertyEngine {
    constructor(engine, options = {}) {
      this.engine = engine;
      this.defaults = {
        style: { ...DrawingStyleDefaults, ...(options.styleDefaults || {}) },
        properties: { ...DrawingPropertyDefaults, ...(options.propertyDefaults || {}) },
      };
    }

    normalizeStyle(type, style = {}) {
      const merged = { ...this.defaults.style, ...(style || {}) };
      return {
        color: normalizeColor(merged.color, this.defaults.style.color),
        width: clamp(merged.width, 1, 12, this.defaults.style.width),
        opacity: clamp(merged.opacity, 0.05, 1, this.defaults.style.opacity),
        lineStyle: normalizeLineStyle(merged.lineStyle),
        fillColor: normalizeColor(merged.fillColor, this.defaults.style.fillColor),
        fillOpacity: clamp(merged.fillOpacity, 0, 1, this.defaults.style.fillOpacity),
        textColor: normalizeColor(merged.textColor, this.defaults.style.textColor),
        fontSize: clamp(merged.fontSize, 8, 72, this.defaults.style.fontSize),
        fontWeight: ["400", "500", "600", "700", "bold", "normal"].includes(String(merged.fontWeight)) ? String(merged.fontWeight) : this.defaults.style.fontWeight,
        profitColor: normalizeColor(merged.profitColor, this.defaults.style.profitColor),
        riskColor: normalizeColor(merged.riskColor, this.defaults.style.riskColor),
        entryColor: normalizeColor(merged.entryColor, this.defaults.style.entryColor),
        stopColor: normalizeColor(merged.stopColor, this.defaults.style.stopColor),
        targetColor: normalizeColor(merged.targetColor, this.defaults.style.targetColor),
      };
    }

    normalizeProperties(type, properties = {}) {
      const merged = { ...this.defaults.properties, ...(properties || {}) };
      return {
        ...merged,
        levels: (type === DrawingTypes.FIB_RETRACEMENT || type === 'fibRetracement') && !merged.fibMode
          ? window.IntenseDrawing.fibRetracementLevels(merged.levels).map(Number).filter(Number.isFinite).slice(0,50)
          : Array.isArray(merged.levels) ? merged.levels.map(Number).filter(Number.isFinite).slice(0, 50) : undefined,
        reverse: !!merged.reverse,
        extendLeft: !!merged.extendLeft,
        extendRight: !!merged.extendRight,
        labelVisible: !!merged.labelVisible,
        priceLabelVisible: !!merged.priceLabelVisible,
        timeLabelVisible: !!merged.timeLabelVisible,
        backgroundVisible: !!merged.backgroundVisible,
        showEntry: merged.showEntry !== false,
        showStop: merged.showStop !== false,
        showTarget: merged.showTarget !== false,
        showRisk: merged.showRisk !== false,
        showReward: merged.showReward !== false,
        showRR: merged.showRR !== false,
        showPrice: merged.showPrice !== false,
        showPercentage: merged.showPercentage !== false,
        analysisOnly: true,
      };
    }

    normalizeDrawing(drawing) {
      if (!drawing) return drawing;
      return {
        ...drawing,
        style: this.normalizeStyle(drawing.type, drawing.style),
        properties: this.normalizeProperties(drawing.type, drawing.properties),
      };
    }

    filterStylePatch(type, patch = {}) {
      const allowed = styleKeysForType(type);
      const normalized = this.normalizeStyle(type, patch);
      return Object.fromEntries(Object.entries(normalized).filter(([key]) => allowed.has(key) && Object.prototype.hasOwnProperty.call(patch, key)));
    }

    filterPropertyPatch(type, patch = {}) {
      const allowed = propertyKeysForType(type);
      const normalized = this.normalizeProperties(type, patch);
      return Object.fromEntries(Object.entries(normalized).filter(([key]) => allowed.has(key) && Object.prototype.hasOwnProperty.call(patch, key)));
    }

    applyPatchToDrawing(drawing, patch = {}) {
      if (!drawing) return null;
      const next = clone(drawing);
      if (patch.style) next.style = { ...(next.style || {}), ...this.filterStylePatch(next.type, patch.style) };
      if (patch.properties) next.properties = { ...(next.properties || {}), ...this.filterPropertyPatch(next.type, patch.properties) };
      if (patch.metadata) next.metadata = { ...(next.metadata || {}), ...(patch.metadata || {}) };
      if (Object.prototype.hasOwnProperty.call(patch, "visible")) next.visible = !!patch.visible;
      if (Object.prototype.hasOwnProperty.call(patch, "locked")) next.locked = !!patch.locked;
      next.updatedAt = Date.now();
      return this.normalizeDrawing(next);
    }

    applyToDrawings(ids = [], patch = {}, options = {}) {
      const drawingIds = Array.isArray(ids) ? ids : [ids];
      const lifecycleOnly = Object.keys(patch).every(key => key === "locked" || key === "visible");
      const before = drawingIds.map((id) => this.engine.getDrawing(id)).filter(drawing => drawing && (!drawing.locked || lifecycleOnly));
      if (!before.length) return null;
      const after = before.map((drawing) => this.applyPatchToDrawing(drawing, patch)).filter(Boolean);
      const result = this.engine.updateDrawingsWithHistory(before, after, options.label || "Update Drawing Properties");
      this.engine.events?.emit?.(DrawingEvents.DRAWING_PROPERTIES_UPDATED, { drawingIds: before.map((drawing) => drawing.id), patch, drawings: after });
      if (patch.style) this.engine.events?.emit?.(DrawingEvents.DRAWING_STYLE_UPDATED, { drawingIds: before.map((drawing) => drawing.id), patch: patch.style, drawings: after });
      return result;
    }
  }

  window.IntenseDrawing = window.IntenseDrawing || {};
  window.IntenseDrawing.DrawingStyleDefaults = DrawingStyleDefaults;
  window.IntenseDrawing.DrawingPropertyDefaults = DrawingPropertyDefaults;
  window.IntenseDrawing.PropertyEngine = PropertyEngine;
})();
