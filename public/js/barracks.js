'use strict';

/**
 * barracks.js — 兵营（v10.2：建筑师建造的第二出兵点）
 *
 * 建筑师（architect）在指定位置施工数秒后立起一座兵营：
 *   - 兵营与基地一样可以出兵——当基地生产队列超过 baseQueueBarracksThreshold 个时，
 *     多余的订单从兵营出生（分摊基地的训练压力，解决「金币太多但基地队列不够」）；
 *   - 兵营耐久高、占位即成为障碍（不可通行），可被双方单位攻击摧毁；
 *   - 建造消耗木材 + 石料，每阵营数量有限（见 CONFIG.maxBarracksPerFaction）。
 *
 * 兵营列表挂在 RTS.state.barracks（开局重建自然清空）。施工推进由
 * Barracks.updateBuilders 负责（建筑师 building.kind === 'barracks'）。
 */

RTS.Barracks = (function () {
  const C = () => RTS.CONFIG;
  let nextId = 1;

  function list() {
    return (RTS.state && RTS.state.barracks) || [];
  }

  /** 某阵营现存（未摧毁）兵营数量 */
  function barracksCount(owner) {
    return list().filter((b) => b.owner === owner && b.hp > 0).length;
  }

  /** 某阵营的所有兵营（按距离给定点排序，缺省按列表顺序） */
  function ofOwner(owner, nearX, nearY) {
    const arr = list().filter((b) => b.owner === owner && b.hp > 0);
    if (nearX != null) {
      arr.sort((a, b) => Math.hypot(a.x - nearX, a.y - nearY) - Math.hypot(b.x - nearX, b.y - nearY));
    }
    return arr;
  }

  /** 检查某点能否建造兵营（资源 + 数量上限 + 可通行 + 不重叠） */
  function canBuild(faction, x, y) {
    const Cfg = C();
    if (barracksCount(faction.owner) >= Cfg.maxBarracksPerFaction) return { ok: false, reason: 'cap' };
    if (faction.wood < Cfg.barracksBuildCost.wood) return { ok: false, reason: 'wood' };
    if (faction.stone < Cfg.barracksBuildCost.stone) return { ok: false, reason: 'stone' };
    const p = RTS.World.nearestWalkablePx(x, y);
    if (!RTS.World.isWalkablePx(p.x, p.y)) return { ok: false, reason: 'blocked' };
    // 不与已有兵营 / 哨塔 / 双方基地重叠
    for (const b of list()) {
      if (b.hp > 0 && Math.hypot(b.x - p.x, b.y - p.y) < b.radius + Cfg.barracksRadius) {
        return { ok: false, reason: 'overlap' };
      }
    }
    const towers = (RTS.state && RTS.state.towers) || [];
    for (const t of towers) {
      if (t.hp > 0 && Math.hypot(t.x - p.x, t.y - p.y) < t.radius + Cfg.barracksRadius) {
        return { ok: false, reason: 'overlap' };
      }
    }
    for (const owner of ['player', 'enemy']) {
      const base = RTS.state[owner].base;
      if (base && Math.hypot(base.x - p.x, base.y - p.y) < base.radius + Cfg.barracksRadius) {
        return { ok: false, reason: 'overlap' };
      }
    }
    return { ok: true, reason: null, x: p.x, y: p.y };
  }

  /**
   * 对建筑师下达建造兵营指令：立即扣除木/石，记录建造点并移动过去。
   * 返回 { ok, reason, x, y }；失败（资源不足等）不产生任何消耗。
   */
  function orderBuild(unit, x, y) {
    if (!unit || unit.type !== 'architect') return { ok: false, reason: 'not_architect' };
    const faction = RTS.state[unit.owner];
    const check = canBuild(faction, x, y);
    if (!check.ok) return check;
    faction.wood -= C().barracksBuildCost.wood;
    faction.stone -= C().barracksBuildCost.stone;
    unit.building = { kind: 'barracks', x: check.x, y: check.y, progress: 0, total: C().barracksBuildTime };
    RTS.Unit.orderMove(unit, check.x, check.y);
    return { ok: true, reason: null, x: check.x, y: check.y };
  }

  /** 每帧推进正在施工的建筑师（kind==='barracks'；抵达建造点后才开始计时） */
  function updateBuilders(dt) {
    RTS.Combat.forEachUnit((u) => {
      if (u.type !== 'architect' || !u.building || u.building.kind !== 'barracks') return;
      const b = u.building;
      if (Math.hypot(u.x - b.x, u.y - b.y) <= C().barracksBuildRadius + 8) {
        b.progress += dt;
        if (b.progress >= b.total) {
          u.building = null;
          spawnBarracks(u.owner, b.x, b.y);
        }
      }
    });
  }

  /** 在指定位置立起一座兵营（占用地图瓦片成为障碍） */
  function spawnBarracks(owner, x, y) {
    const Cfg = C();
    const barracks = {
      id: nextId++,
      owner,
      x,
      y,
      hp: Cfg.barracksMaxHp,
      maxHp: Cfg.barracksMaxHp,
      radius: Cfg.barracksRadius,
      tiles: [], // 建前保存的瓦片（销毁时恢复）
    };
    RTS.state.barracks.push(barracks);
    // 复用哨塔的瓦片占用逻辑（只依赖 x/y/radius/tiles 通用字段）
    RTS.World.markTowerBlocked(barracks);
    return barracks;
  }

  /** 销毁兵营（恢复地形可通行） */
  function destroy(barracks) {
    RTS.World.unmarkTowerBlocked(barracks);
    const arr = list();
    const i = arr.indexOf(barracks);
    if (i >= 0) arr.splice(i, 1);
  }

  /** 单位出生点：兵营朝敌方一侧偏移（供 Production.spawnUnit 使用） */
  function spawnPoint(barracks) {
    const base = RTS.state[barracks.owner].base;
    const dirX = base.owner === 'player' ? 1 : -1;
    return {
      x: barracks.x + dirX * (barracks.radius + C().barracksSpawnOffset),
      y: barracks.y,
    };
  }

  return {
    list,
    barracksCount,
    ofOwner,
    canBuild,
    orderBuild,
    updateBuilders,
    spawnBarracks,
    destroy,
    spawnPoint,
  };
})();
