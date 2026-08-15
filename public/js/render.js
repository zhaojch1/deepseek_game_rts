'use strict';

/**
 * render.js — Canvas 2D 渲染：地形、障碍、基地、单位、选区、血条、飘字、小地图
 */

RTS.Render = (function () {
  let canvas;
  let ctx;
  let minimap;
  let minimapCtx;
  let obstacles = []; // [{x,y}] 障碍格中心（世界坐标）

  const C = () => RTS.CONFIG;

  function init(mainCanvas, minimapCanvas) {
    canvas = mainCanvas;
    ctx = canvas.getContext('2d');
    minimap = minimapCanvas;
    minimapCtx = minimapCanvas.getContext('2d');
    collectObstacles();
    resize();
  }

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!ctx.roundRect) {
      // roundRect polyfill（兼容稍旧浏览器）
      CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
        if (typeof r === 'number') r = [r, r, r, r];
        const [tl, tr, br, bl] = r;
        this.moveTo(x + tl, y);
        this.arcTo(x + w, y, x + w, y + h, tr);
        this.arcTo(x + w, y + h, x, y + h, br);
        this.arcTo(x, y + h, x, y, bl);
        this.arcTo(x, y, x + w, y, tl);
        this.closePath();
        return this;
      };
    }
  }

  function collectObstacles() {
    const world = RTS.world;
    obstacles = [];
    const Cfg = C();
    for (let ty = 0; ty < world.H; ty++) {
      for (let tx = 0; tx < world.W; tx++) {
        if (!RTS.World.isWalkable(tx, ty)) {
          // 跳过地图边界（单独绘制）
          if (tx === 0 || ty === 0 || tx === world.W - 1 || ty === world.H - 1) continue;
          const c = RTS.World.tileToCenter(tx, ty);
          obstacles.push({ x: c.x, y: c.y });
        }
      }
    }
  }

  function viewportWorld() {
    const cam = RTS.Camera.get();
    const halfW = cam.viewW / 2 / cam.zoom;
    const halfH = cam.viewH / 2 / cam.zoom;
    const m = C().renderCullMargin;
    return {
      left: cam.x - halfW - m,
      right: cam.x + halfW + m,
      top: cam.y - halfH - m,
      bottom: cam.y + halfH + m,
    };
  }

  function applyCamera() {
    const cam = RTS.Camera.get();
    ctx.save();
    ctx.translate(cam.viewW / 2, cam.viewH / 2);
    ctx.scale(cam.zoom, cam.zoom);
    ctx.translate(-cam.x, -cam.y);
  }

  function drawTerrain() {
    const Cfg = C();
    const vp = viewportWorld();
    ctx.fillStyle = '#1c3322';
    ctx.fillRect(vp.left, vp.top, vp.right - vp.left, vp.bottom - vp.top);

    // 网格线
    ctx.strokeStyle = 'rgba(255,255,255,0.035)';
    ctx.lineWidth = 1 / RTS.Camera.get().zoom;
    ctx.beginPath();
    const x0 = Math.max(0, Math.floor(vp.left / Cfg.tileSize));
    const x1 = Math.min(Cfg.mapWidthTiles, Math.ceil(vp.right / Cfg.tileSize));
    const y0 = Math.max(0, Math.floor(vp.top / Cfg.tileSize));
    const y1 = Math.min(Cfg.mapHeightTiles, Math.ceil(vp.bottom / Cfg.tileSize));
    for (let tx = x0; tx <= x1; tx++) {
      ctx.moveTo(tx * Cfg.tileSize, vp.top);
      ctx.lineTo(tx * Cfg.tileSize, vp.bottom);
    }
    for (let ty = y0; ty <= y1; ty++) {
      ctx.moveTo(vp.left, ty * Cfg.tileSize);
      ctx.lineTo(vp.right, ty * Cfg.tileSize);
    }
    ctx.stroke();

    // 边界
    ctx.strokeStyle = 'rgba(255,90,90,0.4)';
    ctx.lineWidth = 4 / RTS.Camera.get().zoom;
    ctx.strokeRect(0, 0, Cfg.worldWidth, Cfg.worldHeight);
  }

  function drawObstacles() {
    const vp = viewportWorld();
    const size = C().tileSize * 0.82;
    ctx.fillStyle = '#12301c';
    for (const o of obstacles) {
      if (o.x < vp.left - size || o.x > vp.right + size || o.y < vp.top - size || o.y > vp.bottom + size) continue;
      // 岩石/树林占位
      ctx.fillStyle = '#0f2a18';
      ctx.fillRect(o.x - size / 2, o.y - size / 2, size, size);
      ctx.fillStyle = '#1d4527';
      ctx.beginPath();
      ctx.arc(o.x, o.y, size * 0.32, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawBase(base, label) {
    const vp = viewportWorld();
    if (base.x < vp.left - 120 || base.x > vp.right + 120 || base.y < vp.top - 120 || base.y > vp.bottom + 120) return;
    const r = base.radius;
    const color = base.owner === 'player' ? '#3d7bd8' : '#d84a4a';
    // 主体
    ctx.fillStyle = '#0c1220';
    ctx.strokeStyle = color;
    ctx.lineWidth = 3 / RTS.Camera.get().zoom;
    ctx.beginPath();
    ctx.roundRect(base.x - r, base.y - r, r * 2, r * 2, 8);
    ctx.fill();
    ctx.stroke();
    // 内城
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.25;
    ctx.fillRect(base.x - r * 0.5, base.y - r * 0.5, r, r);
    ctx.globalAlpha = 1;
    // 旗帜
    ctx.strokeStyle = '#e8eef7';
    ctx.lineWidth = 2 / RTS.Camera.get().zoom;
    ctx.beginPath();
    ctx.moveTo(base.x, base.y - r);
    ctx.lineTo(base.x, base.y - r - 24);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(base.x, base.y - r - 24);
    ctx.lineTo(base.x + 18, base.y - r - 19);
    ctx.lineTo(base.x, base.y - r - 14);
    ctx.fill();

    // 基地血条
    drawBar(base.x, base.y - r - 34, r * 2, base.hp / base.maxHp, '#6ee7a0');
  }

  function drawBar(x, y, w, ratio, color) {
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(x - w / 2, y, w, 5);
    ctx.fillStyle = color;
    ctx.fillRect(x - w / 2, y, w * Math.max(0, Math.min(1, ratio)), 5);
  }

  function drawUnitShape(u) {
    const s = RTS.Unit.typeStats(u.type);
    const r = u.radius;
    const color = s.color;
    ctx.save();
    ctx.translate(u.x, u.y);

    // 兵种形状
    ctx.fillStyle = color;
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 1.5 / RTS.Camera.get().zoom;
    ctx.beginPath();
    if (u.type === 'spear') {
      // 三角（枪头）
      ctx.moveTo(r, 0);
      ctx.lineTo(-r * 0.7, -r * 0.7);
      ctx.lineTo(-r * 0.7, r * 0.7);
      ctx.closePath();
    } else if (u.type === 'sword') {
      // 方形（盾）
      ctx.rect(-r * 0.75, -r * 0.75, r * 1.5, r * 1.5);
    } else if (u.type === 'archer') {
      // 圆
      ctx.arc(0, 0, r * 0.85, 0, Math.PI * 2);
    } else {
      // 菱形（骑兵）
      ctx.moveTo(r, 0);
      ctx.lineTo(0, -r * 0.7);
      ctx.lineTo(-r, 0);
      ctx.lineTo(0, r * 0.7);
      ctx.closePath();
    }
    ctx.fill();
    ctx.stroke();

    // 朝向标记
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.beginPath();
    ctx.arc(r * 0.35 * u.facingX, 0, Math.max(2, r * 0.18), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawUnits() {
    const st = RTS.state;
    const vp = viewportWorld();
    const z = RTS.Camera.get().zoom;

    const drawOne = (u, isEnemy) => {
      if (u.x < vp.left - 30 || u.x > vp.right + 30 || u.y < vp.top - 30 || u.y > vp.bottom + 30) return;

      // 阵营描边
      const ownerColor = isEnemy ? '#ff5a5a' : '#4aa8ff';
      ctx.strokeStyle = ownerColor;
      ctx.lineWidth = 2 / z;
      ctx.beginPath();
      ctx.arc(u.x, u.y, u.radius + 3, 0, Math.PI * 2);
      ctx.stroke();

      drawUnitShape(u);

      // 选中高亮
      if (!isEnemy && st.selection.has(u.id)) {
        ctx.strokeStyle = '#6ee7a0';
        ctx.lineWidth = 3 / z;
        ctx.beginPath();
        ctx.arc(u.x, u.y, u.radius + 7, 0, Math.PI * 2);
        ctx.stroke();
      }

      // 血条（选中或受损时）
      if ((!isEnemy && st.selection.has(u.id)) || u.hp < u.maxHp) {
        drawBar(u.x, u.y - u.radius - 8, u.radius * 2.4, u.hp / u.maxHp, u.hp / u.maxHp > 0.5 ? '#6ee7a0' : '#ffb020');
      }
    };

    st.enemy.units.forEach((u) => drawOne(u, true));
    st.player.units.forEach((u) => drawOne(u, false));
  }

  function drawDamageNumbers() {
    const st = RTS.state;
    const z = RTS.Camera.get().zoom;
    ctx.font = `${Math.max(12, 14 / z)}px "Segoe UI", sans-serif`;
    ctx.textAlign = 'center';
    for (const d of st.damageNumbers) {
      ctx.globalAlpha = Math.min(1, d.life / 0.3);
      ctx.fillStyle = d.color;
      ctx.fillText(String(d.value), d.x, d.y);
    }
    ctx.globalAlpha = 1;
  }

  function drawCommands() {
    const inp = RTS.Input.getState();
    // 攻击移动待命：准星
    if (inp.attackMovePending) {
      const w = inp.mouseWorld;
      const z = RTS.Camera.get().zoom;
      ctx.strokeStyle = '#ff5a5a';
      ctx.lineWidth = 2 / z;
      ctx.beginPath();
      ctx.arc(w.x, w.y, 14 / z, 0, Math.PI * 2);
      ctx.moveTo(w.x - 20 / z, w.y);
      ctx.lineTo(w.x + 20 / z, w.y);
      ctx.moveTo(w.x, w.y - 20 / z);
      ctx.lineTo(w.x, w.y + 20 / z);
      ctx.stroke();
    }
  }

  function drawOrderMarker() {
    const m = RTS.state.orderMarker;
    if (!m) return;
    const age = performance.now() - m.t;
    const life = 1 - age / 600;
    if (life <= 0) {
      RTS.state.orderMarker = null;
      return;
    }
    const z = RTS.Camera.get().zoom;
    ctx.strokeStyle = m.color;
    ctx.globalAlpha = life;
    ctx.lineWidth = 2 / z;
    ctx.beginPath();
    ctx.arc(m.x, m.y, 12 / z + (1 - life) * 10, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(m.x - 5 / z, m.y);
    ctx.lineTo(m.x + 5 / z, m.y);
    ctx.moveTo(m.x, m.y - 5 / z);
    ctx.lineTo(m.x, m.y + 5 / z);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function drawSelectionBox() {
    const inp = RTS.Input.getState();
    if (!inp.dragging) return;
    const sx = inp.dragStartScreen.x;
    const sy = inp.dragStartScreen.y;
    const mx = inp.mouseScreen.x;
    const my = inp.mouseScreen.y;
    ctx.fillStyle = 'rgba(110,231,160,0.12)';
    ctx.strokeStyle = '#6ee7a0';
    ctx.lineWidth = 1;
    ctx.fillRect(Math.min(sx, mx), Math.min(sy, my), Math.abs(mx - sx), Math.abs(my - sy));
    ctx.strokeRect(Math.min(sx, mx), Math.min(sy, my), Math.abs(mx - sx), Math.abs(my - sy));
  }

  function draw() {
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    applyCamera();
    drawTerrain();
    drawObstacles();
    drawBase(RTS.state.player.base, '指挥所');
    drawBase(RTS.state.enemy.base, '敌方指挥所');
    drawUnits();
    drawDamageNumbers();
    drawCommands();
    drawOrderMarker();
    ctx.restore();
    drawSelectionBox();
  }

  // ---------------------------------------------------------------- 小地图

  function drawMinimap() {
    const Cfg = C();
    const w = minimap.width;
    const h = minimap.height;
    const sx = w / Cfg.worldWidth;
    const sy = h / Cfg.worldHeight;
    const mctx = minimapCtx;

    mctx.fillStyle = '#0a0f18';
    mctx.fillRect(0, 0, w, h);

    // 障碍
    mctx.fillStyle = '#12301c';
    for (const o of obstacles) {
      mctx.fillRect(o.x * sx - 1, o.y * sy - 1, 2, 2);
    }

    // 基地
    mctx.fillStyle = '#4aa8ff';
    mctx.fillRect(RTS.state.player.base.x * sx - 3, RTS.state.player.base.y * sy - 3, 6, 6);
    mctx.fillStyle = '#ff5a5a';
    mctx.fillRect(RTS.state.enemy.base.x * sx - 3, RTS.state.enemy.base.y * sy - 3, 6, 6);

    // 单位
    mctx.fillStyle = '#4aa8ff';
    RTS.state.player.units.forEach((u) => mctx.fillRect(u.x * sx - 1, u.y * sy - 1, 2, 2));
    mctx.fillStyle = '#ff5a5a';
    RTS.state.enemy.units.forEach((u) => mctx.fillRect(u.x * sx - 1, u.y * sy - 1, 2, 2));

    // 视野范围
    const cam = RTS.Camera.get();
    const vw = (cam.viewW / cam.zoom) * sx;
    const vh = (cam.viewH / cam.zoom) * sy;
    mctx.strokeStyle = 'rgba(255,255,255,0.7)';
    mctx.lineWidth = 1;
    mctx.strokeRect((cam.x - cam.viewW / 2 / cam.zoom) * sx, (cam.y - cam.viewH / 2 / cam.zoom) * sy, vw, vh);
  }

  return { init, resize, draw, drawMinimap, viewportWorld };
})();
