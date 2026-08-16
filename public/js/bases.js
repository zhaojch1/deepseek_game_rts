'use strict';

/**
 * bases.js — 基地修复（v11.1：基地被摧毁后由建筑师重建）
 *
 * 基地被打到 0 血会进入「被摧毁」状态（base.destroyed = true）：
 *   - 停止角塔开火（resources.baseDefenseUpdate 跳过）
 *   - 停止出兵（Production 的出生基地选择会跳过被摧毁基地）
 *   - 渲染为废墟（render.js drawBase）
 * 被摧毁的基地不会从阵营移除，占位残骸仍是障碍；必须派建筑师前往修复：
 *   - 消耗木/石（CONFIG.baseRepairCost），抵达后施工 baseRepairTime 秒
 *   - 完成后 base.destroyed = false，耐久恢复到 maxHp × baseRepairHpRatio
 *   - 恢复出兵与角塔防御
 *
 * 玩家操作：选中建筑师 → 右键点击己方被摧毁的基地 → 派其修复。
 * AI 操作：筑垒节奏（fortifyTimer）优先派空闲建筑师修复被摧毁基地
 * （见 ai.js 的 repairBases），优先级高于建兵营/哨塔。
 *
 * 本模块挂载在 RTS.Bases；主循环每帧调用 updateRepairers 推进施工。
 */

RTS.Bases = (function () {
  const C = () => RTS.CONFIG;

  /** 某阵营被摧毁（destroyed 或 hp≤0）的基地列表 */
  function destroyedBases(owner) {
    const st = RTS.state;
    if (!st) return [];
    const fac = st[owner];
    if (!fac) return [];
    const bases = (fac.bases && fac.bases.length) ? fac.bases : [fac.base];
    return bases.filter((b) => b.destroyed || b.hp <= 0);
  }

  /** 某阵营存活的基地数量 */
  function aliveCount(owner) {
    const st = RTS.state;
    if (!st) return 0;
    const fac = st[owner];
    if (!fac) return 0;
    const bases = (fac.bases && fac.bases.length) ? fac.bases : [fac.base];
    return bases.filter((b) => !b.destroyed && b.hp > 0).length;
  }

  /** 检查某基地能否被该阵营修复（被摧毁 + 资源足够） */
  function canRepair(faction, base) {
    if (!base) return { ok: false, reason: 'no_base' };
    if (!base.destroyed || base.hp > 0) return { ok: false, reason: 'not_destroyed' };
    if (faction.wood < C().baseRepairCost.wood) return { ok: false, reason: 'wood' };
    if (faction.stone < C().baseRepairCost.stone) return { ok: false, reason: 'stone' };
    return { ok: true, reason: null };
  }

  /**
   * 对建筑师下达修复基地指令：立即扣除木/石，记录修复点并移动过去。
   * 修复点取基地朝敌方一侧的可通行边缘（基地本体是障碍，不能站到中心）。
   * 返回 { ok, reason, x, y }；失败（资源不足/未摧毁等）不产生任何消耗。
   */
  function orderRepair(unit, base) {
    if (!unit || unit.type !== 'architect') return { ok: false, reason: 'not_architect' };
    const faction = RTS.state[unit.owner];
    const check = canRepair(faction, base);
    if (!check.ok) return check;
    faction.wood -= C().baseRepairCost.wood;
    faction.stone -= C().baseRepairCost.stone;
    const dirX = base.owner === 'player' ? 1 : -1; // 朝敌方一侧（与出生点同侧）
    const spot = RTS.World.nearestWalkablePx(base.x + dirX * (base.radius + 20), base.y);
    unit.building = {
      kind: 'base_repair',
      base,
      x: spot.x,
      y: spot.y,
      radius: C().baseRepairRadius,
      progress: 0,
      total: C().baseRepairTime,
    };
    RTS.Unit.orderMove(unit, spot.x, spot.y);
    return { ok: true, reason: null, x: spot.x, y: spot.y };
  }

  /** 每帧推进正在修复的建筑师（kind==='base_repair'；抵达修复点后才开始计时） */
  function updateRepairers(dt) {
    RTS.Combat.forEachUnit((u) => {
      if (u.type !== 'architect' || !u.building || u.building.kind !== 'base_repair') return;
      const b = u.building;
      if (Math.hypot(u.x - b.x, u.y - b.y) <= (b.radius != null ? b.radius : C().baseRepairRadius) + 8) {
        b.progress += dt;
        if (b.progress >= b.total) {
          u.building = null;
          const base = b.base;
          base.destroyed = false;
          base.hp = Math.max(1, Math.round(base.maxHp * C().baseRepairHpRatio));
          base.defenseCooldown = 0;
          // v7.1：普通消息，不弹 toast，避免干扰 AI 决策消息
        }
      }
    });
  }

  return {
    destroyedBases,
    aliveCount,
    canRepair,
    orderRepair,
    updateRepairers,
  };
})();
