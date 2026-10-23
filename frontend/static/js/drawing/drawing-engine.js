/* drawing-engine.js - core coordinator for the Phase 4.1 drawing subsystem. */

(function () {
  const {
    DrawingEvents,
    DrawingEventEmitter,
    DrawingManager,
    DrawingObjectFactory,
    DrawingRenderer,
    DrawingState,
    DrawingToolRegistry,
    DrawingTypes,
    CoordinateManager,
    HitTestEngine,
    SelectionManager,
    SnapEngine,
    CommandHistory,
    DrawingClipboard,
    TransformEngine,
    PropertyEngine,
    CreateDrawingCommand,
    DeleteDrawingsCommand,
    UpdateDrawingsCommand,
    AddDrawingsCommand,
    createAnchorUtils,
    DrawingToolController,
    registerBasicCreationTools,
  } = window.IntenseDrawing || {};

  class DrawingEngine {
    constructor(options = {}) {
      this.options = options;
      this.events = options.events || new DrawingEventEmitter(options.eventTarget || window);
      this.state = options.state || new DrawingState(options.initialState || {});
      this.coordinateManager = options.coordinateManager || new CoordinateManager(options.coordinateAdapter || {});
      this.anchor = createAnchorUtils?.(this.coordinateManager) || null;
      this.factory = options.factory || new DrawingObjectFactory({ prefix: "drawing", coordinateManager: this.coordinateManager });
      this.manager = options.manager || new DrawingManager({ factory: this.factory, events: this.events });
      this.toolRegistry = options.toolRegistry || new DrawingToolRegistry({ events: this.events });
      this.renderer = options.renderer || new DrawingRenderer(options.rendererOptions || {});
      this.hitTestEngine = options.hitTestEngine || new HitTestEngine(this, options.hitTestOptions || {});
      this.selectionManager = options.selectionManager || new SelectionManager(this, { hitTestEngine: this.hitTestEngine });
      this.snapEngine = options.snapEngine || new SnapEngine(this, options.snapOptions || {});
      this.history = options.history || new CommandHistory(this, { maxHistorySize: options.maxHistorySize || 250, onChange: options.onHistoryChange });
      this.clipboard = options.clipboard || new DrawingClipboard(this);
      this.transformEngine = options.transformEngine || new TransformEngine(this, options.transformOptions || {});
      this.propertyEngine = options.propertyEngine || new PropertyEngine(this, options.propertyOptions || {});
      this.toolController = options.toolController || new DrawingToolController(this, { defaultToolId: DrawingTypes.SELECT });
      this.manager.attachEngine(this);
      this.initialized = false;
    }

    initialize(options = {}) {
      this.registerCoreTools();
      if (Array.isArray(options.existingDrawings)) {
        this.manager.importDrawings(options.existingDrawings, { legacy: true, clear: true });
      }
      this.initialized = true;
      this.events.emit(DrawingEvents.DRAWING_RENDER_REQUESTED, { reason: "initialize" });
      return this;
    }

    registerCoreTools() {
      [
        { id: DrawingTypes.SELECT, name: "Select", category: "cursor" },
        { id: DrawingTypes.CROSSHAIR, name: "Crosshair", category: "cursor" },
        { id: DrawingTypes.TEST_POINT, name: "Test Point", category: "development" },
        { id: DrawingTypes.TREND_LINE, name: "Trend Line", category: "lines" },
        { id: DrawingTypes.HORIZONTAL_LINE, name: "Horizontal Line", category: "lines" },
        { id: DrawingTypes.VERTICAL_LINE, name: "Vertical Line", category: "lines" },
        { id: DrawingTypes.RAY, name: "Ray", category: "lines" },
        { id: DrawingTypes.EXTENDED_LINE, name: "Extended Line", category: "lines" },
        { id: DrawingTypes.RECTANGLE, name: "Rectangle", category: "shapes" },
        { id: DrawingTypes.CIRCLE, name: "Circle", category: "shapes" },
        { id: DrawingTypes.TEXT, name: "Text", category: "annotation" },
      ].forEach((tool) => {
        if (!this.toolRegistry.hasTool(tool.id)) this.toolRegistry.registerTool(tool);
      });
      registerBasicCreationTools?.(this.toolRegistry);
      const makeTool = window.IntenseDrawing.createProfessionalAnchorTool;
      if (makeTool) {
        this.toolRegistry.registerTool(makeTool({id:'crossline',name:'Crossline',drawingType:DrawingTypes.HORIZONTAL_LINE,category:'LINES',requiredAnchors:1,defaultProperties:{crossline:true,priceLabelVisible:true,timeLabelVisible:true}}));
        [['abcd','ABCD Pattern','ABCD'],['xabcd','XABCD Pattern','XABCD'],['elliott-wave','Elliott Impulse Wave','012345']].forEach(([id,name,labels])=>this.toolRegistry.registerTool(makeTool({id,name,drawingType:DrawingTypes.BRUSH,category:'PATTERNS',requiredAnchors:labels.length,defaultProperties:{patternLabels:labels},metadata:{name}})));
        // Replace the old placeholder with the existing ellipse interaction.
        this.toolRegistry.unregisterTool('circle');
        this.toolRegistry.registerTool(makeTool({ id: 'circle', name: 'Circle / Ellipse', drawingType: DrawingTypes.ELLIPSE, category: 'SHAPES', requiredAnchors: 2 }));
        this.toolRegistry.registerTool(makeTool({id:'pattern-path',name:'Pattern Path',drawingType:DrawingTypes.BRUSH,category:'PATTERNS',requiredAnchors:2,creationMode:'polygon',completeOnEnter:true,completeOnDoubleClick:true}));
        [['smile','☺'],['check','✓'],['warning','⚠']].forEach(([name,text])=>this.toolRegistry.registerTool(makeTool({id:`symbol-${name}`,name:`${name} marker`,drawingType:DrawingTypes.TEXT,category:'SYMBOLS',requiredAnchors:1,metadata:{text},defaultStyle:{fontSize:24}})));
        const levels = [0,0.236,0.382,0.5,0.618,0.786,1,1.272,1.618];
        [ ['fib-extension','Fibonacci Extension','extension'], ['fib-projection','Fibonacci Projection','projection'], ['fib-channel','Fibonacci Channel','channel'] ].forEach(([id,name,mode]) => {
          if (!this.toolRegistry.hasTool(id)) this.toolRegistry.registerTool(makeTool({ id, name, drawingType: DrawingTypes.FIB_RETRACEMENT,
            category: 'FIBONACCI', requiredAnchors: 3, defaultProperties: { levels, fibMode: mode } }));
        });
        [
          { id:'arc', name:'Arc', drawingType:DrawingTypes.BRUSH, requiredAnchors:3, defaultProperties:{arc:true} },
          { id:'highlighter', name:'Highlighter', drawingType:DrawingTypes.BRUSH, requiredAnchors:2, creationMode:'freehand', defaultStyle:{width:10,opacity:0.3,color:'#f3c969'} },
          { id:'path', name:'Path', drawingType:DrawingTypes.BRUSH, requiredAnchors:2, creationMode:'polygon', completeOnDoubleClick:true,completeOnEnter:true },
          { id:'ruler', name:'Ruler', drawingType:DrawingTypes.PRICE_DATE_RANGE, requiredAnchors:2 },
          { id:'parallel-line', name:'Parallel Line', drawingType:DrawingTypes.PARALLEL_CHANNEL,requiredAnchors:3 },
        ].forEach(config=> { if(!this.toolRegistry.hasTool(config.id)) this.toolRegistry.registerTool(makeTool({category:'ADVANCED',...config})); });
        const labels = ['BOS','CHoCH','Higher High','Higher Low','Lower High','Lower Low','Liquidity','Equal High','Equal Low','Entry','Exit','Buy','Sell','Note','Callout'];
        labels.forEach(label => {
          const id = `annotation-${label.toLowerCase().replaceAll(' ', '-')}`;
          if (!this.toolRegistry.hasTool(id)) this.toolRegistry.registerTool(makeTool({ id, drawingType: DrawingTypes.TEXT,
            name: label, category: 'ANNOTATIONS', requiredAnchors: 1, metadata: { text: label }, defaultProperties: { annotationKind: label.toLowerCase() },
            defaultStyle: { textColor: label === 'Buy' ? '#00b894' : label === 'Sell' ? '#ff3b4f' : '#d1d4dc' } }));
        });
        ['Order Block','Fair Value Gap','Supply','Demand','Premium','Discount'].forEach(label => {
          const id = `zone-${label.toLowerCase().replaceAll(' ', '-')}`;
          if (!this.toolRegistry.hasTool(id)) this.toolRegistry.registerTool(makeTool({ id, drawingType: DrawingTypes.RECTANGLE,
            name: label, category: 'PRICE ACTION', requiredAnchors: 2, metadata: { text: label }, defaultProperties: { labelVisible: true } }));
        });
      }
      if (window.IntenseDrawing.createProfessionalAnchorTool && !this.toolRegistry.hasTool("test-line")) {
        const testTool = window.IntenseDrawing.createProfessionalAnchorTool({
          id: "test-line", drawingType: DrawingTypes.TREND_LINE,
          name: "Test Line", category: "development", requiredAnchors: 2,
          defaultProperties: { name: "Test Line", phase2Test: true },
        });
        // Phase 2 validates click-click creation; pointer-up must not finalize
        // a line merely because a preview endpoint was generated on mouse move.
        testTool.onPointerUp = () => false;
        this.toolRegistry.registerTool(testTool);
      }
    }

    activateTool(type, options = {}) {
      if (!this.toolRegistry.hasTool(type)) return false;
      const previousTool = this.state.activeTool;
      this.toolController.activateTool(type, options);
      this.events.emit(DrawingEvents.DRAWING_TOOL_CHANGED, { previousTool, activeTool: type });
      return true;
    }

    getActiveTool() {
      return this.state.activeTool;
    }

    createDrawing(type, attrs = {}) {
      const drawing = this.factory.create(type, attrs);
      return this.history.execute(new CreateDrawingCommand(this, drawing));
    }

    createDrawingDirect(type, attrs = {}) {
      return this.manager.createDrawing(type, attrs, { direct: true });
    }

    createTemporaryDrawing(type, attrs = {}) {
      const drawing = this.factory.create(type, attrs);
      this.state.startTemporary(drawing, "create");
      this.events.emit(DrawingEvents.DRAWING_CREATION_STARTED, { drawingId: drawing.id, type, drawing });
      return drawing;
    }

    cancelCurrentOperation() {
      const temporaryDrawing = this.state.temporaryDrawing;
      this.state.clearTemporary();
      this.events.emit(DrawingEvents.DRAWING_CREATION_CANCELLED, { drawingId: temporaryDrawing?.id || null, drawing: temporaryDrawing });
      this.renderer.requestRender({ reason: "cancel" });
    }

    getDrawing(id) {
      return this.manager.getDrawing(id);
    }

    getDrawings(filter) {
      return this.manager.getDrawings(filter);
    }

    updateDrawing(id, changes) {
      const result = this.manager.updateDrawing(id, changes, { direct: true });
      this.renderer.requestRender({ reason: "update", drawingId: id });
      return result;
    }

    updateDrawingsWithHistory(before = [], after = [], label = "Update Drawings") {
      return this.history.execute(new UpdateDrawingsCommand(this, before, after, label));
    }

    updateDrawingProperties(ids = [], patch = {}, options = {}) {
      return this.propertyEngine.applyToDrawings(ids, patch, options);
    }

    deleteDrawing(id) {
      return this.deleteDrawings([id]);
    }

    deleteDrawings(ids = []) {
      const drawings = ids.map((id) => this.getDrawing(id)).filter(Boolean);
      if (!drawings.length) return null;
      return this.history.execute(new DeleteDrawingsCommand(this, drawings));
    }

    registerDrawingsWithHistory(drawings = [], previousSelection = []) {
      if (!drawings.length) return null;
      return this.history.execute(new AddDrawingsCommand(this, drawings, previousSelection));
    }

    copySelectedDrawings() {
      return this.clipboard.copy(this.selectionManager.getSelectedObjects());
    }

    pasteDrawings(options = {}) {
      if (!this.clipboard.hasItems()) return null;
      const copies = this.clipboard.createPasteCopies(options.offsetCandles || 3, options.priceOffset || 0);
      return this.registerDrawingsWithHistory(copies, this.state.selectedDrawingIds);
    }

    duplicateSelectedDrawings(options = {}) {
      const selected = this.selectionManager.getSelectedObjects();
      if (!selected.length) return null;
      const clipboard = new DrawingClipboard(this);
      clipboard.copy(selected);
      const copies = clipboard.createPasteCopies(options.offsetCandles || 4, options.priceOffset || 0);
      return this.registerDrawingsWithHistory(copies, this.state.selectedDrawingIds);
    }

    undo() {
      return this.history.undo();
    }

    redo() {
      return this.history.redo();
    }

    canUndo() {
      return this.history.canUndo();
    }

    canRedo() {
      return this.history.canRedo();
    }

    clear() {
      this.manager.clearDrawings();
      this.state.clearSelection();
      this.state.clearTemporary();
      this.renderer.requestRender({ reason: "clear" });
    }

    render(viewport = {}) {
      return this.renderer.render(this.getDrawings((drawing) => drawing.visible !== false), viewport);
    }

    setCoordinateAdapter(adapter = {}) {
      this.coordinateManager.setAdapter(adapter);
    }

    getCoordinateContext() {
      return this.coordinateManager.getCoordinateContext();
    }

    screenToLogical(x, y) {
      return this.coordinateManager.screenToLogical(x, y);
    }

    snapLogical(logical, options = {}) {
      return this.snapEngine.snap(logical, options);
    }

    setMagnetEnabled(enabled) {
      return this.snapEngine.setMagnetEnabled(enabled);
    }

    isMagnetEnabled() {
      return !!this.state.magnetEnabled;
    }

    logicalToScreen(timeOrAnchor, price) {
      return this.coordinateManager.logicalToScreen(timeOrAnchor, price);
    }

    hitTest(point, options = {}) {
      return this.selectionManager.hitTest(point, options);
    }

    selectDrawing(id, options = {}) {
      return this.selectionManager.select(id, options);
    }

    clearSelection(options = {}) {
      return this.selectionManager.clearSelection(options);
    }

    hoverDrawing(id) {
      return this.selectionManager.hover(id);
    }

    startSelectionDrag(hit, logical) {
      return this.selectionManager.startDrag(hit, logical);
    }

    updateSelectionDrag(logical) {
      return this.selectionManager.updateDrag(logical);
    }

    endSelectionDrag() {
      return this.selectionManager.endDrag();
    }

    cancelSelectionDrag() {
      return this.selectionManager.cancelDrag();
    }

    createAnchor(time, price, metadata = {}) {
      return this.coordinateManager.createAnchor(time, price, metadata);
    }

    handlePointerDown(event) {
      return this.toolController.pointerDown(event);
    }

    handlePointerMove(event) {
      return this.toolController.pointerMove(event);
    }

    handlePointerUp(event) {
      return this.toolController.pointerUp(event);
    }

    handleDoubleClick(event) {
      return this.toolController.doubleClick(event);
    }

    handleKeyDown(event) {
      return this.toolController.keyDown(event);
    }

    destroy() {
      this.initialized = false;
      this.state.clearTemporary();
      this.state.clearSelection();
    }
  }

  window.IntenseDrawing = window.IntenseDrawing || {};
  window.IntenseDrawing.DrawingEngine = DrawingEngine;
})();
