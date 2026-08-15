'use strict';

/**
 * input.js — 鼠标/键盘交互：框选、单选、移动、攻击、攻击移动、相机控制
 */

RTS.Input = (function () {
  const state = {
    mouseScreen: { x: 0, y: 0 },
    mouseWorld: { x: 0, y: 0 },
    mouseInside: true,
    leftDown: false,
    dragging: false,
    dragStartScreen: { x: 0, y: 0 },
    dragStartWorld: { x: 0, y: 0 },
    attackMovePending: false,
    buildPending: false, // v9：选中建筑师后按 B，左键指定哨塔建造位置
    keys: new Set(),
  };

  const C = () => RTS.CONFIG;

  /** 玩家部队是否正被 AI 接管（接管期间禁止一切手动控制） */
  function playerAIControlled() {
    const st = RTS.state;
    return !!(st && st.playerAI);
  }

  function updateMouseWorld() {
    state.mouseWorld = RTS.Camera.screenToWorld(state.mouseScreen.x, state.mouseScreen.y);
  }

  function hitTestUnit(wx, wy, owner) {
    const faction = RTS.state[owner];
    let best = null;
    let bestD = Infinity;
    faction.units.forEach((u) => {
      if (u.hp <= 0) return;
      const d = Math.hypot(u.x - wx, u.y - wy);
      if (d <= Math.max(u.radius + 4, 16) && d < bestD) {
        bestD = d;
        best = u;
      }
    });
    return best;
  }

  function hitTestBase(wx, wy) {
    const st = RTS.state;
    for (const owner of ['enemy', 'player']) {
      const base = st[owner].base;
      if (Math.hypot(base.x - wx, base.y - wy) <= base.radius + 6) return base;
    }
    return null;
  }

  /** 点选自己的城堡（用于设置集结点） */
  function selectOwnBase(wx, wy) {
    const st = RTS.state;
    const base = st.player.base;
    if (Math.hypot(base.x - wx, base.y - wy) <= base.radius + 6) {
      st.selection.clear();
      st.selectedBase = 'player';
      return true;
    }
    return false;
  }

  function formationOffsets(n) {
    const spacing = C().formationSpacing;
    const cols = Math.ceil(Math.sqrt(n));
    const rows = Math.ceil(n / cols);
    const offs = [];
    for (let i = 0; i < n; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      offs.push({
        x: (col - (cols - 1) / 2) * spacing,
        y: (row - (rows - 1) / 2) * spacing,
      });
    }
    return offs;
  }

  function selectedUnits() {
    const st = RTS.state;
    const out = [];
    st.selection.forEach((id) => {
      const u = st.player.units.get(id);
      if (u && u.hp > 0) out.push(u);
    });
    return out;
  }

  function markOrder(x, y, color) {
    RTS.state.orderMarker = { x, y, t: performance.now(), color };
  }

  function issueMove(wx, wy) {
    const sel = selectedUnits();
    if (sel.length === 0) return;
    markOrder(wx, wy, '#6ee7a0');
    const offs = formationOffsets(sel.length);
    sel.forEach((u, i) => {
      RTS.Unit.orderMove(u, wx + offs[i].x, wy + offs[i].y);
    });
  }

  function issueAttackMove(wx, wy) {
    const sel = selectedUnits();
    if (sel.length === 0) return;
    markOrder(wx, wy, '#ff5a5a');
    const offs = formationOffsets(sel.length);
    sel.forEach((u, i) => {
      RTS.Unit.orderAttackMove(u, wx + offs[i].x, wy + offs[i].y);
    });
  }

  function issueAttackUnit(enemyUnit) {
    const sel = selectedUnits();
    if (sel.length === 0) return;
    sel.forEach((u) => {
      RTS.Unit.orderAttack(u, { kind: 'unit', ref: enemyUnit });
    });
  }

  function issueAttackBase(base) {
    const sel = selectedUnits();
    if (sel.length === 0) return;
    sel.forEach((u) => {
      RTS.Unit.orderAttack(u, { kind: 'base', ref: base });
    });
  }

  /** v9：向选中建筑师下达「在此建造防御哨塔」指令 */
  function issueBuild(wx, wy) {
    const st = RTS.state;
    const architects = selectedUnits().filter((u) => u.type === 'architect');
    if (architects.length === 0) {
      RTS.UI && RTS.UI.toast('需要先选中建筑师（👷）才能建造哨塔', 'warn');
      state.buildPending = false;
      return;
    }
    const Cfg = C();
    if (st.player.wood < Cfg.towerBuildCost.wood || st.player.stone < Cfg.towerBuildCost.stone) {
      RTS.UI && RTS.UI.toast(`建造哨塔需要 🪵${Cfg.towerBuildCost.wood} 🪨${Cfg.towerBuildCost.stone}`, 'warn');
      return;
    }
    const offs = formationOffsets(architects.length);
    let okCount = 0;
    architects.forEach((u, i) => {
      const p = RTS.World.nearestWalkablePx(wx + offs[i].x, wy + offs[i].y);
      const res = RTS.Towers.orderBuild(u, p.x, p.y);
      if (res.ok) okCount++;
    });
    if (okCount > 0) {
      markOrder(wx, wy, '#ffd24e');
      RTS.UI && RTS.UI.toast(`建筑师开始施工（🪵${Cfg.towerBuildCost.wood} 🪨${Cfg.towerBuildCost.stone}），再点可继续放置，Esc 结束`, 'info');
      // 保持 buildPending，方便连续放置多座哨塔
    } else {
      RTS.UI && RTS.UI.toast('此处无法建造（资源不足/位置不可用/数量已达上限）', 'warn');
    }
  }

  function hasSelectedArchitect() {
    const st = RTS.state;
    if (!st) return false;
    for (const id of st.selection) {
      const u = st.player.units.get(id);
      if (u && u.hp > 0 && u.type === 'architect') return true;
    }
    return false;
  }

  function onLeftClick(wx, wy, shift) {
    const st = RTS.state;
    if (playerAIControlled()) return; // AI 接管中：屏蔽选择
    if (state.buildPending) {
      issueBuild(wx, wy);
      return;
    }
    if (state.attackMovePending) {
      state.attackMovePending = false;
      issueAttackMove(wx, wy);
      return;
    }
    // 优先：点选自己的城堡
    if (!shift && selectOwnBase(wx, wy)) {
      RTS.UI && RTS.UI.toast('已选中城堡：右键地面设置出生集结点', 'info');
      return;
    }
    // 点击任意非城堡目标时取消城堡选中
    st.selectedBase = null;
    const unit = hitTestUnit(wx, wy, 'player');
    if (unit) {
      if (shift) {
        st.selection.add(unit.id);
      } else {
        st.selection.clear();
        st.selection.add(unit.id);
      }
    } else {
      if (!shift) st.selection.clear();
    }
  }

  function onBoxSelect(startWorld, endWorld, shift) {
    const st = RTS.state;
    if (playerAIControlled()) return; // AI 接管中：屏蔽框选
    const minX = Math.min(startWorld.x, endWorld.x);
    const maxX = Math.max(startWorld.x, endWorld.x);
    const minY = Math.min(startWorld.y, endWorld.y);
    const maxY = Math.max(startWorld.y, endWorld.y);
    if (!shift) st.selection.clear();
    if (!shift) st.selectedBase = null;
    st.player.units.forEach((u) => {
      if (u.hp <= 0) return;
      if (u.x >= minX && u.x <= maxX && u.y >= minY && u.y <= maxY) {
        st.selection.add(u.id);
      }
    });
  }

  function onRightClick(wx, wy) {
    const st = RTS.state;
    if (playerAIControlled()) return; // AI 接管中：屏蔽移动/攻击/集结点指令
    // 右键下达移动/攻击指令时，取消待命的攻击移动/建造模式，避免下次左键误触发
    state.attackMovePending = false;
    state.buildPending = false;

    // 已选中己方城堡：右键设置单位出生集结点
    if (st.selectedBase === 'player') {
      const rally = RTS.World.nearestWalkablePx(wx, wy);
      st.player.base.rallyX = rally.x;
      st.player.base.rallyY = rally.y;
      markOrder(rally.x, rally.y, '#4aa8ff');
      RTS.UI && RTS.UI.toast('出生集结点已更新', 'info');
      return;
    }

    const enemyUnit = hitTestUnit(wx, wy, 'enemy');
    if (enemyUnit) {
      issueAttackUnit(enemyUnit);
      return;
    }
    const base = hitTestBase(wx, wy);
    if (base && base.owner === 'enemy') {
      issueAttackBase(base);
      return;
    }
    issueMove(wx, wy);
  }

  // ---------------------------------------------------------------- 事件绑定

  function init(canvas) {
    window.addEventListener('mousemove', (e) => {
      state.mouseScreen.x = e.clientX;
      state.mouseScreen.y = e.clientY;
      updateMouseWorld();
    });

    window.addEventListener('mouseleave', () => {
      state.mouseInside = false;
      state.leftDown = false;
      state.dragging = false;
    });
    window.addEventListener('mouseenter', () => {
      state.mouseInside = true;
    });

    canvas.addEventListener('mousedown', (e) => {
      updateMouseWorld();
      if (e.button === 0) {
        state.leftDown = true;
        state.dragging = true;
        state.dragStartScreen.x = e.clientX;
        state.dragStartScreen.y = e.clientY;
        state.dragStartWorld = { ...state.mouseWorld };
      } else if (e.button === 2) {
        onRightClick(state.mouseWorld.x, state.mouseWorld.y);
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (e.button === 0 && state.leftDown) {
        state.leftDown = false;
        state.dragging = false;
        const dx = e.clientX - state.dragStartScreen.x;
        const dy = e.clientY - state.dragStartScreen.y;
        const dist = Math.hypot(dx, dy);
        updateMouseWorld();
        if (dist < 6) {
          onLeftClick(state.mouseWorld.x, state.mouseWorld.y, e.shiftKey);
        } else {
          onBoxSelect(state.dragStartWorld, state.mouseWorld, e.shiftKey);
        }
      }
    });

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      updateMouseWorld();
      const before = RTS.Camera.screenToWorld(state.mouseScreen.x, state.mouseScreen.y);
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      RTS.Camera.zoomAt(factor);
      const after = RTS.Camera.screenToWorld(state.mouseScreen.x, state.mouseScreen.y);
      RTS.Camera.panWorld(before.x - after.x, before.y - after.y);
    });

    window.addEventListener('keydown', (e) => {
      const key = e.key;
      state.keys.add(key.toLowerCase());

      // 快捷键（忽略长按重复）
      if (e.repeat) return;

      // 无对局 / 对局未进行中时，忽略游戏快捷键（主菜单/结算界面按这些键不应报错）
      if (!RTS.state || RTS.state.phase !== 'running') return;

      const upper = key.toUpperCase();
      const st = RTS.state;

      // 生产快捷键：由各单位定义中的 hotkey 字段决定（新增单位无需改此代码）
      let prodType = null;
      for (const def of RTS.Units.all()) {
        if (def.hotkey && def.hotkey.toUpperCase() === upper) {
          prodType = def.id;
          break;
        }
      }

      if (prodType) {
        if (!playerAIControlled()) RTS.UI.orderProduction(prodType);
      } else if (upper === C().buildTowerKey) {
        // v9：选中建筑师后按 B 进入「建造哨塔」模式（再按一次取消）
        if (!playerAIControlled()) {
          if (!hasSelectedArchitect()) {
            RTS.UI && RTS.UI.toast('需要先选中建筑师（👷）才能建造哨塔', 'warn');
          } else {
            state.buildPending = !state.buildPending;
            state.attackMovePending = false;
            if (state.buildPending) {
              RTS.UI && RTS.UI.toast('建造模式：左键指定哨塔位置，Esc 结束', 'info');
            }
          }
        }
      } else if (upper === C().attackMoveKey) {
        if (!playerAIControlled()) {
          state.attackMovePending = true;
          state.buildPending = false;
        }
      } else if (key === 'Escape') {
        st.selection.clear();
        st.selectedBase = null;
        state.attackMovePending = false;
        state.buildPending = false;
      } else if (key === ' ') {
        e.preventDefault();
        RTS.Camera.setCenter(st.player.base.x, st.player.base.y);
      }
    });

    window.addEventListener('keyup', (e) => {
      state.keys.delete(e.key.toLowerCase());
    });

    window.addEventListener('blur', () => {
      state.keys.clear();
      state.leftDown = false;
      state.dragging = false;
    });
  }

  /** 相机平移（方向键 + 鼠标边缘滚动） */
  function update(dt) {
    const cam = RTS.Camera.get();
    const speed = C().cameraPanSpeed / cam.zoom;
    let dx = 0;
    let dy = 0;
    const k = state.keys;
    if (k.has('arrowleft')) dx -= speed;
    if (k.has('arrowright')) dx += speed;
    if (k.has('arrowup')) dy -= speed;
    if (k.has('arrowdown')) dy += speed;

    // 边缘滚动
    const edge = C().cameraEdgeScroll;
    if (state.mouseInside) {
      if (state.mouseScreen.x < edge) dx -= speed;
      if (state.mouseScreen.x > window.innerWidth - edge) dx += speed;
      if (state.mouseScreen.y < edge) dy -= speed;
      if (state.mouseScreen.y > window.innerHeight - edge) dy += speed;
    }
    if (dx || dy) RTS.Camera.panWorld(dx * dt, dy * dt);
  }

  return { init, update, getState: () => state, selectedUnits };
})();
