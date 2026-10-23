/* drawing/index.js - public namespace helpers for the drawing engine. */

(function () {
  function createDrawingEngine(options = {}) {
    return new window.IntenseDrawing.DrawingEngine(options);
  }

  window.IntenseDrawing = window.IntenseDrawing || {};
  window.IntenseDrawing.createDrawingEngine = createDrawingEngine;
  window.IntenseDrawing.createHitTestEngine = (engine, options = {}) => new window.IntenseDrawing.HitTestEngine(engine, options);
  window.IntenseDrawing.createSelectionManager = (engine, options = {}) => new window.IntenseDrawing.SelectionManager(engine, options);
  window.IntenseDrawing.createSnapEngine = (engine, options = {}) => new window.IntenseDrawing.SnapEngine(engine, options);
  window.IntenseDrawing.createCommandHistory = (engine, options = {}) => new window.IntenseDrawing.CommandHistory(engine, options);
  window.IntenseDrawing.createTransformEngine = (engine, options = {}) => new window.IntenseDrawing.TransformEngine(engine, options);
  window.IntenseDrawing.createPropertyEngine = (engine, options = {}) => new window.IntenseDrawing.PropertyEngine(engine, options);
})();
