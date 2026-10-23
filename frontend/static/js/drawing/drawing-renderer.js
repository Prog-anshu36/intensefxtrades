/* drawing-renderer.js - render interface shell for future canvas overlay work. */

(function () {
  const DrawingRenderLayers = Object.freeze({
    BACKGROUND: "background",
    DRAWINGS: "drawings",
    TRADING_OBJECTS: "trading-objects",
    LABELS: "labels",
    SELECTION: "selection",
    CROSSHAIR: "crosshair",
  });

  class DrawingRenderer {
    constructor(options = {}) {
      this.layers = options.layers || Object.values(DrawingRenderLayers);
      this.adapter = options.adapter || null;
    }

    render(drawings = [], viewport = {}) {
      if (this.adapter?.render) {
        return this.adapter.render(drawings, viewport);
      }
      return { drawingsRendered: drawings.length, viewport };
    }

    requestRender(detail = {}) {
      if (this.adapter?.requestRender) this.adapter.requestRender(detail);
    }
  }

  window.IntenseDrawing = window.IntenseDrawing || {};
  window.IntenseDrawing.DrawingRenderLayers = DrawingRenderLayers;
  window.IntenseDrawing.DrawingRenderer = DrawingRenderer;
})();
