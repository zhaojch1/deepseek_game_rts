'use strict';

/**
 * world.js — 通用地图容器与静态实体
 *
 * v4 起：具体地形由 js/maps/*.js 的地图定义（map.generate）填充，本模块只提供
 * 通用容器与查询/占位/基地/资源工具，不包含任何地图具体地形。
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

  /** 创建一个空世界容器，并调用地图定义的 generate 填充地形。 */
  function create(map) {
    const W = map.width;
    const H = map.height;
    const walkable = new Uint8Array(W * H).fill(1);
    const terrain = new Uint8Array(W * H).fill(T().grass);
    const world = { W, H, walkable, terrain, mapId: map.id };
    if (typeof map.generate === 'function') map.generate(world);
    return world;
  }

  function yToIdx(x, y) {
    return y * RTS.world.W + x;
  }

  // ---------------------------------------------------------------- 供地图定义使用的落子工具

  function setTile(world, tx, ty, terrain, walkable) {
    const W = world.W;
    const H = world.H;
    if (tx < 0 || ty < 0 || tx >= W || ty >= H) return;
    const i = ty * W + tx;
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

  // ---------------------------------------------------------------- 基地 / 资源（由地图定义驱动）

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

  /**
   * 依据地图定义创建双方基地（对称分布：玩家左侧、AI 右侧）。
   * v11：多基地支持——地图可定义 playerBases/enemyBases（数组），
   * 未定义时回退到 playerBase/enemyBase 单基地。返回值：
   *   { player: [base...], enemy: [base...] }
   * 各阵营的第一个基地（bases[0]）即主基地（faction.base），
   * 通常对应「中路基地」；出兵按 中→上→下 轮转（见 Production.decideOrigin）。
   */
  function placeBases(map) {
    const Cfg = C();
    const ts = Cfg.tileSize;

    function mkBase(tx, ty, owner, idx) {
      const dirX = owner === 'player' ? 1 : -1; // 集结点朝敌方一侧
      const x = (tx + 0.5) * ts;
      const y = (ty + 0.5) * ts;
      return {
        id: owner + '-' + (idx + 1),
        x,
        y,
        hp: Cfg.baseMaxHp,
        maxHp: Cfg.baseMaxHp,
        radius: Cfg.baseRadius,
        owner,
        destroyed: false, // v11.1：hp 归零后标记为「被摧毁」（停火/停产出，需建筑师修复重建）
        defenseCooldown: 0,
        firingFlash: 0,
        towerFlash: [0, 0, 0, 0], // 四角塔各自发射闪光计时
        rallyX: x + dirX * Cfg.baseSpawnRallyDist, // 单位出生集结点
        rallyY: y,
      };
    }

    const pDefs = (map.playerBases && map.playerBases.length) ? map.playerBases : [map.playerBase];
    const eDefs = (map.enemyBases && map.enemyBases.length) ? map.enemyBases : [map.enemyBase];
    const player = pDefs.map((b, i) => mkBase(b.tx, b.ty, 'player', i));
    const enemy = eDefs.map((b, i) => mkBase(b.tx, b.ty, 'enemy', i));
    player.forEach((b) => markBaseBlocked(b));
    enemy.forEach((b) => markBaseBlocked(b));
    return { player, enemy };
  }

  /** 依据地图定义生成资源点（持久控制点） */
  function placeResources(map) {
    const Cfg = C();
    const nodes = [];
    let id = 1;

    for (const r of (map.resources || [])) {
      const t = findWalkableTileNear(r.tx, r.ty);
      const p = tileToCenter(t.tx, t.ty);
      nodes.push({
        id: id++,
        type: r.type,
        x: p.x,
        y: p.y,
        radius: Cfg.resourceNodes[r.type].radius,
        owner: 'neutral',
        control: 0, // -1..1：+ 为玩家、- 为敌方、0 中立；易主后保持
      });
    }
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

  // ---------------------------------------------------------------- 通用查询

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

  function distToBase(base, x, y) {
    return Math.hypot(x - base.x, y - base.y);
  }

  /** 计算某基地四座角塔的世界坐标（供箭塔射箭与渲染共用） */
  function baseTowerPositions(base) {
    const Cfg = C();
    return Cfg.baseTowerOffsets.map((o) => ({
      x: base.x + o.dx * base.radius,
      y: base.y + o.dy * base.radius,
    }));
  }

  /**
   * v9：哨塔占用地图瓦片（成为不可通行障碍）。
   * 建塔时保存被占用瓦片的原状（tower.tiles），销毁时恢复。
   * v10.2：兵营复用本逻辑（只依赖 x/y/radius/tiles 通用字段）。
   * 圆心所在瓦片必定占用（nearestWalkablePx 可能返回非瓦片中心的坐标）。
   */
  function markTowerBlocked(tower) {
    const world = RTS.world;
    const Cfg = C();
    const radTiles = Math.ceil(tower.radius / Cfg.tileSize) + 1;
    const cx = Math.floor(tower.x / Cfg.tileSize);
    const cy = Math.floor(tower.y / Cfg.tileSize);
    tower.tiles = [];
    for (let dy = -radTiles; dy <= radTiles; dy++) {
      for (let dx = -radTiles; dx <= radTiles; dx++) {
        const tx = cx + dx;
        const ty = cy + dy;
        if (tx < 0 || ty < 0 || tx >= world.W || ty >= world.H) continue;
        const px = tx * Cfg.tileSize + Cfg.tileSize / 2;
        const py = ty * Cfg.tileSize + Cfg.tileSize / 2;
        const inR = Math.hypot(px - tower.x, py - tower.y) <= tower.radius * 0.9;
        const isCenterTile = tx === cx && ty === cy; // 圆心所在瓦片必定占用
        if (inR || isCenterTile) {
          const i = yToIdx(tx, ty);
          tower.tiles.push({ tx, ty, walkable: world.walkable[i], terrain: world.terrain[i] });
          world.walkable[i] = 0;
          world.terrain[i] = Cfg.terrainTypes.road;
        }
      }
    }
  }

  /** 哨塔销毁：恢复其占用的瓦片为建塔前状态 */
  function unmarkTowerBlocked(tower) {
    const world = RTS.world;
    for (const t of (tower.tiles || [])) {
      const i = yToIdx(t.tx, t.ty);
      world.walkable[i] = t.walkable;
      world.terrain[i] = t.terrain;
    }
    tower.tiles = [];
  }

  return {
    create,
    placeBases,
    placeResources,
    markBaseBlocked,
    baseTowerPositions,
    markTowerBlocked,
    unmarkTowerBlocked,
    setTile,
    setSym,
    addBlob,
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
