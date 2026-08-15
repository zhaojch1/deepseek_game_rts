'use strict';

/**
 * 地图定义：大盆地（grand_basin）—— v8 新增大型地图
 * 128×128，中央纵向大河 + 三座大桥，战场尺度远超中小地图：
 * 更多资源点（金4/木8/石10）、更远的交战距离，强调多路分兵、地图控制与后勤。
 */

RTS.Maps.register({
  id: 'grand_basin',
  name: '大盆地',
  size: 'large', // small | medium | large
  width: 128,
  height: 128,

  // 基地位置（tile 坐标，左右对称）
  playerBase: { tx: 14, ty: 64 },
  enemyBase: { tx: 113, ty: 64 },

  // 三条进攻通道（对应三座桥的 Y 格中心）
  lanes: [
    { id: 'top', ty: 24, label: '上路' },
    { id: 'mid', ty: 64, label: '中路' },
    { id: 'bottom', ty: 104, label: '下路' },
  ],

  // 桥面（y 格区间）
  bridges: [
    { id: 'top', y0: 23, y1: 25 },
    { id: 'mid', y0: 61, y1: 67 },
    { id: 'bottom', y0: 102, y1: 104 },
  ],

  // 资源点（tile 坐标，持久控制点；大图资源最丰富：金8/木12/石14 共 34 座）
  // 布局：金矿 每侧近基地安全区×2 + 中场争议区×2；木/石沿通道与基地周围铺开
  resources: [
    // ---- 金矿（4 组镜像 = 8 座）----
    // 近基地安全区（左右各 2）
    { type: 'gold', tx: 22, ty: 40 },
    { type: 'gold', tx: 22, ty: 88 },
    { type: 'gold', tx: 105, ty: 40 },
    { type: 'gold', tx: 105, ty: 88 },
    // 中场争议区（左右各 2，靠近大河，需争夺）
    { type: 'gold', tx: 40, ty: 48 },
    { type: 'gold', tx: 40, ty: 80 },
    { type: 'gold', tx: 87, ty: 48 },
    { type: 'gold', tx: 87, ty: 80 },
    // ---- 伐木场（6 组镜像 = 12 座）----
    { type: 'wood', tx: 34, ty: 24 },
    { type: 'wood', tx: 93, ty: 24 },
    { type: 'wood', tx: 34, ty: 104 },
    { type: 'wood', tx: 93, ty: 104 },
    { type: 'wood', tx: 44, ty: 36 },
    { type: 'wood', tx: 83, ty: 36 },
    { type: 'wood', tx: 44, ty: 92 },
    { type: 'wood', tx: 83, ty: 92 },
    { type: 'wood', tx: 26, ty: 34 },
    { type: 'wood', tx: 101, ty: 34 },
    { type: 'wood', tx: 26, ty: 94 },
    { type: 'wood', tx: 101, ty: 94 },
    // ---- 采石场（7 组镜像 = 14 座）----
    { type: 'stone', tx: 34, ty: 64 },
    { type: 'stone', tx: 93, ty: 64 },
    { type: 'stone', tx: 48, ty: 52 },
    { type: 'stone', tx: 79, ty: 52 },
    { type: 'stone', tx: 48, ty: 76 },
    { type: 'stone', tx: 79, ty: 76 },
    { type: 'stone', tx: 56, ty: 28 },
    { type: 'stone', tx: 71, ty: 28 },
    { type: 'stone', tx: 56, ty: 100 },
    { type: 'stone', tx: 71, ty: 100 },
    { type: 'stone', tx: 40, ty: 20 },
    { type: 'stone', tx: 87, ty: 20 },
    { type: 'stone', tx: 40, ty: 108 },
    { type: 'stone', tx: 87, ty: 108 },
  ],

  doc: '大盆地（大型地图 128×128 格）：中央一条 4 格宽纵向大河把战场切为左/右两侧，仅三座大桥（上路 y≈24、中路 y≈64、下路 y≈104）可渡河，形成上/中/下三条进攻通道。玩家基地在左（格 14,64），敌方基地在右（格 113,64），地图左右镜像对称。资源点共 34 座（全游戏最丰富）：金矿×8（每侧近基地安全区 2 座 + 中场大河两侧争议区各 2 座）、伐木场×12、采石场×14，均为持久控制点（驻守易主后即使离开仍保持归属，敌方可反夺）。战场尺度为中小地图的两倍，中路大桥最宽（7 格），上下路桥窄（3 格）适合侧翼迂回与伏击；湖泽、山脉散布两侧形成隘口，森林（远程减伤掩体）位于各通道与桥头。大地图资源点多、分布广，经济与科技全面提速，胜负更依赖多路分兵、资源控制与科技优势，侦察与地图视野至关重要。',

  generate(world) {
    const W = world.W;
    const H = world.H;
    const G = RTS.CONFIG.terrainTypes;
    const set = (tx, ty, t, w) => RTS.World.setTile(world, tx, ty, t, w);
    const setSym = (tx, ty, t, w) => RTS.World.setSym(world, tx, ty, t, w);
    const addBlob = (cx, cy, r, t, w) => RTS.World.addBlob(world, cx, cy, r, t, w);

    // 边界岩石（必须不可通行，防单位走出地图）
    for (let x = 0; x < W; x++) {
      set(x, 0, G.rock, false);
      set(x, H - 1, G.rock, false);
    }
    for (let y = 0; y < H; y++) {
      set(0, y, G.rock, false);
      set(W - 1, y, G.rock, false);
    }

    // 中央纵向大河（4 格宽），三座大桥为渡河点
    const riverX = [62, 63, 64, 65];
    const bridges = [[23, 25], [61, 67], [102, 104]];
    for (let y = 1; y < H - 1; y++) {
      const inBridge = bridges.some((b) => y >= b[0] && y <= b[1]);
      for (const x of riverX) {
        set(x, y, inBridge ? G.road : G.water, inBridge);
      }
    }

    // 中央大道：从两侧基地直通中路大桥（主攻通道）
    for (let y = 63; y <= 64; y++) {
      for (let x = 15; x <= 61; x++) {
        set(x, y, G.road, true);
        set(W - 1 - x, y, G.road, true);
      }
    }

    // 湖泽（左右对称，天然隘口）
    addBlob(28, 28, 3, G.water, false);
    addBlob(28, 100, 3, G.water, false);
    addBlob(24, 46, 2, G.water, false);
    addBlob(24, 82, 2, G.water, false);

    // 山脉/岩石：隘口与侧翼阻挡
    addBlob(36, 12, 2, G.rock, false);
    addBlob(36, 116, 2, G.rock, false);
    addBlob(48, 44, 2, G.rock, false);
    addBlob(48, 84, 2, G.rock, false);
    addBlob(40, 18, 1, G.rock, false);
    addBlob(40, 110, 1, G.rock, false);

    // 森林（掩体）：通道两侧与桥头
    addBlob(32, 54, 3, G.forest, true);
    addBlob(32, 74, 3, G.forest, true);
    addBlob(44, 22, 2, G.forest, true);
    addBlob(44, 106, 2, G.forest, true);
    addBlob(54, 60, 2, G.forest, true);
    addBlob(54, 68, 2, G.forest, true);
    addBlob(40, 34, 1, G.forest, true);
    addBlob(40, 94, 1, G.forest, true);
  },
});
