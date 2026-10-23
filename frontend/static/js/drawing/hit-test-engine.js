/* hit-test-engine.js - screen-space hit testing for logical drawing objects. */

(function () {
  const { DrawingTypes = {} } = window.IntenseDrawing || {};

  const LEGACY_TYPE = {
    trendLine: DrawingTypes.TREND_LINE,
    horizontalLine: DrawingTypes.HORIZONTAL_LINE,
    verticalLine: DrawingTypes.VERTICAL_LINE,
    rectangle: DrawingTypes.RECTANGLE,
    ray: DrawingTypes.RAY,
    extendedLine: DrawingTypes.EXTENDED_LINE,
    arrow: DrawingTypes.ARROW,
    horizontalRay: DrawingTypes.HORIZONTAL_RAY,
      verticalRay: DrawingTypes.VERTICAL_RAY,
      longPosition: DrawingTypes.LONG_POSITION,
      shortPosition: DrawingTypes.SHORT_POSITION,
    text: DrawingTypes.TEXT,
    ellipse: DrawingTypes.ELLIPSE,
    triangle: DrawingTypes.TRIANGLE,
    polygon: DrawingTypes.POLYGON,
    parallelChannel: DrawingTypes.PARALLEL_CHANNEL,
    fibRetracement: DrawingTypes.FIB_RETRACEMENT,
    polyline: DrawingTypes.BRUSH,
    riskReward: DrawingTypes.PRICE_DATE_RANGE,
  };

  class HitTestEngine {
    constructor(engine, options = {}) {
      this.engine = engine;
      this.tolerance = options.tolerance || 8;
      this.handleTolerance = options.handleTolerance || 10;
    }

    hitTest(point, options = {}) {
      const hits = this.hitTestAll(point, options);
      return hits[0] || null;
    }

    hitTestAll(point, options = {}) {
      const drawings = options.drawings || this.engine.getDrawings();
      const selectedIds = new Set(options.selectedIds || this.engine.state.selectedDrawingIds || []);
      const screenPoint = this.toScreenPoint(point);
      if (!screenPoint) return [];
      const hits = [];
      drawings.forEach((drawing, order) => {
        if (!this.isInteractive(drawing)) return;
        const normalized = this.normalizeType(drawing.type);
        const handleHit = selectedIds.has(drawing.id) ? this.hitTestHandles(drawing, screenPoint) : null;
        if (handleHit) {
          hits.push({ ...handleHit, drawing, drawingId: drawing.id, priority: selectedIds.has(drawing.id) ? 0 : 2, order });
          return;
        }
        const bodyHit = this.hitTestBody({ ...drawing, type: normalized }, screenPoint);
        if (bodyHit) {
          hits.push({
            drawing,
            drawingId: drawing.id,
            hitType: bodyHit.hitType || "body",
            anchorIndex: bodyHit.anchorIndex ?? null,
            handle: bodyHit.handle || null,
            distance: bodyHit.distance,
            priority: selectedIds.has(drawing.id) ? 1 : 3,
            order,
          });
        }
      });
      return hits.sort((a, b) => (
        a.priority - b.priority ||
        a.distance - b.distance ||
        (b.drawing.layer || 0) - (a.drawing.layer || 0) ||
        b.order - a.order
      ));
    }

    hitTestHandles(drawing, point) {
      const transformHit = this.engine.transformEngine?.hitTestHandle?.(drawing, point);
      if (transformHit) {
        return {
          hitType: transformHit.kind === "anchor" ? "anchor" : "handle",
          anchorIndex: transformHit.anchorIndex,
          handle: transformHit,
          distance: transformHit.distance,
        };
      }
      return null;
    }

    hitTestBody(drawing, point) {
      const pts = (drawing.anchors || []).map((anchor) => this.projectAnchor(anchor)).filter(Boolean);
      if (!pts.length) return null;
      if (drawing.properties?.crossline) {
        const distance=Math.min(Math.abs(point.x-pts[0].x),Math.abs(point.y-pts[0].y));
        return distance<=this.tolerance?{hitType:'line',distance}:null;
      }
      if (drawing.properties?.arc && pts.length>=3) {
        const [a,b,c]=pts;let previous=a,best=Infinity;
        for(let i=1;i<=48;i++){const t=i/48,u=1-t;const next={x:u*u*a.x+2*u*t*c.x+t*t*b.x,y:u*u*a.y+2*u*t*c.y+t*t*b.y};best=Math.min(best,this.distanceToSegment(point,previous,next));previous=next;}
        return best<=this.tolerance?{hitType:'curve',distance:best}:null;
      }
      if (pts.length>=2 && ([DrawingTypes.RAY,DrawingTypes.EXTENDED_LINE].includes(drawing.type) || drawing.properties?.extendLeft || drawing.properties?.extendRight) && drawing.type !== DrawingTypes.RECTANGLE && drawing.type !== DrawingTypes.FIB_RETRACEMENT) {
        const [a,b]=pts,dx=b.x-a.x,dy=b.y-a.y,length=dx*dx+dy*dy;
        if(length>0){const t=((point.x-a.x)*dx+(point.y-a.y)*dy)/length;
          const left=drawing.type===DrawingTypes.EXTENDED_LINE || drawing.properties?.extendLeft;
          const right=drawing.type===DrawingTypes.EXTENDED_LINE || drawing.type===DrawingTypes.RAY || drawing.properties?.extendRight;
          if((left||t>=0)&&(right||t<=1)){const distance=Math.hypot(point.x-(a.x+t*dx),point.y-(a.y+t*dy));return distance<=this.tolerance?{hitType:'line',distance}:null;}
          return null;
        }
      }
      if (drawing.type === DrawingTypes.HORIZONTAL_LINE) {
        const distance = Math.abs(point.y - pts[0].y);
        return distance <= this.tolerance ? { hitType: "line", distance } : null;
      }
      if (drawing.type === DrawingTypes.VERTICAL_LINE) {
        const distance = Math.abs(point.x - pts[0].x);
        return distance <= this.tolerance ? { hitType: "line", distance } : null;
      }
      if (drawing.type === DrawingTypes.HORIZONTAL_RAY) {
        const p = pts[0];
        const right = drawing.properties?.direction !== "left";
        const inDirection = right ? point.x >= p.x - this.tolerance : point.x <= p.x + this.tolerance;
        const distance = Math.abs(point.y - p.y);
        return inDirection && distance <= this.tolerance ? { hitType: "line", distance } : null;
      }
      if (drawing.type === DrawingTypes.VERTICAL_RAY) {
        const p = pts[0];
        const down = drawing.properties?.direction !== "up";
        const inDirection = down ? point.y >= p.y - this.tolerance : point.y <= p.y + this.tolerance;
        const distance = Math.abs(point.x - p.x);
        return inDirection && distance <= this.tolerance ? { hitType: "line", distance } : null;
      }
      if ([DrawingTypes.LONG_POSITION, DrawingTypes.SHORT_POSITION].includes(drawing.type)) {
        return this.hitTestPosition(drawing, point);
      }
      if (drawing.type === DrawingTypes.FIB_RETRACEMENT && pts.length >= 2) {
        const props = drawing.properties || {};
        const a = props.reverse ? pts[1] : pts[0], b = props.reverse ? pts[0] : pts[1];
        const third = pts[2] || b;
        let best = Infinity;
        const levels = props.fibMode ? (props.levels || [0,0.236,0.382,0.5,0.618,0.786,1,1.272,1.618]) : window.IntenseDrawing.fibRetracementLevels(props.levels);
        for (const level of levels) {
          const ratio = Number(level);
          if (!Number.isFinite(ratio)) continue;
          if (props.fibMode === 'channel') {
            const baseline = a.y+(b.y-a.y)*(third.x-a.x)/(b.x-a.x||1);
            const offset = (third.y-baseline)*ratio;
            best = Math.min(best,this.distanceToSegment(point,{x:a.x,y:a.y+offset},{x:b.x,y:b.y+offset}));
          } else {
            const y = window.IntenseDrawing.fibLevelValue(pts[0].y,pts[1].y,ratio,props,third.y);
            const bounds=this.engine.coordinateManager.getChartBounds();
            const left=props.extendLeft && bounds ? bounds.left : Math.min(a.x,b.x);
            const right=props.extendRight && bounds ? bounds.left+bounds.width-78 : Math.max(a.x,b.x);
            best=Math.min(best,this.distanceToSegment(point,{x:left,y},{x:right,y}));
          }
        }
        return best<=this.tolerance ? {hitType:'line',distance:best}:null;
      }
      if ([DrawingTypes.RECTANGLE, DrawingTypes.ELLIPSE].includes(drawing.type) && pts.length > 1) {
        const minX = drawing.type === DrawingTypes.RECTANGLE && drawing.properties?.extendLeft ? 0 : Math.min(pts[0].x, pts[1].x);
        const maxX = drawing.type === DrawingTypes.RECTANGLE && drawing.properties?.extendRight ? (this.engine.coordinateManager.adapter.getMetrics?.()?.chartWidth || this.engine.coordinateManager.getChartBounds().width) : Math.max(pts[0].x, pts[1].x);
        const minY = Math.min(pts[0].y, pts[1].y);
        const maxY = Math.max(pts[0].y, pts[1].y);
        const inside = point.x >= minX - this.tolerance && point.x <= maxX + this.tolerance && point.y >= minY - this.tolerance && point.y <= maxY + this.tolerance;
        if (!inside) return null;
        const distance = Math.min(Math.abs(point.x - minX), Math.abs(point.x - maxX), Math.abs(point.y - minY), Math.abs(point.y - maxY), this.tolerance);
        return { hitType: "edge", distance };
      }
      if ([DrawingTypes.TRIANGLE, DrawingTypes.POLYGON, DrawingTypes.PARALLEL_CHANNEL].includes(drawing.type) && pts.length > 2) {
        let best = Infinity;
        for (let i = 1; i < pts.length; i += 1) best = Math.min(best, this.distanceToSegment(point, pts[i - 1], pts[i]));
        best = Math.min(best, this.distanceToSegment(point, pts[pts.length - 1], pts[0]));
        return best <= this.tolerance ? { hitType: "shape", distance: best } : null;
      }
      if (pts.length === 1) {
        const distance = Math.hypot(point.x - pts[0].x, point.y - pts[0].y);
        return distance <= this.handleTolerance ? { hitType: "point", distance } : null;
      }
      let best = Infinity;
      for (let i = 1; i < pts.length; i += 1) best = Math.min(best, this.distanceToSegment(point, pts[i - 1], pts[i]));
      return best <= this.tolerance ? { hitType: "line", distance: best } : null;
    }

    hitTestPosition(drawing, point) {
      const geometry = this.positionGeometry(drawing);
      if (!geometry) return null;
      const entry = this.projectAnchor({ time: geometry.entry.time, price: geometry.entry.price });
      const stop = this.projectAnchor({ time: geometry.entry.time, price: geometry.stopLoss.price });
      const target = this.projectAnchor({ time: geometry.entry.time, price: geometry.takeProfit.price });
      const start = this.projectAnchor({ time: geometry.timeRange.start, price: geometry.entry.price });
      const end = this.projectAnchor({ time: geometry.timeRange.end, price: geometry.entry.price });
      if (!entry || !stop || !target || !start || !end) return null;
      const left = Math.min(start.x, end.x);
      const right = Math.max(start.x, end.x);
      const top = Math.min(stop.y, target.y, entry.y);
      const bottom = Math.max(stop.y, target.y, entry.y);
      const inBox = point.x >= left - this.tolerance && point.x <= right + this.tolerance && point.y >= top - this.tolerance && point.y <= bottom + this.tolerance;
      const levels = [
        { id: "target", y: target.y, logical: { time: geometry.entry.time, price: geometry.takeProfit.price }, cursor: "ns-resize" },
        { id: "entry", y: entry.y, logical: { time: geometry.entry.time, price: geometry.entry.price }, cursor: "ns-resize" },
        { id: "stop", y: stop.y, logical: { time: geometry.entry.time, price: geometry.stopLoss.price }, cursor: "ns-resize" },
      ];
      const nearestLevel = levels
        .map((level) => ({ ...level, distance: Math.abs(point.y - level.y) }))
        .sort((a, b) => a.distance - b.distance)[0];
      if (point.x >= left - this.tolerance && point.x <= right + this.tolerance && nearestLevel?.distance <= this.tolerance) {
        return {
          hitType: "handle",
          distance: nearestLevel.distance,
          handle: {
            id: nearestLevel.id,
            kind: "resize",
            drawingId: drawing.id,
            cursor: nearestLevel.cursor,
            logical: nearestLevel.logical,
            screen: { x: point.x, y: nearestLevel.y },
          },
        };
      }
      const boundaries = [
        { id: "start", x: left, time: geometry.timeRange.start },
        { id: "end", x: right, time: geometry.timeRange.end },
      ];
      const nearestBoundary = boundaries
        .map((boundary) => ({ ...boundary, distance: Math.abs(point.x - boundary.x) }))
        .sort((a, b) => a.distance - b.distance)[0];
      if (point.y >= top - this.tolerance && point.y <= bottom + this.tolerance && nearestBoundary?.distance <= this.tolerance) {
        return {
          hitType: "handle",
          distance: nearestBoundary.distance,
          handle: {
            id: nearestBoundary.id,
            kind: "resize",
            drawingId: drawing.id,
            cursor: "ew-resize",
            logical: { time: nearestBoundary.time, price: geometry.entry.price },
            screen: { x: nearestBoundary.x, y: point.y },
          },
        };
      }
      const lineDistance = nearestLevel?.distance ?? this.tolerance;
      if (inBox) return { hitType: "body", distance: Math.min(lineDistance, this.tolerance) };
      return null;
    }

    positionGeometry(drawing) {
      const anchors = drawing.anchors || [];
      const entry = drawing.geometry?.entry || anchors.find((a) => a.metadata?.role === "entry") || anchors[0];
      const stop = drawing.geometry?.stopLoss || anchors.find((a) => a.metadata?.role === "stop") || anchors[1];
      const target = drawing.geometry?.takeProfit || anchors.find((a) => a.metadata?.role === "target") || anchors[2];
      const start = drawing.geometry?.timeRange?.start ?? anchors.find((a) => a.metadata?.role === "start")?.time ?? anchors[3]?.time ?? entry?.time;
      const end = drawing.geometry?.timeRange?.end ?? anchors.find((a) => a.metadata?.role === "end")?.time ?? anchors[4]?.time ?? entry?.time;
      if (!entry || !stop || !target) return null;
      return {
        entry: { time: Number(entry.time ?? entry.timestamp), price: Number(entry.price) },
        stopLoss: { price: Number(stop.price) },
        takeProfit: { price: Number(target.price) },
        timeRange: { start: Number(start), end: Number(end) },
      };
    }

    hitTestBox(rect, options = {}) {
      const drawings = options.drawings || this.engine.getDrawings();
      const box = this.normalizeRect(rect);
      if (!box) return [];
      return drawings.filter((drawing) => this.isInteractive(drawing) && this.drawingIntersectsBox(drawing, box)).map((drawing) => drawing.id);
    }

    drawingIntersectsBox(drawing, box) {
      const pts = (drawing.anchors || []).map((anchor) => this.projectAnchor(anchor)).filter(Boolean);
      if (!pts.length) return false;
      if (pts.some((p) => this.pointInBox(p, box))) return true;
      if (pts.length === 1) return false;
      for (let i = 1; i < pts.length; i += 1) {
        if (this.segmentIntersectsBox(pts[i - 1], pts[i], box)) return true;
      }
      return false;
    }

    projectAnchor(anchor) {
      return this.engine.coordinateManager?.logicalToScreen?.(anchor.time ?? anchor.timestamp, anchor.price) || null;
    }

    toScreenPoint(point) {
      if (!point) return null;
      if (Number.isFinite(point.clientX) && Number.isFinite(point.clientY)) return { x: point.clientX, y: point.clientY };
      if (Number.isFinite(point.x) && Number.isFinite(point.y)) return { x: point.x, y: point.y };
      return null;
    }

    isInteractive(drawing) {
      return !!drawing && drawing.visible !== false;
    }

    normalizeType(type) {
      return LEGACY_TYPE[type] || type;
    }

    normalizeRect(rect) {
      if (!rect) return null;
      const left = Math.min(rect.x1, rect.x2);
      const right = Math.max(rect.x1, rect.x2);
      const top = Math.min(rect.y1, rect.y2);
      const bottom = Math.max(rect.y1, rect.y2);
      return { left, right, top, bottom };
    }

    pointInBox(point, box) {
      return point.x >= box.left && point.x <= box.right && point.y >= box.top && point.y <= box.bottom;
    }

    segmentIntersectsBox(a, b, box) {
      if (this.pointInBox(a, box) || this.pointInBox(b, box)) return true;
      const edges = [
        [{ x: box.left, y: box.top }, { x: box.right, y: box.top }],
        [{ x: box.right, y: box.top }, { x: box.right, y: box.bottom }],
        [{ x: box.right, y: box.bottom }, { x: box.left, y: box.bottom }],
        [{ x: box.left, y: box.bottom }, { x: box.left, y: box.top }],
      ];
      return edges.some(([c, d]) => this.segmentsIntersect(a, b, c, d));
    }

    segmentsIntersect(a, b, c, d) {
      const ccw = (p1, p2, p3) => (p3.y - p1.y) * (p2.x - p1.x) > (p2.y - p1.y) * (p3.x - p1.x);
      return ccw(a, c, d) !== ccw(b, c, d) && ccw(a, b, c) !== ccw(a, b, d);
    }

    distanceToSegment(point, a, b) {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / len2));
      return Math.hypot(point.x - (a.x + dx * t), point.y - (a.y + dy * t));
    }
  }

  window.IntenseDrawing = window.IntenseDrawing || {};
  window.IntenseDrawing.HitTestEngine = HitTestEngine;
})();

