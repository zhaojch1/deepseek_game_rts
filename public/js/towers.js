'use strict';

/**
 * towers.js — 防御哨塔（v9：建筑师建造）
 *
 * 建筑师（architect）在指定位置施工数秒后立起一座防御哨塔：
 *   - 哨塔耐久高、占位即成为障碍（不可通行），可被双方单位攻击摧毁；
 *   - 会自动向射程内的敌方单位射箭（独立于城堡箭塔）；
 *   - 建造消耗木材 + 石料，每阵营数量有限（见 CONFIG.maxTowersPerFaction）。
 *
 * 哨塔列表挂在 RTS.state.towers（开局重建自然清空），本模块提供
 * 建造/推进/射击/销毁的完整生命周期。
 */

RTS.Towers = (function () {
  const C = () => RTS.CONFIG;
  let nextId = 1;

  function list() {
    return (RTS.state && RTS.state.towers) || [];
  }

  /** 某阵营现存（未摧毁）哨塔数量 */
  function towerCount(owner) {
    return list().filter((t) => t.owner === owner && t.hp > 0).length;
  }

  /** 检查某点能否建造哨塔（资源 + 数量上限 + 可通行 + 不重叠） */
  function canBuild(faction, x, y) {
    const Cfg = C();
    if (towerCount(faction.owner) >= Cfg.maxTowersPerFaction) return { ok: false, reason: 'cap' };
    if (faction.wood < Cfg.towerBuildCost.wood) return { ok: false, reason: 'wood' };
    if (faction.stone < Cfg.towerBuildCost.stone) return { ok: false, reason: 'stone' };
    const p = RTS.World.nearestWalkablePx(x, y);
    if (!RTS.World.isWalkablePx(p.x, p.y)) return { ok: false, reason: 'blocked' };
    // 不与已有哨塔 / 双方基地重叠（v11：多基地——遍历每座基地）
    for (const t of list()) {
      if (t.hp > 0 && Math.hypot(t.x - p.x, t.y - p.y) < t.radius + Cfg.towerRadius) {
        return { ok: false, reason: 'overlap' };
      }
    }
    for (const owner of ['player', 'enemy']) {
      const fac = RTS.state[owner];
      const bases = (fac.bases && fac.bases.length) ? fac.bases : [fac.base];
      for (const base of bases) {
        if (base && Math.hypot(base.x - p.x, base.y - p.y) < base.radius + Cfg.towerRadius) {
          return { ok: false, reason: 'overlap' };
        }
      }
    }
    return { ok: true, reason: null, x: p.x, y: p.y };
  }

  /**
   * 对建筑师下达建造指令：立即扣除木/石，记录建造点并移动过去。
   * 返回 { ok, reason, x, y }；失败（资源不足等）不产生任何消耗。
   */
  function orderBuild(unit, x, y) {
    if (!unit || unit.type !== 'architect') return { ok: false, reason: 'not_architect' };
    const faction = RTS.state[unit.owner];
    const check = canBuild(faction, x, y);
    if (!check.ok) return check;
    faction.wood -= C().towerBuildCost.wood;
    faction.stone -= C().towerBuildCost.stone;
    unit.building = { kind: 'tower', x: check.x, y: check.y, radius: C().towerBuildRadius, progress: 0, total: C().towerBuildTime };
    RTS.Unit.orderMove(unit, check.x, check.y);
    return { ok: true, reason: null, x: check.x, y: check.y };
  }

  /** 每帧推进正在施工的建筑师（kind==='tower'；兵营施工由 RTS.Barracks.updateBuilders 负责，基地修复由 RTS.Bases.updateRepairers 负责） */
  function updateArchitects(dt) {
    RTS.Combat.forEachUnit((u) => {
      if (u.type !== 'architect' || !u.building) return;
      if (u.building.kind === 'barracks') return; // v10.2：兵营施工不在此处理
      if (u.building.kind === 'base_repair') return; // v11.1：基地修复不在此处理
      const b = u.building;
      if (Math.hypot(u.x - b.x, u.y - b.y) <= (b.radius != null ? b.radius : C().towerBuildRadius) + 8) {
        b.progress += dt;
        if (b.progress >= b.total) {
          u.building = null;
          spawnTower(u.owner, b.x, b.y);
        }
      }
    });
  }

  /** 在指定位置立起一座哨塔（占用地图瓦片成为障碍） */
  function spawnTower(owner, x, y) {
    const Cfg = C();
    const tower = {
      id: nextId++,
      owner,
      x,
      y,
      hp: Cfg.towerMaxHp,
      maxHp: Cfg.towerMaxHp,
      radius: Cfg.towerRadius,
      defenseCooldown: 0,
      firingFlash: 0,
      tiles: [], // 建塔前保存的瓦片（销毁时恢复）
    };
    RTS.state.towers.push(tower);
    RTS.World.markTowerBlocked(tower);
    return tower;
  }

  /** 每帧：哨塔自动射箭（优先最近目标） */
  function update(dt) {
    const arr = list();
    if (arr.length === 0) return;
    for (let i = arr.length - 1; i >= 0; i--) {
      const t = arr[i];
      if (t.hp <= 0) {
        destroy(t);
        continue;
      }
      if (t.firingFlash > 0) t.firingFlash = Math.max(0, t.firingFlash - dt);
      t.defenseCooldown -= dt;
      if (t.defenseCooldown > 0) continue;
      const range = C().towerDefenseRange;
      const candidates = RTS.Combat.query(t.x, t.y, range).filter(
        (u) => u.owner !== t.owner && u.hp > 0
      );
      if (candidates.length === 0) continue;
      candidates.sort((a, b) => RTS.Unit.distTo(a, t.x, t.y) - RTS.Unit.distTo(b, t.x, t.y));
      const arrows = Math.min(C().towerDefenseArrows, candidates.length);
      t.defenseCooldown = C().towerDefenseInterval;
      t.firingFlash = C().towerFlash;
      for (let k = 0; k < arrows; k++) {
        RTS.Projectiles.spawnTowerProjectile(t, { kind: 'unit', ref: candidates[k] }, C().towerDefenseDamage);
      }
    }
  }

  /** 销毁哨塔（恢复地形可通行） */
  function destroy(tower) {
    RTS.World.unmarkTowerBlocked(tower);
    const arr = list();
    const i = arr.indexOf(tower);
    if (i >= 0) arr.splice(i, 1);
  }

  return {
    list,
    towerCount,
    canBuild,
    orderBuild,
    updateArchitects,
    spawnTower,
    update,
    destroy,
  };
})();
