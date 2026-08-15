'use strict';

/**
 * render.js — Canvas 2D 渲染
 * 第二阶段：复杂地形（河流/桥梁/森林/山脉/道路）、精细矢量单位与动画、
 * 城堡箭塔、实体箭矢、资源节点、死亡尸体、小地图。
 */

RTS.Render = (function () {
  let canvas;
  let ctx;
  let minimap;
  let minimapCtx;
  let terrainMinimap;
  let terrainMapId = null;

  const C = () => RTS.CONFIG;

  // 调色板
  const PAL = {
    skin: '#e8c39a',
    skinShade: '#c99f72',
    metal: '#d7dee8',
    steel: '#8fa3c2',
    wood: '#8a5a34',
    dark: '#22252c',
    leather: '#6b4a2a',
  };

  function tunic(owner) {
    return owner === 'player' ? '#3d7bd8' : '#c94545';
  }
  function tunicDark(owner) {
    return owner === 'player' ? '#2b5aa8' : '#8f3232';
  }

  function init(mainCanvas, minimapCanvas) {
    canvas = mainCanvas;
    ctx = canvas.getContext('2d');
    minimap = minimapCanvas;
    minimapCtx = minimapCanvas.getContext('2d');
    resize();
    // 注意：不在此处构建地形小地图——主菜单阶段 RTS.world 尚未创建，
    // 改由 drawMinimap() 在首次渲染时惰性构建（见下）。
  }

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!ctx.roundRect) {
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

  /** 确定性 0..1 哈希（地形纹理 / 树形随机，避免闪烁） */
  function hash2(tx, ty) {
    let h = (tx * 374761393 + ty * 668265263) | 0;
    h = (h ^ (h >> 13)) * 1274126177;
    h = h ^ (h >> 16);
    return (h >>> 0) / 4294967295;
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
    const ts = Cfg.tileSize;
    const G = Cfg.terrainTypes;

    // 草地底色
    ctx.fillStyle = '#24402a';
    ctx.fillRect(vp.left, vp.top, vp.right - vp.left, vp.bottom - vp.top);

    const x0 = Math.max(0, Math.floor(vp.left / ts));
    const x1 = Math.min(RTS.world.W - 1, Math.ceil(vp.right / ts));
    const y0 = Math.max(0, Math.floor(vp.top / ts));
    const y1 = Math.min(RTS.world.H - 1, Math.ceil(vp.bottom / ts));

    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const px = tx * ts;
        const py = ty * ts;
        const t = RTS.World.terrainAt(tx, ty);
        if (t === G.water) {
          drawWaterTile(px, py, ts, tx, ty);
        } else if (t === G.forest) {
          drawGrassTile(px, py, ts, tx, ty);
          drawTree(px + ts / 2, py + ts / 2, ts, tx, ty);
        } else if (t === G.rock) {
          drawRockTile(px, py, ts, tx, ty);
        } else if (t === G.road) {
          drawRoadTile(px, py, ts, tx, ty);
        } else {
          drawGrassTile(px, py, ts, tx, ty);
        }
      }
    }

    // 边界
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 6 / RTS.Camera.get().zoom;
    ctx.strokeRect(2, 2, Cfg.worldWidth - 4, Cfg.worldHeight - 4);
  }

  function drawGrassTile(px, py, ts, tx, ty) {
    const h = hash2(tx, ty);
    ctx.fillStyle = h > 0.85 ? '#2a4a30' : h < 0.15 ? '#1f3a26' : '#24402a';
    ctx.fillRect(px, py, ts, ts);
    // 草丛点缀
    if (h > 0.6 && h < 0.9) {
      ctx.fillStyle = 'rgba(90,140,80,0.5)';
      const gx = px + h * ts;
      const gy = py + (hash2(ty, tx) * ts);
      ctx.fillRect(gx, gy, 2, 4);
      ctx.fillRect(gx + 3, gy + 1, 2, 3);
    }
  }

  function drawWaterTile(px, py, ts, tx, ty) {
    ctx.fillStyle = '#2e5f8a';
    ctx.fillRect(px, py, ts, ts);
    const wave = Math.sin(RTS.state.time * 2 + (tx * 0.7 + ty * 0.9));
    ctx.fillStyle = 'rgba(120,180,220,0.35)';
    ctx.fillRect(px + (ts * 0.2) + wave * 4, py + ts * 0.45, ts * 0.5, 2);
  }

  function drawRoadTile(px, py, ts, tx, ty) {
    ctx.fillStyle = '#8a7a5a';
    ctx.fillRect(px, py, ts, ts);
    ctx.fillStyle = 'rgba(0,0,0,0.10)';
    ctx.fillRect(px, py + ts * 0.5, ts, 2);
  }

  function drawRockTile(px, py, ts, tx, ty) {
    ctx.fillStyle = '#4a5560';
    ctx.fillRect(px, py, ts, ts);
    const h = hash2(tx, ty);
    ctx.fillStyle = '#5f6b78';
    ctx.beginPath();
    ctx.moveTo(px + 2, py + ts - 2);
    ctx.lineTo(px + ts * 0.3, py + 2);
    ctx.lineTo(px + ts * 0.55, py + ts * 0.35);
    ctx.lineTo(px + ts - 2, py + ts - 4);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.beginPath();
    ctx.moveTo(px + ts * 0.3, py + 4);
    ctx.lineTo(px + ts * 0.42, py + ts * 0.3);
    ctx.lineTo(px + ts * 0.3, py + ts * 0.5);
    ctx.closePath();
    ctx.fill();
  }

  function drawTree(cx, cy, ts, tx, ty) {
    const h = hash2(tx, ty);
    const s = ts * (0.6 + h * 0.3);
    // 树干
    ctx.fillStyle = '#5a3a20';
    ctx.fillRect(cx - s * 0.12, cy, s * 0.24, s * 0.5);
    // 树冠（两层，更有体积感）
    ctx.fillStyle = '#1d5a2f';
    ctx.beginPath();
    ctx.arc(cx, cy - s * 0.25, s * 0.42, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2c7a3f';
    ctx.beginPath();
    ctx.arc(cx - s * 0.15, cy - s * 0.4, s * 0.3, 0, Math.PI * 2);
    ctx.arc(cx + s * 0.15, cy - s * 0.35, s * 0.28, 0, Math.PI * 2);
    ctx.fill();
  }

  // ---------------------------------------------------------------- 基地 / 城堡

  function drawBase(base) {
    const vp = viewportWorld();
    if (base.x < vp.left - 160 || base.x > vp.right + 160 || base.y < vp.top - 160 || base.y > vp.bottom + 160) return;
    const r = base.radius;
    const owner = base.owner;
    const color = owner === 'player' ? '#4aa8ff' : '#ff5a5a';

    ctx.save();
    ctx.translate(base.x, base.y);

    // 城体
    ctx.fillStyle = '#3a3f4a';
    ctx.strokeStyle = '#0c1220';
    ctx.lineWidth = 3 / RTS.Camera.get().zoom;
    ctx.beginPath();
    ctx.roundRect(-r, -r * 0.8, r * 2, r * 1.6, 8);
    ctx.fill();
    ctx.stroke();

    // 城墙砖纹
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    ctx.lineWidth = 1 / RTS.Camera.get().zoom;
    for (let i = -1; i <= 1; i++) {
      const yy = i * r * 0.4;
      ctx.beginPath();
      ctx.moveTo(-r, yy);
      ctx.lineTo(r, yy);
      ctx.stroke();
    }

    // 四座角塔（箭塔位，从世界辅助函数取坐标，保证与射箭位置一致）
    const towers = RTS.World.baseTowerPositions(base);
    const towerR = r * RTS.CONFIG.baseTowerRadius;
    towers.forEach((tw, i) => {
      const tx = tw.x - base.x;
      const ty = tw.y - base.y;
      // 塔身
      ctx.fillStyle = '#4a4f5a';
      ctx.strokeStyle = '#0c1220';
      ctx.lineWidth = 2 / RTS.Camera.get().zoom;
      ctx.beginPath();
      ctx.arc(tx, ty, towerR, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      // 城垛
      ctx.fillStyle = '#5a6070';
      for (let k = -1; k <= 1; k++) {
        ctx.fillRect(tx - towerR * 0.9 + k * towerR * 0.9, ty - towerR, towerR * 0.5, towerR * 0.4);
      }
      // 塔顶闪光（发射塔箭时）
      const flash = (base.towerFlash && base.towerFlash[i] > 0)
        ? Math.min(1, base.towerFlash[i] / RTS.CONFIG.baseTowerFlash)
        : 0;
      ctx.fillStyle = flash > 0 ? `rgba(255,210,78,${0.4 + flash * 0.6})` : '#6b7280';
      ctx.beginPath();
      ctx.moveTo(tx, ty - towerR);
      ctx.lineTo(tx, ty - towerR * 1.5);
      ctx.lineTo(tx + towerR * 0.5, ty - towerR);
      ctx.closePath();
      ctx.fill();
      // 闪光光晕
      if (flash > 0) {
        ctx.globalAlpha = flash * 0.5;
        ctx.fillStyle = '#ffe9a3';
        ctx.beginPath();
        ctx.arc(tx, ty - towerR * 1.1, towerR * 0.9, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    });

    // 城门
    ctx.fillStyle = '#1b1e24';
    ctx.beginPath();
    ctx.arc(0, r * 0.55, r * 0.28, Math.PI, 0);
    ctx.fill();

    // 旗帜
    const flagY = -r * 0.8 - 30;
    ctx.strokeStyle = '#e8eef7';
    ctx.lineWidth = 2.5 / RTS.Camera.get().zoom;
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.8);
    ctx.lineTo(0, flagY);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, flagY);
    ctx.lineTo(20, flagY + 5);
    ctx.lineTo(0, flagY + 10);
    ctx.fill();
    ctx.restore();

    // 己方城堡被选中：高亮描边
    if (RTS.state.selectedBase === base.owner) {
      ctx.strokeStyle = '#6ee7a0';
      ctx.lineWidth = 3 / RTS.Camera.get().zoom;
      ctx.beginPath();
      ctx.arc(base.x, base.y, base.radius + 14, 0, Math.PI * 2);
      ctx.stroke();
    }

    // 单位出生集结点标记（旗帜 + 虚线落点）
    if (base.rallyX != null && base.rallyY != null) {
      const selected = RTS.state.selectedBase === base.owner;
      const z = RTS.Camera.get().zoom;
      const rx = base.rallyX;
      const ry = base.rallyY;
      ctx.globalAlpha = selected ? 1 : 0.55;
      ctx.strokeStyle = selected ? '#6ee7a0' : '#9fb0c8';
      ctx.lineWidth = 1.5 / z;
      ctx.setLineDash([6 / z, 5 / z]);
      ctx.beginPath();
      ctx.arc(rx, ry, 14, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      // 旗杆 + 旗面
      ctx.strokeStyle = '#e8eef7';
      ctx.lineWidth = 2 / z;
      ctx.beginPath();
      ctx.moveTo(rx, ry);
      ctx.lineTo(rx, ry - 22);
      ctx.stroke();
      ctx.fillStyle = selected ? '#6ee7a0' : color;
      ctx.beginPath();
      ctx.moveTo(rx, ry - 22);
      ctx.lineTo(rx + 13, ry - 17);
      ctx.lineTo(rx, ry - 12);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // 基地血条
    drawBar(base.x, base.y - r - 44, r * 2, base.hp / base.maxHp, '#6ee7a0');
  }

  function drawBar(x, y, w, ratio, color) {
    ctx.fillStyle = 'rgba(0,0,0,0.62)';
    ctx.fillRect(x - w / 2, y, w, 6);
    ctx.fillStyle = color;
    ctx.fillRect(x - w / 2, y, w * Math.max(0, Math.min(1, ratio)), 6);
  }

  // ---------------------------------------------------------------- v9 防御哨塔

  function drawTowers() {
    const st = RTS.state;
    if (!st || !st.towers || st.towers.length === 0) return;
    const vp = viewportWorld();
    const z = RTS.Camera.get().zoom;
    for (const t of st.towers) {
      if (t.x < vp.left - 80 || t.x > vp.right + 80 || t.y < vp.top - 80 || t.y > vp.bottom + 80) continue;
      const r = t.radius;
      const color = t.owner === 'player' ? '#4aa8ff' : '#ff5a5a';

      ctx.save();
      ctx.translate(t.x, t.y);
      // 底座阴影
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath();
      ctx.ellipse(0, r * 0.85, r * 1.1, r * 0.32, 0, 0, Math.PI * 2);
      ctx.fill();
      // 塔身（石质圆塔）
      ctx.fillStyle = '#5a6070';
      ctx.strokeStyle = '#0c1220';
      ctx.lineWidth = 2 / z;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      // 砖纹
      ctx.strokeStyle = 'rgba(0,0,0,0.18)';
      ctx.lineWidth = 1 / z;
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.moveTo(-r, i * r * 0.55);
        ctx.lineTo(r, i * r * 0.55);
        ctx.stroke();
      }
      // 城垛
      ctx.fillStyle = '#6b7280';
      for (let k = -1; k <= 1; k++) {
        ctx.fillRect(k * r * 0.85 - r * 0.32, -r, r * 0.64, r * 0.4);
      }
      // 塔顶（含发射闪光）
      const flash = t.firingFlash > 0 ? Math.min(1, t.firingFlash / C().towerFlash) : 0;
      ctx.fillStyle = flash > 0 ? `rgba(255,210,78,${0.4 + flash * 0.6})` : '#4a4f5a';
      ctx.beginPath();
      ctx.moveTo(0, -r);
      ctx.lineTo(-r * 0.42, -r * 1.45);
      ctx.lineTo(r * 0.42, -r * 1.45);
      ctx.closePath();
      ctx.fill();
      if (flash > 0) {
        ctx.globalAlpha = flash * 0.5;
        ctx.fillStyle = '#ffe9a3';
        ctx.beginPath();
        ctx.arc(0, -r * 1.1, r * 0.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      // 旗帜
      ctx.strokeStyle = '#e8eef7';
      ctx.lineWidth = 1.8 / z;
      ctx.beginPath();
      ctx.moveTo(0, -r * 1.45);
      ctx.lineTo(0, -r * 1.9);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, -r * 1.9);
      ctx.lineTo(r * 0.55, -r * 1.78);
      ctx.lineTo(0, -r * 1.66);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      // 血条
      drawBar(t.x, t.y - r - 16, r * 2, t.hp / t.maxHp, t.hp / t.maxHp > 0.5 ? '#6ee7a0' : '#ffb020');
    }
  }

  // v10.2：兵营（营房造型 + 血条）
  function drawBarracks() {
    const st = RTS.state;
    if (!st || !st.barracks || st.barracks.length === 0) return;
    const vp = viewportWorld();
    const z = RTS.Camera.get().zoom;
    for (const b of st.barracks) {
      if (b.x < vp.left - 80 || b.x > vp.right + 80 || b.y < vp.top - 80 || b.y > vp.bottom + 80) continue;
      const r = b.radius;
      const color = b.owner === 'player' ? '#4aa8ff' : '#ff5a5a';

      ctx.save();
      ctx.translate(b.x, b.y);
      // 底座阴影
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath();
      ctx.ellipse(0, r * 0.9, r * 1.15, r * 0.34, 0, 0, Math.PI * 2);
      ctx.fill();
      // 墙体（石质基座）
      ctx.fillStyle = '#7a6a52';
      ctx.strokeStyle = '#0c1220';
      ctx.lineWidth = 2 / z;
      ctx.beginPath();
      ctx.roundRect(-r, -r * 0.35, r * 2, r * 0.85, r * 0.18);
      ctx.fill();
      ctx.stroke();
      // 帐篷顶（布质，双色）
      ctx.fillStyle = b.owner === 'player' ? '#4a7dbf' : '#c04a4a';
      ctx.beginPath();
      ctx.moveTo(-r * 1.05, -r * 0.25);
      ctx.lineTo(0, -r * 1.35);
      ctx.lineTo(r * 1.05, -r * 0.25);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      // 屋脊线
      ctx.strokeStyle = 'rgba(0,0,0,0.25)';
      ctx.lineWidth = 1.2 / z;
      ctx.beginPath();
      ctx.moveTo(-r * 0.4, -r * 0.25);
      ctx.lineTo(0, -r * 1.05);
      ctx.lineTo(r * 0.4, -r * 0.25);
      ctx.stroke();
      // 大门
      ctx.fillStyle = '#3a2a1a';
      ctx.beginPath();
      ctx.roundRect(-r * 0.32, -r * 0.12, r * 0.64, r * 0.62, r * 0.12);
      ctx.fill();
      // 旗帜
      ctx.strokeStyle = '#e8eef7';
      ctx.lineWidth = 1.8 / z;
      ctx.beginPath();
      ctx.moveTo(0, -r * 1.35);
      ctx.lineTo(0, -r * 1.75);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, -r * 1.75);
      ctx.lineTo(r * 0.55, -r * 1.63);
      ctx.lineTo(0, -r * 1.51);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      // 血条
      drawBar(b.x, b.y - r - 16, r * 2, b.hp / b.maxHp, b.hp / b.maxHp > 0.5 ? '#6ee7a0' : '#ffb020');
      // 兵营标记（可与基地/哨塔区分）
      ctx.font = `${Math.max(10, 11 / z)}px "Segoe UI", sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffe9a3';
      ctx.fillText('⚒', b.x, b.y - r - 22);
    }
  }

  // ---------------------------------------------------------------- 单位绘制
  // 单位的实际绘制由各自定义文件（js/units/*.js 的 draw 函数）负责，这里只做通用包装。

  function drawUnit(u) {
    const def = RTS.Units.get(u.type);
    const r = u.radius;

    ctx.save();
    ctx.translate(u.x, u.y);

    // 阴影
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    ctx.ellipse(0, r * 0.9, r * 0.95, r * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.scale(u.facingX, 1);

    const strike = u.attackWindup > 0 ? 1 - u.attackWindup / C().attackWindup : 0;
    const recoil = u.attackAnim > 0 ? u.attackAnim / 0.22 : 0;
    const view = {
      u,
      r,
      owner: u.owner,
      p: u.animPhase,
      moving: u.state === 'move' || u.state === 'attackMove' || u.state === 'attack',
      strike,
      recoil,
    };

    if (def && typeof def.draw === 'function') {
      def.draw(ctx, view);
    } else {
      // 兜底：无绘制定义时画圆形占位
      ctx.fillStyle = (def && def.color) || '#cccccc';
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();

    // 受击白闪
    if (u.flashTimer > 0) {
      ctx.save();
      ctx.globalAlpha = u.flashTimer / 0.12 * 0.6;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(u.x, u.y, u.radius + 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawUnits() {
    const st = RTS.state;
    const vp = viewportWorld();
    const z = RTS.Camera.get().zoom;

    const drawOne = (u, isEnemy) => {
      if (u.x < vp.left - 40 || u.x > vp.right + 40 || u.y < vp.top - 40 || u.y > vp.bottom + 40) return;

      // 阵营描边
      const ownerColor = isEnemy ? '#ff5a5a' : '#4aa8ff';
      ctx.strokeStyle = ownerColor;
      ctx.lineWidth = 2 / z;
      ctx.beginPath();
      ctx.arc(u.x, u.y, u.radius + 4, 0, Math.PI * 2);
      ctx.stroke();

      drawUnit(u);

      // 选中高亮
      if (!isEnemy && st.selection.has(u.id)) {
        ctx.strokeStyle = '#6ee7a0';
        ctx.lineWidth = 3 / z;
        ctx.beginPath();
        ctx.arc(u.x, u.y, u.radius + 8, 0, Math.PI * 2);
        ctx.stroke();
      }

      // 血条（选中或受损时）
      if ((!isEnemy && st.selection.has(u.id)) || u.hp < u.maxHp) {
        drawBar(u.x, u.y - u.radius - 12, u.radius * 2.4, u.hp / u.maxHp, u.hp / u.maxHp > 0.5 ? '#6ee7a0' : '#ffb020');
      }

      // v9：建筑师施工进度条
      if (u.building) {
        const b = u.building;
        const ratio = Math.max(0, Math.min(1, b.progress / b.total));
        const bw = u.radius * 2.2;
        const by = u.y - u.radius - 22;
        ctx.fillStyle = 'rgba(0,0,0,0.62)';
        ctx.fillRect(u.x - bw / 2, by, bw, 5);
        ctx.fillStyle = '#ffd24e';
        ctx.fillRect(u.x - bw / 2, by, bw * ratio, 5);
        // 施工进度环图标
        ctx.font = `${Math.max(10, 11 / z)}px "Segoe UI", sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillStyle = '#ffe9a3';
        ctx.fillText('🔨', u.x, by - 4);
      }
    };

    st.enemy.units.forEach((u) => drawOne(u, true));
    st.player.units.forEach((u) => drawOne(u, false));
  }

  function drawCorpses() {
    const st = RTS.state;
    if (!st.corpses) return;
    const vp = viewportWorld();
    for (const c of st.corpses) {
      if (c.x < vp.left - 30 || c.x > vp.right + 30 || c.y < vp.top - 30 || c.y > vp.bottom + 30) continue;
      const t = Math.max(0, Math.min(1, c.deathTimer));
      const r = c.radius;
      ctx.save();
      ctx.globalAlpha = t;
      ctx.translate(c.x, c.y);
      ctx.rotate(c.facingX * (1 - t) * 1.2); // 缓缓倒地
      // 尸体：躯干 + 头盔
      ctx.fillStyle = tunic(c.owner);
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 0.9, r * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = PAL.skin;
      ctx.beginPath();
      ctx.arc(r * 0.5, -r * 0.2, r * 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = PAL.metal;
      ctx.beginPath();
      ctx.arc(r * 0.5, -r * 0.26, r * 0.32, Math.PI, 0);
      ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------- 投射物

  function drawProjectiles() {
    const vp = viewportWorld();
    for (const p of RTS.Projectiles.list) {
      if (p.x < vp.left - 30 || p.x > vp.right + 30 || p.y < vp.top - 30 || p.y > vp.bottom + 30) continue;
      ctx.save();
      ctx.translate(p.x, p.y);

      // 尾迹与发射线使用「世界坐标差值」，必须在 rotate 之前绘制，
      // 否则会被箭的飞行方向角再次旋转，导致尾迹与飞行轨迹错开（√/八 形）。
      // 尾迹（渐隐，沿世界坐标轨迹）
      if (p.trail && p.trail.length > 1) {
        for (let i = 1; i < p.trail.length; i++) {
          const a = i / p.trail.length;
          ctx.strokeStyle = `rgba(200,214,235,${(a * 0.35).toFixed(3)})`;
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.moveTo(p.trail[i - 1].x - p.x, p.trail[i - 1].y - p.y);
          ctx.lineTo(p.trail[i].x - p.x, p.trail[i].y - p.y);
          ctx.stroke();
        }
      }

      // 塔箭：从角塔射出的短促发射线（发射点也是世界坐标）
      if (p.kind === 'tower' && p.source) {
        ctx.strokeStyle = 'rgba(255,220,130,0.5)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(p.source.x - p.x, p.source.y - p.y);
        ctx.lineTo(0, 0);
        ctx.stroke();
      }

      // 箭体按飞行方向旋转（局部坐标）
      ctx.rotate(p.angle);

      // 箭杆（塔箭更粗更暗，弓箭细长）
      ctx.strokeStyle = p.kind === 'tower' ? '#3a2a1a' : '#8a6a3a';
      ctx.lineWidth = p.kind === 'tower' ? 3.2 : 2.2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-10, 0);
      ctx.lineTo(8, 0);
      ctx.stroke();
      // 箭头（金属，指向飞行方向）
      const grad = ctx.createLinearGradient(8, 0, 15, 0);
      grad.addColorStop(0, '#dbe4f0');
      grad.addColorStop(1, '#8fa3c2');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(8, -3.4);
      ctx.lineTo(15, 0);
      ctx.lineTo(8, 3.4);
      ctx.closePath();
      ctx.fill();
      // 尾羽（两片，更立体）
      ctx.fillStyle = p.owner === 'player' ? '#4aa8ff' : '#ff5a5a';
      ctx.beginPath();
      ctx.moveTo(-10, 0);
      ctx.lineTo(-14, -3.6);
      ctx.lineTo(-9, -1.5);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-10, 0);
      ctx.lineTo(-14, 3.6);
      ctx.lineTo(-9, 1.5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  // ---------------------------------------------------------------- 资源节点

  function drawResourceNodes() {
    const st = RTS.state;
    if (!st.resources) return;
    const vp = viewportWorld();
    const z = RTS.Camera.get().zoom;

    for (const node of st.resources.nodes) {
      if (node.x < vp.left - 60 || node.x > vp.right + 60 || node.y < vp.top - 60 || node.y > vp.bottom + 60) continue;
      const cfg = C().resourceNodes[node.type];
      const r = 22;

      // 占领圈
      const ownerColor = node.owner === 'player' ? '#4aa8ff' : node.owner === 'enemy' ? '#ff5a5a' : 'rgba(255,255,255,0.25)';
      ctx.strokeStyle = ownerColor;
      ctx.lineWidth = 2.5 / z;
      ctx.beginPath();
      ctx.arc(node.x, node.y, r + 8, 0, Math.PI * 2);
      ctx.stroke();

      // 占领进度弧（control ∈ -1..1，展示控制强度与方向）
      const ctrl = node.control || 0;
      if (ctrl !== 0) {
        ctx.strokeStyle = ctrl > 0 ? '#4aa8ff' : '#ff5a5a';
        ctx.lineWidth = 4 / z;
        ctx.beginPath();
        ctx.arc(node.x, node.y, r + 14, -Math.PI / 2, -Math.PI / 2 + Math.abs(ctrl) * Math.PI * 2);
        ctx.stroke();
      }
      // 已归属节点加填充标记
      if (node.owner !== 'neutral') {
        ctx.fillStyle = ownerColor;
        ctx.beginPath();
        ctx.arc(node.x, node.y, 4, 0, Math.PI * 2);
        ctx.fill();
      }

      // 节点底座
      ctx.fillStyle = 'rgba(20,24,32,0.75)';
      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
      ctx.fill();

      // 图标
      if (node.type === 'gold') {
        ctx.fillStyle = '#f2c14e';
        ctx.beginPath();
        ctx.moveTo(node.x, node.y - 12);
        ctx.lineTo(node.x + 10, node.y - 4);
        ctx.lineTo(node.x + 6, node.y + 8);
        ctx.lineTo(node.x - 6, node.y + 8);
        ctx.lineTo(node.x - 10, node.y - 4);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#fff3c4';
        ctx.beginPath();
        ctx.arc(node.x - 3, node.y - 6, 2.5, 0, Math.PI * 2);
        ctx.fill();
      } else if (node.type === 'wood') {
        ctx.fillStyle = '#6b4a2a';
        ctx.fillRect(node.x - 10, node.y - 6, 20, 12);
        ctx.strokeStyle = '#a97c50';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(node.x, node.y, 8, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.fillStyle = '#9fb0c8';
        ctx.beginPath();
        ctx.moveTo(node.x, node.y - 12);
        ctx.lineTo(node.x + 10, node.y);
        ctx.lineTo(node.x, node.y + 10);
        ctx.lineTo(node.x - 10, node.y + 2);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#c8d4e8';
        ctx.beginPath();
        ctx.arc(node.x - 3, node.y - 2, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // ---------------------------------------------------------------- 飘字 / 指令

  function drawDamageNumbers() {
    const st = RTS.state;
    const z = RTS.Camera.get().zoom;
    ctx.font = `bold ${Math.max(12, 15 / z)}px "Segoe UI", sans-serif`;
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
    drawResourceNodes();
    drawBase(RTS.state.player.base);
    drawBase(RTS.state.enemy.base);
    drawTowers(); // v9：防御哨塔
    drawBarracks(); // v10.2：兵营
    drawCorpses();
    drawUnits();
    drawProjectiles();
    drawDamageNumbers();
    drawCommands();
    drawOrderMarker();
    ctx.restore();
    drawSelectionBox();
  }

  // ---------------------------------------------------------------- 小地图

  function buildTerrainMinimap() {
    if (!RTS.world) return; // 主菜单阶段尚无地图
    terrainMinimap = document.createElement('canvas');
    terrainMinimap.width = minimap.width;
    terrainMinimap.height = minimap.height;
    const mc = terrainMinimap.getContext('2d');
    const Cfg = C();
    const sx = minimap.width / Cfg.worldWidth;
    const sy = minimap.height / Cfg.worldHeight;
    const G = Cfg.terrainTypes;

    mc.fillStyle = '#24402a';
    mc.fillRect(0, 0, minimap.width, minimap.height);
    for (let ty = 0; ty < RTS.world.H; ty++) {
      for (let tx = 0; tx < RTS.world.W; tx++) {
        const t = RTS.World.terrainAt(tx, ty);
        if (t === G.water) mc.fillStyle = '#2e5f8a';
        else if (t === G.forest) mc.fillStyle = '#1d4a2a';
        else if (t === G.rock) mc.fillStyle = '#4a5560';
        else if (t === G.road) mc.fillStyle = '#8a7a5a';
        else continue;
        mc.fillRect(tx * Cfg.tileSize * sx, ty * Cfg.tileSize * sy, Math.max(1, Cfg.tileSize * sx), Math.max(1, Cfg.tileSize * sy));
      }
    }
    terrainMapId = RTS.world.mapId;
  }

  function drawMinimap() {
    const Cfg = C();
    const w = minimap.width;
    const h = minimap.height;
    const sx = w / Cfg.worldWidth;
    const sy = h / Cfg.worldHeight;
    const mctx = minimapCtx;

    // 惰性构建 / 换图后重建地形小地图
    if (!terrainMinimap || terrainMapId !== RTS.world.mapId) buildTerrainMinimap();

    if (terrainMinimap) mctx.drawImage(terrainMinimap, 0, 0);
    else {
      mctx.fillStyle = '#0a0f18';
      mctx.fillRect(0, 0, w, h);
    }

    // 资源点
    for (const node of RTS.state.resources.nodes) {
      mctx.fillStyle = node.owner === 'player' ? '#4aa8ff' : node.owner === 'enemy' ? '#ff5a5a' : '#c9c9c9';
      mctx.fillRect(node.x * sx - 2, node.y * sy - 2, 4, 4);
    }

    // 基地
    mctx.fillStyle = '#4aa8ff';
    mctx.fillRect(RTS.state.player.base.x * sx - 4, RTS.state.player.base.y * sy - 4, 8, 8);
    mctx.fillStyle = '#ff5a5a';
    mctx.fillRect(RTS.state.enemy.base.x * sx - 4, RTS.state.enemy.base.y * sy - 4, 8, 8);

    // v9：防御哨塔
    if (RTS.state.towers) {
      for (const t of RTS.state.towers) {
        mctx.fillStyle = t.owner === 'player' ? '#6ec6ff' : '#ff8a8a';
        mctx.fillRect(t.x * sx - 2, t.y * sy - 2, 4, 4);
      }
    }

    // v10.2：兵营（比哨塔稍大的方块）
    if (RTS.state.barracks) {
      for (const b of RTS.state.barracks) {
        mctx.fillStyle = b.owner === 'player' ? '#8f7bff' : '#ff8a8a';
        mctx.fillRect(b.x * sx - 3, b.y * sy - 3, 6, 6);
      }
    }

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
