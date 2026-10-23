/* drawing-types.js - shared drawing type constants for the drawing engine. */

(function () {
  const DrawingTypes = Object.freeze({
    SELECT: "select",
    CROSSHAIR: "crosshair",
    TEST_POINT: "test-point",
    TREND_LINE: "trend-line",
    HORIZONTAL_LINE: "horizontal-line",
    VERTICAL_LINE: "vertical-line",
    RAY: "ray",
    EXTENDED_LINE: "extended-line",
    ARROW: "arrow",
    HORIZONTAL_RAY: "horizontal-ray",
    VERTICAL_RAY: "vertical-ray",
    RECTANGLE: "rectangle",
    CIRCLE: "circle",
    ELLIPSE: "ellipse",
    TRIANGLE: "triangle",
    POLYGON: "polygon",
    PARALLEL_CHANNEL: "parallel-channel",
    FIB_RETRACEMENT: "fib-retracement",
    PRICE_RANGE: "price-range",
    DATE_RANGE: "date-range",
    PRICE_DATE_RANGE: "price-date-range",
    LONG_POSITION: "long-position",
    SHORT_POSITION: "short-position",
    BRUSH: "brush",
    TEXT: "text",
  });

  const ToolCategories = Object.freeze({
    CURSOR: "CURSOR",
    LINES: "LINES",
    SHAPES: "SHAPES",
    CHANNELS: "CHANNELS",
    FIBONACCI: "FIBONACCI",
    PITCHFORK: "PITCHFORK",
    MEASUREMENTS: "MEASUREMENTS",
    ANNOTATIONS: "ANNOTATIONS",
    POSITION_TOOLS: "POSITION_TOOLS",
    ADVANCED: "ADVANCED",
    OTHER: "OTHER",
  });

  const LegacyDrawingTypeMap = Object.freeze({
    trendLine: DrawingTypes.TREND_LINE,
    horizontalLine: DrawingTypes.HORIZONTAL_LINE,
    verticalLine: DrawingTypes.VERTICAL_LINE,
    ray: DrawingTypes.RAY,
    extendedLine: DrawingTypes.EXTENDED_LINE,
    arrow: DrawingTypes.ARROW,
    horizontalRay: DrawingTypes.HORIZONTAL_RAY,
    verticalRay: DrawingTypes.VERTICAL_RAY,
    rectangle: DrawingTypes.RECTANGLE,
    circle: DrawingTypes.ELLIPSE,
    ellipse: DrawingTypes.ELLIPSE,
    triangle: DrawingTypes.TRIANGLE,
    polygon: DrawingTypes.POLYGON,
    parallelChannel: DrawingTypes.PARALLEL_CHANNEL,
    text: DrawingTypes.TEXT,
    polyline: DrawingTypes.BRUSH,
    brush: DrawingTypes.BRUSH,
    fibRetracement: DrawingTypes.FIB_RETRACEMENT,
    riskReward: DrawingTypes.PRICE_DATE_RANGE,
    longPosition: DrawingTypes.LONG_POSITION,
    shortPosition: DrawingTypes.SHORT_POSITION,
    priceRange: DrawingTypes.PRICE_RANGE,
    dateRange: DrawingTypes.DATE_RANGE,
  });

  window.IntenseDrawing = window.IntenseDrawing || {};
  window.IntenseDrawing.DrawingTypes = DrawingTypes;
  window.IntenseDrawing.ToolCategories = ToolCategories;
  window.IntenseDrawing.LegacyDrawingTypeMap = LegacyDrawingTypeMap;
  window.IntenseDrawing.fibRetracementLevels = (levels) => {
    const oldDefaults = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.272, 1.618];
    return !Array.isArray(levels) || JSON.stringify(levels) === JSON.stringify(oldDefaults)
      ? [0.382, 0.5, 0.618, 0.66] : levels;
  };
  // Works on either prices or transformed Y values; anchor order defines the swing.
  window.IntenseDrawing.fibLevelValue = (start, end, ratio, properties = {}, third = end) => {
    const first = properties.reverse ? end : start;
    const second = properties.reverse ? start : end;
    return ['extension', 'projection'].includes(properties.fibMode)
      ? third + (second - first) * ratio
      : second + (first - second) * ratio;
  };
})();
