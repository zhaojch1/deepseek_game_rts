'use strict';

/**
 * world.js — 地图与静态实体（可行走网格、基地、障碍物）
 */

RTS.World = (function () {
  const C = () => RTS.CONFIG;

  function create() {
    const W = C().mapWidthTiles;
    const H = C().mapHeightTiles;
    const walkable = new Uint8Array(W * H).fill(1);
    const world = { W, H, walkable };

    // 边界设为不可通行
    for (let x = 0; x < W; x++) {
      world.walkable[yToIdx(x, 0)] = 0;
      world.walkable[yToIdx(x, H - 1)] = 0;
    }
    for (let y = 0; y < H; y++) {
      world.walkable[yToIdx(0, y)] = 0;
      world.walkable[yToIdx(W - 1, y)] = 0;
    }

    // 确定性障碍物（岩石/树林簇），避开出生区与中央走廊
    addObstacles(world);

    return world;
  }

  function yToIdx(x, y) {
    return y * C().mapWidthTiles + x;
  }

  function addObstacles(world) {
    // 简单确定性伪随机（固定种子，保证每局地图一致）
    let seed = 1337;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };

    const W = world.W;
    const H = world.H;
    // 障碍簇数量与半径
    const clusters = [
      { cx: 16, cy: 14, r: 3 },
      { cx: 24, cy: 42, r: 3 },
      { cx: 38, cy: 18, r: 4 },
      { cx: 46, cy: 46, r: 3 },
      { cx: 28, cy: 24, r: 2 },
      { cx: 20, cy: 52, r: 2 },
      { cx: 44, cy: 34, r: 2 },
      { cx: 34, cy: 50, r: 3 },
      { cx: 12, cy: 28, r: 2 },
      { cx: 50, cy: 22, r: 2 },
    ];

    for (const cl of clusters) {
      for (let dy = -cl.r; dy <= cl.r; dy++) {
        for (let dx = -cl.r; dx <= cl.r; dx++) {
          // 圆形障碍，边缘略随机化
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > cl.r || (dist > cl.r - 1 && rnd() < 0.4)) continue;
          const tx = cl.cx + dx;
          const ty = cl.cy + dy;
          if (tx <= 1 || ty <= 1 || tx >= W - 2 || ty >= H - 2) continue;
          world.walkable[yToIdx(tx, ty)] = 0;
        }
      }
    }
  }

  /** 将基地占位区域标记为不可通行（单位绕行，需贴近后攻击） */
  function markBaseBlocked(base) {
    const world = RTS.world;
    const Cfg = C();
    const radTiles = Math.ceil(base.radius / Cfg.tileSize) + 1;
    const cx = Math.floor(base.x / Cfg.tileSize);
    const cy = Math.floor(base.y / Cfg.tileSize);
    for (let dy = -radTiles; dy <= radTiles; dy++) {
      for (let dx = -radTiles; dx <= radTiles; dx++) {
        const tx = cx + dx;
        const ty = cy + dy;
        if (tx < 0 || ty < 0 || tx >= world.W || ty >= world.H) continue;
        const px = tx * Cfg.tileSize + Cfg.tileSize / 2;
        const py = ty * Cfg.tileSize + Cfg.tileSize / 2;
        const d = Math.hypot(px - base.x, py - base.y);
        if (d <= base.radius * 0.9) {
          world.walkable[yToIdx(tx, ty)] = 0;
        }
      }
    }
  }

  /** 创建双方基地（对称分布：玩家左侧、AI 右侧） */
  function placeBases() {
    const Cfg = C();
    const midY = Cfg.worldHeight / 2;
    const player = {
      x: 9 * Cfg.tileSize,
      y: midY,
      hp: Cfg.baseMaxHp,
      maxHp: Cfg.baseMaxHp,
      radius: Cfg.baseRadius,
      owner: 'player',
    };
    const enemy = {
      x: (Cfg.mapWidthTiles - 9) * Cfg.tileSize,
      y: midY,
      hp: Cfg.baseMaxHp,
      maxHp: Cfg.baseMaxHp,
      radius: Cfg.baseRadius,
      owner: 'enemy',
    };
    markBaseBlocked(player);
    markBaseBlocked(enemy);
    return { player, enemy };
  }

  function worldToTile(x, y) {
    return {
      tx: Math.floor(x / C().tileSize),
      ty: Math.floor(y / C().tileSize),
    };
  }

  function tileToCenter(tx, ty) {
    return {
      x: tx * C().tileSize + C().tileSize / 2,
      y: ty * C().tileSize + C().tileSize / 2,
    };
  }

  function isWalkable(tx, ty) {
    const world = RTS.world;
    if (tx < 0 || ty < 0 || tx >= world.W || ty >= world.H) return false;
    return world.walkable[yToIdx(tx, ty)] === 1;
  }

  function isWalkablePx(x, y) {
    const { tx, ty } = worldToTile(x, y);
    return isWalkable(tx, ty);
  }

  function clampPx(x, y, margin) {
    const Cfg = C();
    margin = margin || Cfg.tileSize;
    return {
      x: Math.max(margin, Math.min(Cfg.worldWidth - margin, x)),
      y: Math.max(margin, Math.min(Cfg.worldHeight - margin, y)),
    };
  }

  /** 找到离给定点最近的可通行格子中心 */
  function nearestWalkablePx(x, y) {
    const world = RTS.world;
    const { tx, ty } = worldToTile(x, y);
    if (isWalkable(tx, ty)) return { x, y };
    const maxR = Math.max(world.W, world.H);
    for (let r = 1; r <= maxR; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const nx = tx + dx;
          const ny = ty + dy;
          if (isWalkable(nx, ny)) {
            return tileToCenter(nx, ny);
          }
        }
      }
    }
    return { x, y };
  }

  /** 是否在基地障碍区内（用于攻击基地时判定到达） */
  function distToBase(base, x, y) {
    return Math.hypot(x - base.x, y - base.y);
  }

  return {
    create,
    placeBases,
    markBaseBlocked,
    worldToTile,
    tileToCenter,
    isWalkable,
    isWalkablePx,
    clampPx,
    nearestWalkablePx,
    distToBase,
  };
})();
