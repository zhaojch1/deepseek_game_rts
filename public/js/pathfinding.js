'use strict';

/**
 * pathfinding.js — 网格 A* 寻路
 */

RTS.Pathfinding = (function () {
  const C = () => RTS.CONFIG;

  /** v13：最小二叉堆（按 f 值）——对象池化 */
  class MinHeap {
    constructor() {
      this.arr = [];
    }
    get size() {
      return this.arr.length;
    }
    push(node) {
      const arr = this.arr;
      arr.push(node);
      let i = arr.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (arr[p].f <= arr[i].f) break;
        const tmp = arr[p]; arr[p] = arr[i]; arr[i] = tmp;
        i = p;
      }
    }
    pop() {
      const arr = this.arr;
      const top = arr[0];
      const last = arr.pop();
      if (arr.length > 0) {
        arr[0] = last;
        let i = 0;
        const n = arr.length;
        while (true) {
          const l = i * 2 + 1;
          const r = l + 1;
          let smallest = i;
          if (l < n && arr[l].f < arr[smallest].f) smallest = l;
          if (r < n && arr[r].f < arr[smallest].f) smallest = r;
          if (smallest === i) break;
          const tmp = arr[smallest]; arr[smallest] = arr[i]; arr[i] = tmp;
          i = smallest;
        }
      }
      return top;
    }
    clear() {
      this.arr.length = 0;
    }
  }

  // v13：预分配寻路缓冲区（避免每次 findPath 都 new 大型 TypedArray）
  let pathBufSize = 0;
  let gScore = null;
  let cameFrom = null;
  let closed = null;
  let openHeap = new MinHeap();
  let pathIdxBuf = [];

  function ensurePathBuffers(size) {
    if (size > pathBufSize) {
      pathBufSize = size;
      gScore = new Float64Array(size);
      cameFrom = new Int32Array(size);
      closed = new Uint8Array(size);
    }
    // 每次寻路前重置（比 new 快得多）
    gScore.fill(Infinity);
    cameFrom.fill(-1);
    closed.fill(0);
    openHeap.clear();
    pathIdxBuf.length = 0;
  }

  const DIRS = [
    { dx: 1, dy: 0, cost: 1 },
    { dx: -1, dy: 0, cost: 1 },
    { dx: 0, dy: 1, cost: 1 },
    { dx: 0, dy: -1, cost: 1 },
    { dx: 1, dy: 1, cost: 1.4142 },
    { dx: 1, dy: -1, cost: 1.4142 },
    { dx: -1, dy: 1, cost: 1.4142 },
    { dx: -1, dy: -1, cost: 1.4142 },
  ];

  function heuristic(tx, ty, gx, gy) {
    return Math.hypot(tx - gx, ty - gy);
  }

  /**
   * 返回从 (startX,startY) 到 (goalX,goalY) 的路径（世界坐标 waypoint 数组）。
   * 目标不可通行时自动吸附到最近可通行格。失败返回 null。
   */
  function findPath(startX, startY, goalX, goalY) {
    const world = RTS.world;
    const W = world.W;
    const H = world.H;

    const goalPx = RTS.World.nearestWalkablePx(goalX, goalY);
    const { tx: gx, ty: gy } = RTS.World.worldToTile(goalPx.x, goalPx.y);
    const startPx = RTS.World.nearestWalkablePx(startX, startY);
    const { tx: sx, ty: sy } = RTS.World.worldToTile(startPx.x, startPx.y);

    if (sx === gx && sy === gy) {
      return [goalPx];
    }

    // v13：使用预分配缓冲区，避免每次寻路 new 大型 TypedArray
    ensurePathBuffers(W * H);

    const idx = (x, y) => y * W + x;
    const startIdx = idx(sx, sy);
    const goalIdx = idx(gx, gy);

    gScore[startIdx] = 0;
    openHeap.push({ i: startIdx, f: heuristic(sx, sy, gx, gy) });

    let found = false;
    while (openHeap.size > 0) {
      const cur = openHeap.pop();
      if (cur.i === goalIdx) {
        found = true;
        break;
      }
      if (closed[cur.i]) continue;
      closed[cur.i] = 1;

      const cx = cur.i % W;
      const cy = (cur.i / W) | 0;

      for (let di = 0; di < DIRS.length; di++) {
        const d = DIRS[di];
        const nx = cx + d.dx;
        const ny = cy + d.dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const ni = idx(nx, ny);
        if (closed[ni]) continue;
        if (!world.walkable[ni]) continue;
        if (d.dx !== 0 && d.dy !== 0) {
          if (!world.walkable[idx(cx + d.dx, cy)] || !world.walkable[idx(cx, cy + d.dy)]) continue;
        }
        const tentative = gScore[cur.i] + d.cost;
        if (tentative < gScore[ni]) {
          gScore[ni] = tentative;
          cameFrom[ni] = cur.i;
          openHeap.push({ i: ni, f: tentative + heuristic(nx, ny, gx, gy) });
        }
      }
    }

    if (!found) return null;

    // 回溯路径（复用 buffer 而非新建数组）
    let cur = goalIdx;
    while (cur !== -1) {
      pathIdxBuf.push(cur);
      if (cur === startIdx) break;
      cur = cameFrom[cur];
    }
    pathIdxBuf.reverse();

    const waypoints = new Array(pathIdxBuf.length);
    for (let i = 0; i < pathIdxBuf.length; i++) {
      const ti = pathIdxBuf[i];
      waypoints[i] = RTS.World.tileToCenter(ti % W, (ti / W) | 0);
    }
    return waypoints;
  }

  /**
   * 直线视线检测：从 (x1,y1) 到 (x2,y2) 的直线是否全程可通行。
   * 用于路径平滑（朝最远的可见路点直行，避免逐格走阶梯）。
   */
  function hasLineOfSight(x1, y1, x2, y2) {
    const dist = Math.hypot(x2 - x1, y2 - y1);
    if (dist < 1) return true;
    const step = C().tileSize * 0.4;
    const steps = Math.ceil(dist / step);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const px = x1 + (x2 - x1) * t;
      const py = y1 + (y2 - y1) * t;
      if (!RTS.World.isWalkablePx(px, py)) return false;
    }
    return true;
  }

  return { findPath, hasLineOfSight };
})();
