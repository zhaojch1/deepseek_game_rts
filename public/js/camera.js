'use strict';

/**
 * camera.js — 相机与视野（缩放、平移、坐标转换）
 */

RTS.Camera = (function () {
  let x = 0;
  let y = 0;
  let zoom = 1;
  let viewW = 1;
  let viewH = 1;

  function init() {
    // 初始对准玩家基地
    if (RTS.state) {
      x = RTS.state.player.base.x;
      y = RTS.state.player.base.y;
    }
    resize();
  }

  function resize() {
    viewW = window.innerWidth;
    viewH = window.innerHeight;
  }

  function get() {
    return { x, y, zoom, viewW, viewH };
  }

  function setCenter(nx, ny) {
    x = nx;
    y = ny;
    clamp();
  }

  function setZoom(z) {
    const Cfg = RTS.CONFIG;
    zoom = Math.max(Cfg.cameraMinZoom, Math.min(Cfg.cameraMaxZoom, z));
    clamp();
  }

  function zoomAt(factor) {
    setZoom(zoom * factor);
  }

  function clamp() {
    const Cfg = RTS.CONFIG;
    const halfW = viewW / 2 / zoom;
    const halfH = viewH / 2 / zoom;
    // v14：允许视野完全超出地图，这样玩家可以俯瞰整个地图
    // 但为了防止完全迷失，限制中心点在地图周围一定范围内
    const margin = Math.max(Cfg.worldWidth, Cfg.worldHeight) * 0.5;
    const minX = -margin;
    const maxX = Cfg.worldWidth + margin;
    const minY = -margin;
    const maxY = Cfg.worldHeight + margin;
    x = Math.max(minX, Math.min(maxX, x));
    y = Math.max(minY, Math.min(maxY, y));
  }

  function worldToScreen(wx, wy) {
    return {
      x: (wx - x) * zoom + viewW / 2,
      y: (wy - y) * zoom + viewH / 2,
    };
  }

  function screenToWorld(sx, sy) {
    return {
      x: (sx - viewW / 2) / zoom + x,
      y: (sy - viewH / 2) / zoom + y,
    };
  }

  /** 平移（传入世界坐标增量，已含缩放处理由调用方决定） */
  function panWorld(dx, dy) {
    x += dx;
    y += dy;
    clamp();
  }

  return { init, resize, get, setCenter, setZoom, zoomAt, clamp, worldToScreen, screenToWorld, panWorld };
})();
