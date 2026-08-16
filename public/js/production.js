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

  /**
   * v10.2：决定新订单的出生点——
   * 基地生产队列超过 baseQueueBarracksThreshold 个时，多余的订单从兵营出生
   * （分摊基地训练压力；无可用兵营时全部从基地出生）。
   * v11：多基地出兵——从基地出生的订单按「中基地 → 上基地 → 下基地」轮转
   * （faction.spawnBaseIdx 依次指向 bases[0]、bases[1]、bases[2]…），
   * 即同时点三次出兵卡片时，先从中路基地出、再上路基地、再下路基地。
   * v11.1：被摧毁的基地（destroyed）不参与轮转，直接跳过（修好后才恢复出兵）。
   */
  function decideOrigin(faction) {
    const Cfg = C();
    if (faction.productionQueue.length >= Cfg.baseQueueBarracksThreshold) {
      const barracks = RTS.Barracks ? RTS.Barracks.ofOwner(faction.owner, faction.base.x, faction.base.y) : [];
      if (barracks.length > 0) return { kind: 'barracks', id: barracks[0].id };
    }
    const bases = (faction.bases && faction.bases.length) ? faction.bases : [faction.base];
    // v11.1：在 bases 数组内轮转，跳过被摧毁的基地（index 即真实数组下标）
    let bi = (faction.spawnBaseIdx || 0) % bases.length;
    let found = false;
    for (let k = 0; k < bases.length; k++) {
      const idx = (bi + k) % bases.length;
      if (!bases[idx].destroyed && bases[idx].hp > 0) { bi = idx; found = true; break; }
    }
    if (!found) bi = 0; // 全部被摧毁（将判负）：兜底指向第一座
    faction.spawnBaseIdx = (bi + 1) % bases.length; // 轮转：中→上→下→中…
    return { kind: 'base', baseIndex: bi };
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
      origin: decideOrigin(faction), // v10.2：'base' | {kind:'barracks', id}
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

  function spawnUnit(faction, type, origin) {
    // v11：多基地出生点——订单 origin.baseIndex 指向该阵营第几座基地（0=中路主基地）
    // v11.1：若该基地已被摧毁（不应发生，decideOrigin 已跳过），回退到最近的存活基地
    let base;
    if (origin && origin.kind === 'base') {
      const bases = (faction.bases && faction.bases.length) ? faction.bases : [faction.base];
      let b = bases[origin.baseIndex] || faction.base;
      if (b.destroyed || b.hp <= 0) {
        b = bases.find((x) => !x.destroyed && x.hp > 0) || faction.base;
      }
      base = b;
    } else {
      base = faction.base;
    }
    const Cfg = C();
    // v10.2：出生点选择——兵营（若该订单指定且兵营仍存活）或基地城门
    let x;
    let y;
    const originBarracks = origin && origin.kind === 'barracks' && RTS.Barracks
      ? RTS.Barracks.list().find((b) => b.id === origin.id && b.owner === faction.owner && b.hp > 0)
      : null;
    if (originBarracks) {
      const sp = RTS.Barracks.spawnPoint(originBarracks);
      x = sp.x;
      y = sp.y;
    } else {
      // 基地城门（朝敌方一侧的固定位置），不再随机散布
      const dirX = base.owner === 'player' ? 1 : -1;
      x = base.x + dirX * (Cfg.baseRadius + Cfg.spawnGateDist);
      y = base.y + Cfg.baseRadius * 0.55;
    }
    // 出生点被占用时向两侧错开，保证可通行且不重叠
    if (!RTS.World.isWalkablePx(x, y)) {
      const anchorX = originBarracks ? originBarracks.x : base.x;
      const anchorY = originBarracks ? originBarracks.y : base.y;
      const dirX = faction.owner === 'player' ? 1 : -1;
      for (let i = 1; i <= 6; i++) {
        const alt = [
          { x, y: anchorY - i * 14 },
          { x, y: anchorY + i * 14 },
          { x: anchorX + dirX * (Cfg.baseRadius + Cfg.spawnGateDist + i * 12), y },
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

    // v11.2：并行训练——多基地/多兵营下，队列前 productionConcurrencyMax 个订单
    // 同时训练（每个订单从自己的 origin 出生），超出部分排队等待空出的训练槽。
    const q = faction.productionQueue;
    if (q.length === 0) return;
    const maxConcurrent = C().productionConcurrencyMax;
    let training = 0;
    for (const item of q) if (item.status === 'training') training++;
    // 空出训练槽：把队列中靠前的 queued 订单升级为 training
    let slots = Math.max(0, maxConcurrent - training);
    for (const item of q) {
      if (slots <= 0) break;
      if (item.status === 'queued') { item.status = 'training'; slots--; }
    }
    // 并行推进所有 training 订单（从后往前遍历，splice 安全）
    for (let i = q.length - 1; i >= 0; i--) {
      const item = q[i];
      if (item.status !== 'training') continue;
      item.elapsed += dt;
      if (item.elapsed >= item.totalTime) {
        q.splice(i, 1);
        spawnUnit(faction, item.type, item.origin);
        // v7.1：训练完成属普通消息，不再弹 toast
      }
    }
  }

  function update(dt) {
    const st = RTS.state;
    updateFaction(st.player, st.time, dt);
    updateFaction(st.enemy, st.time, dt);
  }

  return { update, updateFaction, order, cancel, canOrder, population, usedPop, currentGoldRate };
})();
