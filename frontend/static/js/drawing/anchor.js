/* anchor.js - public anchor helpers backed by CoordinateManager instances. */

(function () {
  function createAnchorUtils(coordinateManager) {
    return {
      createAnchor: (...args) => coordinateManager.createAnchor(...args),
      validateAnchor: (...args) => coordinateManager.validateAnchor(...args),
      normalizeAnchor: (...args) => coordinateManager.normalizeAnchor(...args),
      getAnchorScreenPosition: (...args) => coordinateManager.getAnchorScreenPosition(...args),
      getAnchorLogicalPosition: (...args) => coordinateManager.getAnchorLogicalPosition(...args),
      updateAnchor: (...args) => coordinateManager.updateAnchor(...args),
      serializeAnchor: (...args) => coordinateManager.serializeAnchor(...args),
      deserializeAnchor: (...args) => coordinateManager.deserializeAnchor(...args),
    };
  }

  window.IntenseDrawing = window.IntenseDrawing || {};
  window.IntenseDrawing.createAnchorUtils = createAnchorUtils;
})();
