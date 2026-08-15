'use strict';

/**
 * world.js — 地图与静态实体（可行走网格、地形、障碍、基地、资源点）
 *
 * 地形类型（terrain 网格）：
 *   0 grass  草地（可通行）
 *   1 water  水域（不可通行，河流/湖泊）
 *   2 forest 森林（可通行，提供远程掩体）
 *   3 rock   岩石/山脉（不可通行）
 *   4 road   道路/桥梁（可通行，视觉）
 */

RTS.World = (function () {
  const C = () => RTS.CONFIG;
  const T = () => RTS.CONFIG.terrainTypes;

  function create() {
    const W = C().mapWidthTiles;
    const H = C().mapHeightTiles;
    const walkable = new Uint8Array(W * H).fill(1);
    const terrain = new Uint8Array(W * H).fill(T().grass);
    const world = { W, H, walkable, terrain };

    generateTerrain(world);
    return world;
  }

  function yToIdx(x, y) {
    return y * C().mapWidthTiles + x;
  }

  function setTile(world, tx, ty, terrain, walkable) {
    const W = world.W;
    const H = world.H;
    if (tx < 0 || ty < 0 || tx >= W || ty >= H) return;
    const i = yToIdx(tx, ty);
    world.terrain[i] = terrain;
    world.walkable[i] = walkable ? 1 : 0;
  }

  /** 对称落子：左右镜像（用于保证玩家/AI 地图公平） */
  function setSym(world, tx, ty, terrain, walkable) {
    const W = world.W;
    setTile(world, tx, ty, terrain, walkable);
    setTile(world, W - 1 - tx, ty, terrain, walkable);
  }

  /** 圆形 blob（镜像） */
  function addBlob(world, cx, cy, r, terrain, walkable) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.sqrt(dx * dx + dy * dy) > r) continue;
        setSym(world, cx + dx, cy + dy, terrain, walkable);
      }
    }
  }

  function generateTerrain(world) {
    const W = world.W;
    const H = world.H;
    const G = T();

    // 边界岩石
    for (let x = 0; x < W; x++) {
      setTile(world, x, 0, G.rock, false);
      setTile(world, x, H - 1, G.rock, false);
    }
    for (let y = 0; y < H; y++) {
      setTile(world, 0, y, G.rock, false);
      setTile(world, W - 1, y, G.rock, false);
    }

    // 中央纵向河流（4 格宽），三座桥梁把地图切成上/中/下三条进攻通道
    const riverX = [30, 31, 32, 33];
    const bridges = [[10, 12], [29, 35], [48, 50]]; // [y0, y1] 桥面
    for (let y = 1; y < H - 1; y++) {
      const inBridge = bridges.some((b) => y >= b[0] && y <= b[1]);
      for (const x of riverX) {
        setTile(world, x, y, inBridge ? G.road : G.water, inBridge);
      }
    }

    // 中央大道：从两侧基地直通中央桥梁（主攻通道）
    for (let y = 31; y <= 32; y++) {
      for (let x = 10; x <= 29; x++) {
        setTile(world, x, y, G.road, true);
        setTile(world, W - 1 - x, y, G.road, true);
      }
    }

    // 湖泊（左右对称，靠近出生区外缘）
    addBlob(world, 12, 12, 2, G.water, false);
    addBlob(world, 12, 52, 2, G.water, false);

    // 山脉/岩石：构成隘口与侧翼阻挡（不可通行）
    addBlob(world, 16, 6, 2, G.rock, false);
    addBlob(world, 16, 58, 2, G.rock, false);
    addBlob(world, 24, 22, 2, G.rock, false);
    addBlob(world, 24, 44, 2, G.rock, false);
    addBlob(world, 28, 8, 1, G.rock, false);
    addBlob(world, 28, 56, 1, G.rock, false);

    // 森林（可通行，提供掩体）：散布在通道两侧与桥头，供防守/伏击
    addBlob(world, 14, 24, 3, G.forest, true);
    addBlob(world, 14, 40, 3, G.forest, true);
    addBlob(world, 20, 14, 2, G.forest, true);
    addBlob(world, 20, 50, 2, G.forest, true);
    addBlob(world, 26, 32, 2, G.forest, true);
    addBlob(world, 22, 28, 1, G.forest, true);
    addBlob(world, 22, 36, 1, G.forest, true);
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
          world.terrain[yToIdx(tx, ty)] = Cfg.terrainTypes.road;
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
      defenseCooldown: 0,
      firingFlash: 0,
    };
    const enemy = {
      x: (Cfg.mapWidthTiles - 9) * Cfg.tileSize,
      y: midY,
      hp: Cfg.baseMaxHp,
      maxHp: Cfg.baseMaxHp,
      radius: Cfg.baseRadius,
      owner: 'enemy',
      defenseCooldown: 0,
      firingFlash: 0,
    };
    markBaseBlocked(player);
    markBaseBlocked(enemy);
    return { player, enemy };
  }

  /** 在可行走格上生成资源点（对称分布） */
  function placeResources() {
    const Cfg = C();
    const W = Cfg.mapWidthTiles;
    const H = Cfg.mapHeightTiles;
    const nodes = [];
    let id = 1;

    function placeAt(tx, ty, type) {
      const t = findWalkableTileNear(tx, ty);
      const p = tileToCenter(t.tx, t.ty);
      nodes.push({
        id: id++,
        type,
        x: p.x,
        y: p.y,
        radius: Cfg.resourceNodes[type].radius,
        owner: 'neutral',
        playerWeight: 0,
        enemyWeight: 0,
      });
    }

    // 安全区金矿（各自基地附近，稳定经济）
    placeAt(14, 18, 'gold');
    placeAt(14, 46, 'gold');
    placeAt(W - 15, 18, 'gold');
    placeAt(W - 15, 46, 'gold');
    // 中央争夺区：木/石（鼓励地图控制，而非一波流）
    placeAt(22, 12, 'wood');
    placeAt(W - 23, 12, 'wood');
    placeAt(22, 52, 'wood');
    placeAt(W - 23, 52, 'wood');
    placeAt(22, 32, 'stone');
    placeAt(W - 23, 32, 'stone');
    placeAt(27, 24, 'stone');
    placeAt(W - 28, 24, 'stone');

    return nodes;
  }

  function findWalkableTileNear(tx, ty) {
    const world = RTS.world;
    if (isWalkable(tx, ty)) return { tx, ty };
    for (let r = 1; r < 8; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          if (isWalkable(tx + dx, ty + dy)) return { tx: tx + dx, ty: ty + dy };
        }
      }
    }
    return { tx, ty };
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

  function terrainAt(tx, ty) {
    const world = RTS.world;
    if (tx < 0 || ty < 0 || tx >= world.W || ty >= world.H) return C().terrainTypes.rock;
    return world.terrain[yToIdx(tx, ty)];
  }

  function terrainAtPx(x, y) {
    const { tx, ty } = worldToTile(x, y);
    return terrainAt(tx, ty);
  }

  /** 该点是否在森林掩体内 */
  function isCoverPx(x, y) {
    return terrainAtPx(x, y) === C().terrainTypes.forest;
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
    placeResources,
    markBaseBlocked,
    worldToTile,
    tileToCenter,
    isWalkable,
    isWalkablePx,
    terrainAt,
    terrainAtPx,
    isCoverPx,
    clampPx,
    nearestWalkablePx,
    distToBase,
  };
})();
