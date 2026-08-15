'use strict';

/**
 * production.js — 经济（被动军费）与生产队列
 */

RTS.Production = (function () {
  const C = () => RTS.CONFIG;

  function currentGoldRate(time) {
    const Cfg = C();
    const growth = Math.floor(time / 60) * Cfg.goldRateGrowthPerMin;
    return Math.min(Cfg.goldRateMax, Cfg.baseGoldRate + growth);
  }

  function population(faction) {
    return faction.units.size;
  }

  function usedPop(faction) {
    // 已存在单位 + 排队中（含训练中）单位
    return faction.units.size + faction.productionQueue.length;
  }

  function canOrder(faction, type) {
    const s = RTS.Unit.typeStats(type);
    if (faction.gold < s.cost) return { ok: false, reason: 'gold' };
    if (usedPop(faction) >= C().populationCap) return { ok: false, reason: 'pop' };
    return { ok: true };
  }

  function order(faction, type) {
    const s = RTS.Unit.typeStats(type);
    const check = canOrder(faction, type);
    if (!check.ok) return check;

    faction.gold -= s.cost;
    faction.productionQueue.push({
      type,
      cost: s.cost,
      totalTime: s.trainTime,
      elapsed: 0,
      status: 'queued',
    });
    return { ok: true, reason: null };
  }

  /** 取消队列项；queued 全额返还，training 返还 50% */
  function cancel(faction, index) {
    const q = faction.productionQueue;
    if (index < 0 || index >= q.length) return;
    const item = q[index];
    const refund = item.status === 'training' ? Math.floor(item.cost / 2) : item.cost;
    faction.gold = Math.min(C().goldCap, faction.gold + refund);
    q.splice(index, 1);
    return refund;
  }

  function spawnUnit(faction, type) {
    const base = faction.base;
    const Cfg = C();
    // 出生点：城堡城门（朝敌方一侧的固定位置），不再随机散布
    const dirX = base.owner === 'player' ? 1 : -1;
    let x = base.x + dirX * (Cfg.baseRadius + Cfg.spawnGateDist);
    let y = base.y + Cfg.baseRadius * 0.55;
    // 城门被占用时向两侧错开，保证可通行且不重叠
    if (!RTS.World.isWalkablePx(x, y)) {
      for (let i = 1; i <= 6; i++) {
        const alt = [
          { x, y: base.y - i * 14 },
          { x, y: base.y + i * 14 },
          { x: base.x + dirX * (Cfg.baseRadius + Cfg.spawnGateDist + i * 12), y },
        ];
        const ok = alt.find((p) => RTS.World.isWalkablePx(p.x, p.y));
        if (ok) {
          x = ok.x;
          y = ok.y;
          break;
        }
      }
    }
    const unit = RTS.Unit.create(faction === RTS.state.player ? 'player' : 'enemy', type, x, y);
    faction.units.set(unit.id, unit);

    // 出生后立即前往集结点（集结点默认在城堡前方，可被玩家/AI 重新设置）
    const rx = base.rallyX != null ? base.rallyX : base.x;
    const ry = base.rallyY != null ? base.rallyY : base.y;
    RTS.Unit.orderAttackMove(unit, rx, ry);
    return unit;
  }

  function updateFaction(faction, time, dt) {
    // 被动军费增长
    faction.goldRate = currentGoldRate(time);
    faction.gold = Math.min(C().goldCap, faction.gold + faction.goldRate * dt);

    // 生产队列
    const q = faction.productionQueue;
    if (q.length === 0) return;
    const item = q[0];
    if (item.status === 'queued') item.status = 'training';
    item.elapsed += dt;
    if (item.elapsed >= item.totalTime) {
      q.shift();
      spawnUnit(faction, item.type);
      if (faction === RTS.state.player) {
        RTS.UI.toast('训练完成：' + RTS.Unit.typeStats(item.type).name, 'info');
      }
    }
  }

  function update(dt) {
    const st = RTS.state;
    updateFaction(st.player, st.time, dt);
    updateFaction(st.enemy, st.time, dt);
  }

  return { update, order, cancel, canOrder, population, usedPop, currentGoldRate };
})();
