/* drawing-tools.js - professional drawing tool definitions built on the shared lifecycle. */

(function () {
  const { DrawingTypes = {}, ToolCategories = {} } = window.IntenseDrawing || {};

  const DrawingToolCreationModes = Object.freeze({
    ONE_POINT: "one-point",
    TWO_POINT: "two-point",
    THREE_POINT: "three-point",
    FREEHAND: "freehand",
    POLYGON: "polygon",
  });

  const DrawingToolCapabilities = Object.freeze({
    snap: true,
    selection: true,
    transform: true,
    style: true,
    history: true,
    persistence: true,
  });

  function createAnchorTool(config) {
    const {
      id,
      drawingType = id,
      name,
      category,
      icon = id,
      requiredAnchors = 2,
      creationMode = requiredAnchors === 1 ? DrawingToolCreationModes.ONE_POINT : DrawingToolCreationModes.TWO_POINT,
      cursor = "crosshair",
      defaultStyle = {},
      defaultProperties = {},
      metadata = {},
      capabilities = {},
      shortcuts = [],
      completeOnDoubleClick = false,
      completeOnEnter = false,
    } = config;
    return {
      id,
      drawingType,
      name,
      category,
      icon,
      version: 1,
      cursor,
      requiredAnchors,
      persistent: false,
      canPreview: true,
      creationMode,
      capabilities: { ...DrawingToolCapabilities, ...capabilities },
      shortcuts,
      defaultMetadata: metadata,
      defaultStyle: { color: "#d1d4dc", width: 1.5, opacity: 1, ...defaultStyle },
      defaultProperties,
      getDefaultStyle() { return this.defaultStyle; },
      getProperties() { return this.defaultProperties; },
      getSupportedTransforms() { return this.capabilities.transform ? ["move", "anchor", "resize"] : ["move"]; },
      getGeometry(drawing) { return drawing?.anchors || []; },
      hitTest() { return null; },
      render() { return null; },
      onPointerMove(ctx) {
        if (!ctx.logical) return false;
        if (creationMode === DrawingToolCreationModes.FREEHAND && !ctx.engine.toolController.pointerStart) return false;
        const temporary = ctx.state.temporaryDrawing;
        const committedCount = temporary?.metadata?.committedAnchorCount || 0;
        const committed = temporary?.anchors?.slice(0, committedCount) || [];
        let anchors = committed.length ? [...committed, ctx.logical] : [ctx.logical];
        if (creationMode === DrawingToolCreationModes.FREEHAND && temporary?.anchors?.length) {
          const last = temporary.anchors[temporary.anchors.length - 1];
          const priceDelta = Math.abs(Number(ctx.logical.price) - Number(last.price));
          const timeDelta = Math.abs(Number(ctx.logical.time) - Number(last.time ?? last.timestamp));
          if (timeDelta < 1 && priceDelta < Math.max(1e-9, Math.abs(Number(ctx.logical.price)) * 0.00005)) return false;
          anchors = [...temporary.anchors, ctx.logical];
        }
        ctx.engine.toolController.updateTemporary(this, anchors);
        return true;
      },
      onPointerDown(ctx) {
        if (!ctx.logical) return false;
        const temporary = ctx.state.temporaryDrawing;
        const committedCount = temporary?.metadata?.committedAnchorCount || 0;
        const existing = temporary?.anchors?.slice(0, committedCount) || [];
        let anchors = requiredAnchors === 1 ? [ctx.logical] : [...existing, ctx.logical];
        if (creationMode === DrawingToolCreationModes.FREEHAND) anchors = temporary?.anchors?.length ? [...temporary.anchors, ctx.logical] : [ctx.logical];
        const next = ctx.engine.toolController.updateTemporary(this, anchors);
        next.metadata = { ...(next.metadata || {}), ...metadata, committedAnchorCount: anchors.length };
        next.properties = { ...(next.properties || {}), ...defaultProperties, toolId: id, version: 1 };
        ctx.state.temporaryDrawing = next;
        if (creationMode !== DrawingToolCreationModes.FREEHAND && creationMode !== DrawingToolCreationModes.POLYGON && anchors.length >= requiredAnchors) ctx.complete(this, next);
        return true;
      },
      onPointerUp(ctx) {
        if (creationMode === DrawingToolCreationModes.POLYGON) return false;
        if (creationMode !== DrawingToolCreationModes.FREEHAND && requiredAnchors !== 2) return false;
        const drawing = ctx.state.temporaryDrawing;
        if (!drawing || (drawing.anchors || []).length < 2) return false;
        ctx.complete(this, drawing);
        return true;
      },
      onDoubleClick(ctx) {
        if (!completeOnDoubleClick && creationMode !== DrawingToolCreationModes.FREEHAND && creationMode !== DrawingToolCreationModes.POLYGON) return false;
        const drawing = ctx.state.temporaryDrawing;
        if (!drawing || (drawing.anchors || []).length < Math.min(requiredAnchors, 2)) return false;
        ctx.complete(this, drawing);
        return true;
      },
      onKeyDown(ctx) {
        if (ctx.event?.key === "Escape") {
          ctx.cancel();
          return true;
        }
        if (ctx.event?.key !== "Enter" || (!completeOnEnter && creationMode !== DrawingToolCreationModes.POLYGON)) return false;
        const drawing = ctx.state.temporaryDrawing;
        if (!drawing || (drawing.anchors || []).length < Math.min(requiredAnchors, 2)) return false;
        ctx.complete(this, drawing);
        return true;
      },
      cancel(ctx) {
        ctx?.cancel?.();
      },
    };
  }

  function createPositionTool(config) {
    const { id, drawingType, name, direction, shortcuts = [] } = config;
    const isLong = direction === "long";
    const riskColor = "#ff3b4f";
    const profitColor = "#00b894";
    function timeRangeAround(ctx, anchor) {
      const cm = ctx.coordinateManager;
      const currentIndex = cm?.timeToIndex?.(anchor.time);
      const startIndex = Number.isFinite(currentIndex) ? Math.max(0, currentIndex - 8) : null;
      const endIndex = Number.isFinite(currentIndex) ? currentIndex + 24 : null;
      const candles = cm?.adapter?.getCandles?.() || [];
      const indexToTime = (index) => {
        const projected = cm?.indexToTime?.(index);
        if (Number.isFinite(projected)) return projected;
        const candle = candles[Math.max(0, Math.min(candles.length - 1, Math.round(index)))];
        return candle?.date instanceof Date ? candle.date.getTime() : candle?.time ?? candle?.timestamp ?? anchor.time;
      };
      return {
        start: startIndex !== null ? indexToTime(startIndex) : anchor.time,
        end: endIndex !== null ? indexToTime(endIndex) : anchor.time,
      };
    }
    function geometryFrom(entry, pointer, ctx) {
      const move = Math.abs(Number(pointer.price) - Number(entry.price));
      const fallback = Math.max(Math.abs(Number(entry.price)) * 0.001, 0.0001);
      const risk = Math.max(move || fallback, fallback);
      const reward = risk * 2;
      const stopLoss = isLong ? Number(entry.price) - risk : Number(entry.price) + risk;
      const takeProfit = isLong ? Number(entry.price) + reward : Number(entry.price) - reward;
      return {
        direction,
        entry: { time: entry.time, price: Number(entry.price) },
        stopLoss: { price: stopLoss },
        takeProfit: { price: takeProfit },
        timeRange: Math.abs(Number(pointer.time) - Number(entry.time)) >= 1000
          ? {start: Math.min(Number(entry.time), Number(pointer.time)), end: Math.max(Number(entry.time), Number(pointer.time))}
          : timeRangeAround(ctx, entry),
      };
    }
    function anchorsFromGeometry(ctx, geometry) {
      const cm = ctx.coordinateManager;
      return [
        cm.createAnchor(geometry.entry.time, geometry.entry.price, { role: "entry" }),
        cm.createAnchor(geometry.entry.time, geometry.stopLoss.price, { role: "stop" }),
        cm.createAnchor(geometry.entry.time, geometry.takeProfit.price, { role: "target" }),
        cm.createAnchor(geometry.timeRange.start, geometry.entry.price, { role: "start" }),
        cm.createAnchor(geometry.timeRange.end, geometry.entry.price, { role: "end" }),
      ].filter(Boolean);
    }
    function update(ctx, committed = false) {
      if (!ctx.logical) return false;
      const temporary = ctx.state.temporaryDrawing;
      const existingCommitted = temporary?.metadata?.committedAnchorCount || 0;
      const entry = existingCommitted >= 1 && temporary?.geometry?.entry ? temporary.geometry.entry : ctx.logical;
      const geometry = geometryFrom(entry, ctx.logical, ctx);
      const anchors = anchorsFromGeometry(ctx, geometry);
      const next = ctx.engine.toolController.updateTemporary(this, anchors);
      next.geometry = geometry;
      next.metadata = { ...(next.metadata || {}), committedAnchorCount: committed ? 2 : existingCommitted, direction, analysisOnly: true };
      next.properties = { ...(next.properties || {}), toolId: id, version: 1, showEntry: true, showStop: true, showTarget: true, showRisk: true, showReward: true, showRR: true, showPrice: true, showPercentage: true };
      ctx.state.temporaryDrawing = next;
      return next;
    }
    return {
      id,
      drawingType,
      name,
      category: ToolCategories.POSITION_TOOLS,
      icon: id,
      description: isLong ? "Plan a bullish risk/reward setup." : "Plan a bearish risk/reward setup.",
      cursor: "crosshair",
      requiredAnchors: 2,
      persistent: false,
      canPreview: true,
      creationMode: DrawingToolCreationModes.TWO_POINT,
      capabilities: { ...DrawingToolCapabilities, positionAnalysis: true },
      shortcuts,
      defaultMetadata: { direction, analysisOnly: true },
      defaultStyle: {
        color: "#d1d4dc",
        width: 1.4,
        opacity: 1,
        profitColor,
        riskColor,
        entryColor: "#d1d4dc",
        stopColor: riskColor,
        targetColor: profitColor,
        fillOpacity: 0.35,
      },
      defaultProperties: {
        showEntry: true,
        showStop: true,
        showTarget: true,
        showRisk: true,
        showReward: true,
        showRR: true,
        showPrice: true,
        showPercentage: true,
        analysisOnly: true,
      },
      getDefaultStyle() { return this.defaultStyle; },
      getProperties() { return this.defaultProperties; },
      onPointerMove(ctx) {
        return !!update.call(this, ctx, false);
      },
      onPointerDown(ctx) {
        const temporary = ctx.state.temporaryDrawing;
        const committedCount = temporary?.metadata?.committedAnchorCount || 0;
        if (committedCount < 1) {
          update.call(this, ctx, false);
          ctx.state.temporaryDrawing.metadata = { ...(ctx.state.temporaryDrawing.metadata || {}), committedAnchorCount: 1, direction, analysisOnly: true };
          return true;
        }
        const next = update.call(this, ctx, true);
        if (next) ctx.complete(this, next);
        return true;
      },
      onPointerUp(ctx) {
        const drawing = ctx.state.temporaryDrawing;
        const entry = drawing?.geometry?.entry;
        if (!drawing || !entry || (drawing.metadata?.committedAnchorCount || 0) < 1 || !ctx.logical) return false;
        const movedTime = Math.abs(Number(ctx.logical.time) - Number(entry.time));
        const movedPrice = Math.abs(Number(ctx.logical.price) - Number(entry.price));
        const minPriceMove = Math.max(Math.abs(Number(entry.price)) * 0.00002, 0.00001);
        // A click creates the entry and leaves the risk/reward preview open;
        // a real drag releases the tool with the stop/target already sized.
        if (movedTime < 1000 && movedPrice < minPriceMove) return false;
        ctx.complete(this, drawing);
        return true;
      },
      onKeyDown(ctx) {
        if (ctx.event?.key !== "Escape") return false;
        ctx.cancel();
        return true;
      },
      cancel(ctx) {
        ctx?.cancel?.();
      },
    };
  }

  function registerProfessionalDrawingTools(registry) {
    const tools = [
      createAnchorTool({ id: DrawingTypes.HORIZONTAL_LINE, name: "Horizontal Line", category: ToolCategories.LINES, icon: "horizontal-line", requiredAnchors: 1, shortcuts: ["Alt+H"], defaultProperties: { priceLabelVisible: true } }),
      createAnchorTool({ id: DrawingTypes.VERTICAL_LINE, name: "Vertical Line", category: ToolCategories.LINES, icon: "vertical-line", requiredAnchors: 1, shortcuts: ["Alt+V"] }),
      createAnchorTool({ id: DrawingTypes.TREND_LINE, name: "Trend Line", category: ToolCategories.LINES, icon: "trend-line", requiredAnchors: 2, shortcuts: ["Alt+T"], capabilities: { extend: true, labels: true } }),
      createAnchorTool({ id: DrawingTypes.RAY, name: "Ray", category: ToolCategories.LINES, icon: "ray", requiredAnchors: 2, shortcuts: ["Alt+R"] }),
      createAnchorTool({ id: DrawingTypes.EXTENDED_LINE, name: "Extended Line", category: ToolCategories.LINES, icon: "extended-line", requiredAnchors: 2 }),
      createAnchorTool({ id: DrawingTypes.ARROW, name: "Arrow", category: ToolCategories.LINES, icon: "arrow", requiredAnchors: 2, defaultProperties: { arrowStart: false, arrowEnd: true, arrowSize: 12 } }),
      createAnchorTool({ id: DrawingTypes.HORIZONTAL_RAY, name: "Horizontal Ray", category: ToolCategories.LINES, icon: "horizontal-ray", requiredAnchors: 1, defaultProperties: { direction: "right" } }),
      createAnchorTool({ id: DrawingTypes.VERTICAL_RAY, name: "Vertical Ray", category: ToolCategories.LINES, icon: "vertical-ray", requiredAnchors: 1, defaultProperties: { direction: "down" } }),
      createAnchorTool({ id: DrawingTypes.RECTANGLE, name: "Rectangle", category: ToolCategories.SHAPES, icon: "rectangle", requiredAnchors: 2, shortcuts: ["Alt+Q"], defaultStyle: { fillOpacity: 0.16 } }),
      createAnchorTool({ id: DrawingTypes.ELLIPSE, name: "Ellipse", category: ToolCategories.SHAPES, icon: "ellipse", requiredAnchors: 2, defaultStyle: { fillOpacity: 0.12 } }),
      createAnchorTool({ id: DrawingTypes.TRIANGLE, name: "Triangle", category: ToolCategories.SHAPES, icon: "triangle", requiredAnchors: 3, creationMode: DrawingToolCreationModes.THREE_POINT }),
      createAnchorTool({ id: DrawingTypes.POLYGON, name: "Polygon", category: ToolCategories.SHAPES, icon: "polygon", requiredAnchors: 3, creationMode: DrawingToolCreationModes.POLYGON, completeOnDoubleClick: true, completeOnEnter: true }),
      createAnchorTool({ id: DrawingTypes.PARALLEL_CHANNEL, name: "Parallel Channel", category: ToolCategories.CHANNELS, icon: "parallel-channel", requiredAnchors: 3, creationMode: DrawingToolCreationModes.THREE_POINT }),
      createAnchorTool({ id: DrawingTypes.FIB_RETRACEMENT, name: "Fibonacci Retracement", category: ToolCategories.FIBONACCI, icon: "fib-retracement", requiredAnchors: 2, shortcuts: ["Alt+F"], defaultStyle: {width: 1, fillOpacity: 0}, defaultProperties: { levels: [0.382, 0.5, 0.618, 0.66], reverse: false, backgroundVisible: false } }),
      createAnchorTool({ id: DrawingTypes.PRICE_RANGE, name: "Price Range", category: ToolCategories.MEASUREMENTS, icon: "price-range", requiredAnchors: 2 }),
      createAnchorTool({ id: DrawingTypes.DATE_RANGE, name: "Date Range", category: ToolCategories.MEASUREMENTS, icon: "date-range", requiredAnchors: 2 }),
      createAnchorTool({ id: DrawingTypes.PRICE_DATE_RANGE, name: "Price + Date Range", category: ToolCategories.MEASUREMENTS, icon: "measure", requiredAnchors: 2, shortcuts: ["Alt+M"] }),
      createPositionTool({ id: DrawingTypes.LONG_POSITION, drawingType: DrawingTypes.LONG_POSITION, name: "Long Position", direction: "long", shortcuts: ["Alt+L"] }),
      createPositionTool({ id: DrawingTypes.SHORT_POSITION, drawingType: DrawingTypes.SHORT_POSITION, name: "Short Position", direction: "short", shortcuts: ["Alt+K"] }),
      createAnchorTool({ id: DrawingTypes.TEXT, name: "Text", category: ToolCategories.ANNOTATIONS, icon: "text", requiredAnchors: 1, shortcuts: ["Alt+X"], cursor: "text", defaultStyle: { textColor: "#d1d4dc", fontSize: 13 }, metadata: { text: "Text" } }),
      createAnchorTool({ id: DrawingTypes.BRUSH, name: "Brush", category: ToolCategories.ANNOTATIONS, icon: "brush", requiredAnchors: 2, shortcuts: ["Alt+B"], creationMode: DrawingToolCreationModes.FREEHAND, completeOnDoubleClick: true, completeOnEnter: true }),
    ];
    tools.forEach((tool) => {
      if (registry.hasTool(tool.id)) registry.unregisterTool(tool.id);
      registry.registerTool(tool);
    });
  }

  window.IntenseDrawing = window.IntenseDrawing || {};
  window.IntenseDrawing.DrawingToolCreationModes = DrawingToolCreationModes;
  window.IntenseDrawing.createProfessionalAnchorTool = createAnchorTool;
  window.IntenseDrawing.createPositionTool = createPositionTool;
  window.IntenseDrawing.registerProfessionalDrawingTools = registerProfessionalDrawingTools;
})();
