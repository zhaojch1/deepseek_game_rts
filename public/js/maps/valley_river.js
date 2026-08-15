'use strict';

/**
 * 地图定义：河谷三路（valley_river）—— 当前小地图
 * 自包含的「地图技能」文件：尺寸 + 基地 + 进攻通道 + 资源 + 地形生成 + 供 DeepSeek 阅读的介绍。
 */

RTS.Maps.register({
  id: 'valley_river',
  name: '河谷三路',
  size: 'small', // small | medium | large
  width: 64,
  height: 64,

  // 基地位置（tile 坐标）
  playerBase: { tx: 9, ty: 32 },
  enemyBase: { tx: 54, ty: 32 },

  // 三条进攻通道（对应三座桥的 Y 格中心），AI 分路进攻/隘口防守使用
  lanes: [
    { id: 'top', ty: 11, label: '上路' },
    { id: 'mid', ty: 32, label: '中路' },
    { id: 'bottom', ty: 49, label: '下路' },
  ],

  // 桥面（y 格区间），供介绍文档与 AI 理解渡河点
  bridges: [
    { id: 'top', y0: 10, y1: 12 },
    { id: 'mid', y0: 29, y1: 35 },
    { id: 'bottom', y0: 48, y1: 50 },
  ],

  // 资源点（tile 坐标），持久控制点
  resources: [
    { type: 'gold', tx: 14, ty: 18 },
    { type: 'gold', tx: 14, ty: 46 },
    { type: 'gold', tx: 49, ty: 18 },
    { type: 'gold', tx: 49, ty: 46 },
    { type: 'wood', tx: 22, ty: 12 },
    { type: 'wood', tx: 41, ty: 12 },
    { type: 'wood', tx: 22, ty: 52 },
    { type: 'wood', tx: 41, ty: 52 },
    { type: 'stone', tx: 22, ty: 32 },
    { type: 'stone', tx: 41, ty: 32 },
    { type: 'stone', tx: 27, ty: 24 },
    { type: 'stone', tx: 36, ty: 24 },
  ],

  doc: '河谷三路（小地图 64×64 格）：中央一条 4 格宽纵向河流把战场切为左/右两侧，仅三座桥梁（上路 y≈11、中路 y≈32、下路 y≈49）可渡河，形成上/中/下三条进攻通道。玩家基地在左（格 9,32），敌方基地在右（格 54,32）。地图左右镜像对称。资源点：4 座金矿（基地附近安全区）、4 座伐木场（木）、4 座采石场（石），均为持久控制点（驻守易主后即使离开仍保持归属，敌方可反夺）。另有湖泊、山脉（不可通行）与森林（远程减伤掩体）散布。中路由中央大道直通，为最短主攻通道；上路/下路较绕，适合侧翼迂回与伏击。',

  generate(world) {
    const W = world.W;
    const H = world.H;
    const G = RTS.CONFIG.terrainTypes;
    const set = (tx, ty, t, w) => RTS.World.setTile(world, tx, ty, t, w);
    const setSym = (tx, ty, t, w) => RTS.World.setSym(world, tx, ty, t, w);
    const addBlob = (cx, cy, r, t, w) => RTS.World.addBlob(world, cx, cy, r, t, w);

    // 边界岩石
    for (let x = 0; x < W; x++) {
      set(x, 0, G.rock, false);
      set(x, H - 1, G.rock, false);
    }
    for (let y = 0; y < H; y++) {
      set(0, y, G.rock, false);
      set(W - 1, y, G.rock, false);
    }

    // 中央纵向河流（4 格宽），三座桥梁为渡河点
    const riverX = [30, 31, 32, 33];
    const bridges = [[10, 12], [29, 35], [48, 50]];
    for (let y = 1; y < H - 1; y++) {
      const inBridge = bridges.some((b) => y >= b[0] && y <= b[1]);
      for (const x of riverX) {
        set(x, y, inBridge ? G.road : G.water, inBridge);
      }
    }

    // 中央大道：从两侧基地直通中央桥梁（主攻通道）
    for (let y = 31; y <= 32; y++) {
      for (let x = 10; x <= 29; x++) {
        set(x, y, G.road, true);
        set(W - 1 - x, y, G.road, true);
      }
    }

    // 湖泊（左右对称）
    addBlob(12, 12, 2, G.water, false);
    addBlob(12, 52, 2, G.water, false);

    // 山脉/岩石：隘口与侧翼阻挡
    addBlob(16, 6, 2, G.rock, false);
    addBlob(16, 58, 2, G.rock, false);
    addBlob(24, 22, 2, G.rock, false);
    addBlob(24, 44, 2, G.rock, false);
    addBlob(28, 8, 1, G.rock, false);
    addBlob(28, 56, 1, G.rock, false);

    // 森林（掩体）：通道两侧与桥头
    addBlob(14, 24, 3, G.forest, true);
    addBlob(14, 40, 3, G.forest, true);
    addBlob(20, 14, 2, G.forest, true);
    addBlob(20, 50, 2, G.forest, true);
    addBlob(26, 32, 2, G.forest, true);
    addBlob(22, 28, 1, G.forest, true);
    addBlob(22, 36, 1, G.forest, true);
  },
});
