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
    let x = base.x;
    let y = base.y;
    // 出生点：基地附近随机偏移，避免重叠
    for (let i = 0; i < 12; i++) {
      const ang = Math.random() * Math.PI * 2;
      const r = Cfg.baseRadius + 18 + Math.random() * 40;
      const nx = base.x + Math.cos(ang) * r;
      const ny = base.y + Math.sin(ang) * r;
      if (RTS.World.isWalkablePx(nx, ny)) {
        x = nx;
        y = ny;
        break;
      }
    }
    const unit = RTS.Unit.create(faction === RTS.state.player ? 'player' : 'enemy', type, x, y);
    faction.units.set(unit.id, unit);
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
