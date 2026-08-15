'use strict';

/**
 * 地图定义：广域河谷（wide_river）—— 中地图
 * 96×96，中央河流 + 三座桥梁 + 更广的森林/湖泊/山脉与更多资源点。
 */

RTS.Maps.register({
  id: 'wide_river',
  name: '广域河谷',
  size: 'medium', // small | medium | large
  width: 96,
  height: 96,

  // 基地位置（tile 坐标，左右对称）
  playerBase: { tx: 12, ty: 48 },
  enemyBase: { tx: 83, ty: 48 },

  // 三条进攻通道（对应三座桥的 Y 格中心）
  lanes: [
    { id: 'top', ty: 16, label: '上路' },
    { id: 'mid', ty: 47, label: '中路' },
    { id: 'bottom', ty: 77, label: '下路' },
  ],

  // 桥面（y 格区间）
  bridges: [
    { id: 'top', y0: 15, y1: 17 },
    { id: 'mid', y0: 44, y1: 50 },
    { id: 'bottom', y0: 76, y1: 78 },
  ],

  // 资源点（tile 坐标，持久控制点；中地图资源更丰富）
  resources: [
    { type: 'gold', tx: 18, ty: 24 },
    { type: 'gold', tx: 18, ty: 72 },
    { type: 'gold', tx: 77, ty: 24 },
    { type: 'gold', tx: 77, ty: 72 },
    { type: 'wood', tx: 30, ty: 16 },
    { type: 'wood', tx: 65, ty: 16 },
    { type: 'wood', tx: 30, ty: 80 },
    { type: 'wood', tx: 65, ty: 80 },
    { type: 'stone', tx: 30, ty: 48 },
    { type: 'stone', tx: 65, ty: 48 },
    { type: 'stone', tx: 40, ty: 34 },
    { type: 'stone', tx: 55, ty: 34 },
    { type: 'stone', tx: 40, ty: 62 },
    { type: 'stone', tx: 55, ty: 62 },
  ],

  doc: '广域河谷（中地图 96×96 格）：中央一条 4 格宽纵向河流把战场切为左/右两侧，仅三座桥梁（上路 y≈16、中路 y≈47、下路 y≈77）可渡河，形成上/中/下三条进攻通道。玩家基地在左（格 12,48），敌方基地在右（格 83,48），地图左右镜像对称。资源点共 14 座：金矿×4（两侧基地安全区）、伐木场×4、采石场×6，均为持久控制点（驻守易主后即使离开仍保持归属，敌方可反夺）。另有湖泊、山脉（不可通行）与森林（远程减伤掩体）散布，中路由中央大道直通为最短主攻通道，上/下路较绕适合侧翼迂回。地图尺度大于小地图，交战距离更长、更依赖多路分兵与地图控制。',

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
    const riverX = [46, 47, 48, 49];
    const bridges = [[15, 17], [44, 50], [76, 78]];
    for (let y = 1; y < H - 1; y++) {
      const inBridge = bridges.some((b) => y >= b[0] && y <= b[1]);
      for (const x of riverX) {
        set(x, y, inBridge ? G.road : G.water, inBridge);
      }
    }

    // 中央大道：从两侧基地直通中央桥梁（主攻通道）
    for (let y = 47; y <= 48; y++) {
      for (let x = 13; x <= 45; x++) {
        set(x, y, G.road, true);
        set(W - 1 - x, y, G.road, true);
      }
    }

    // 湖泊（左右对称）
    addBlob(18, 14, 2, G.water, false);
    addBlob(18, 82, 2, G.water, false);

    // 山脉/岩石：隘口与侧翼阻挡
    addBlob(24, 8, 2, G.rock, false);
    addBlob(24, 88, 2, G.rock, false);
    addBlob(36, 28, 2, G.rock, false);
    addBlob(36, 68, 2, G.rock, false);
    addBlob(40, 10, 1, G.rock, false);
    addBlob(40, 86, 1, G.rock, false);

    // 森林（掩体）：通道两侧与桥头
    addBlob(20, 34, 3, G.forest, true);
    addBlob(20, 62, 3, G.forest, true);
    addBlob(28, 20, 2, G.forest, true);
    addBlob(28, 76, 2, G.forest, true);
    addBlob(42, 40, 2, G.forest, true);
    addBlob(42, 56, 2, G.forest, true);
    addBlob(30, 48, 1, G.forest, true);
  },
});
