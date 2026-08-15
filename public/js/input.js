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
    keys: new Set(),
  };

  const C = () => RTS.CONFIG;

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

  function onLeftClick(wx, wy, shift) {
    const st = RTS.state;
    if (state.attackMovePending) {
      state.attackMovePending = false;
      issueAttackMove(wx, wy);
      return;
    }
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
    const minX = Math.min(startWorld.x, endWorld.x);
    const maxX = Math.max(startWorld.x, endWorld.x);
    const minY = Math.min(startWorld.y, endWorld.y);
    const maxY = Math.max(startWorld.y, endWorld.y);
    if (!shift) st.selection.clear();
    st.player.units.forEach((u) => {
      if (u.hp <= 0) return;
      if (u.x >= minX && u.x <= maxX && u.y >= minY && u.y <= maxY) {
        st.selection.add(u.id);
      }
    });
  }

  function onRightClick(wx, wy) {
    const st = RTS.state;
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

      const upper = key.toUpperCase();
      const st = RTS.state;
      const hotkeys = C().hotkeys;

      if (upper === hotkeys.spear) RTS.UI.orderProduction('spear');
      else if (upper === hotkeys.sword) RTS.UI.orderProduction('sword');
      else if (upper === hotkeys.archer) RTS.UI.orderProduction('archer');
      else if (upper === hotkeys.cavalry) RTS.UI.orderProduction('cavalry');
      else if (upper === C().attackMoveKey) state.attackMovePending = true;
      else if (key === 'Escape') {
        st.selection.clear();
        state.attackMovePending = false;
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
