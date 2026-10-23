# Phase 2 drawing engine

Retains the Phase 1 Canvas 2D chart, CoordinateManager, drawing canvas, shared
Store and pointer controller. Reuses the existing drawing modules rather than
introducing another collection or coordinate system. No advanced tools added.

DrawingManager owns a Map of DrawingObjects, with stable IDs, registered types,
timestamp/price anchors, normalized styles, visibility and lock flags. The
DrawingEngine attaches selection, transforms, renderer and command history to
the manager. Public create/update/delete operations are undoable; history
commands use explicit direct mutations to avoid recursively recording history.

Manager APIs: createDrawing, selectDrawing, moveDrawing, moveAnchor,
updateDrawing(id, changes), editDrawing, setLocked, setVisible, duplicateDrawing,
deleteDrawing, deleteSelected, deleteAll, hitTest, render, undo and redo.
Creation APIs: startDrawing(toolId, anchor), updateDrawing(anchors) or
updatePreview(anchors), finishDrawing and cancelDrawing. getToolState exposes
the active tool, drawing mode, selected ID and creation state.

Test Line is a two-click development tool using the existing generic line
geometry. It supports preview without pointer-up prematurely finalizing it.
ESC, Delete, existing Ctrl+Z/Ctrl+Shift+Z and added Ctrl+Y integrate with the
existing interaction controller. Existing functional context actions and
properties panel are reused. Locked objects remain selectable but cannot
receive style edits, object moves or anchor moves; visibility and unlocking
remain available.

Draw-only paints reuse the rendered camera frame. Pointer drag no longer
requests the candle renderer. Cleanup cancels pending creation/drag and removes
keyboard, resize and context-action listeners and animation callbacks.

Validation: all 16 JavaScript suites passed. Phase 2 tests cover lifecycle,
hit tolerance, moves, anchors, delete/undo/redo, locking, visibility, duplicates,
coordinate stability under camera/size changes and serialized restore. Existing
selection/transform/tool lifecycle suites exercise pointer dragging and handles.
Live browser verified two-click test-line creation, selected endpoint handles,
and restoration after reload on the real local CSV XAUUSD chart; no errors.

Remaining limitation: history is session-local; drawings survive reload through
the existing localStorage persistence, but undo history does not. Advanced
tool types already present in the app were retained and not expanded this phase.
