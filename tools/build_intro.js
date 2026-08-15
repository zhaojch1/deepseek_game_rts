'use strict';

/**
 * build_intro.js — 生成供 DeepSeek / 人类阅读的单位与地图介绍文件
 *
 * 用法：node tools/build_intro.js
 * 产出：
 *   public/data/units.md  —— 每个单位一段详细中文介绍（含数值/标签/克制/AI 角色）
 *   public/data/maps.md   —— 每张地图一段详细中文介绍（含尺寸/基地/通道/资源/地形）
 *
 * 说明：本脚本读取 public/js/units/*.js 与 public/js/maps/*.js（单一数据源），
 * 在 Node 沙箱中求值注册调用，剥离 draw/generate 函数后生成文档。
 * 零依赖，无需 npm install。新增单位/地图后重新运行本脚本即可刷新介绍文件。
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

// 收集注册定义
const units = new Map();
const maps = new Map();
const sandbox = {
  RTS: {
    Units: { register: (d) => { if (d && d.id) units.set(d.id, d); } },
    Maps: { register: (d) => { if (d && d.id) maps.set(d.id, d); } },
  },
};
sandbox.globalThis = sandbox;
const ctx = vm.createContext(sandbox);

function loadDir(dir) {
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.js')).sort(); } catch (_) { /* 目录不存在 */ }
  for (const f of files) {
    try {
      vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f });
    } catch (e) {
      console.error(`[build_intro] 加载失败 ${f}: ${e.message}`);
    }
  }
}
loadDir(path.join(ROOT, 'public', 'js', 'units'));
loadDir(path.join(ROOT, 'public', 'js', 'maps'));

const DATA_DIR = path.join(ROOT, 'public', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

// ---------------------------------------------------------------- units.md
let unitsMd = '# 单位介绍\n\n';
unitsMd += `> 本文档由 \`node tools/build_intro.js\` 自动生成，数据源为 \`public/js/units/*.js\`。\n`;
unitsMd += `> 单位总数：${units.size}\n\n`;

for (const u of units.values()) {
  const bonus = Object.entries(u.bonusVs || {}).map(([k, v]) => `\`${k}\` ×${v}`).join('、') || '无';
  const resist = Object.entries(u.resistVs || {}).map(([k, v]) => `\`${k}\` ×${v}`).join('、') || '无';
  unitsMd += `## ${u.icon || ''} ${u.name}（\`${u.id}\`）\n\n`;
  unitsMd += `| 属性 | 值 |\n|---|---|\n`;
  unitsMd += `| 成本(军费) | ${u.cost} |\n`;
  unitsMd += `| 生命 | ${u.hp} |\n`;
  unitsMd += `| 攻击 | ${u.attack} |\n`;
  unitsMd += `| 射程 | ${u.range} 格（${u.ranged ? '远程' : '近战'}） |\n`;
  unitsMd += `| 攻击间隔 | ${u.attackInterval}s |\n`;
  unitsMd += `| 移速 | ${u.speed} 格/s |\n`;
  unitsMd += `| 训练时间 | ${u.trainTime}s |\n`;
  unitsMd += `| 标签 | ${(u.tags || []).map((t) => `\`${t}\``).join(' ')} |\n`;
  unitsMd += `| 克制(攻击方) | ${bonus} |\n`;
  unitsMd += `| 抗性(受击方) | ${resist} |\n`;
  unitsMd += `| 攻城(对基地) | ${u.baseMul ? `×${u.baseMul}` : '—'} |\n`;
  unitsMd += `| 快捷键 | ${u.hotkey || '—'} |\n`;
  unitsMd += `| AI 角色 | ${(u.ai && u.ai.desc) || '—'} |\n\n`;
  unitsMd += `${u.doc || ''}\n\n`;
}

// ---------------------------------------------------------------- maps.md
let mapsMd = '# 地图介绍\n\n';
mapsMd += `> 本文档由 \`node tools/build_intro.js\` 自动生成，数据源为 \`public/js/maps/*.js\`。\n`;
mapsMd += `> 地图总数：${maps.size}\n\n`;

for (const m of maps.values()) {
  const lanes = (m.lanes || []).map((l) => `\`${l.label || l.id}\``).join('、') || '无';
  const bridges = (m.bridges || []).map((b) => `${b.id || ''}(y${b.y0}~${b.y1})`).join('、') || '无';
  const resCount = (m.resources || []).reduce((acc, r) => { acc[r.type] = (acc[r.type] || 0) + 1; return acc; }, {});
  const resStr = Object.entries(resCount).map(([k, v]) => `${k}×${v}`).join('、') || '无';
  mapsMd += `## ${m.name}（\`${m.id}\`）\n\n`;
  mapsMd += `| 属性 | 值 |\n|---|---|\n`;
  mapsMd += `| 尺寸 | ${m.width}×${m.height} 格（${m.size || '—'}） |\n`;
  mapsMd += `| 玩家基地 | 格(${m.playerBase.tx}, ${m.playerBase.ty}) |\n`;
  mapsMd += `| 敌方基地 | 格(${m.enemyBase.tx}, ${m.enemyBase.ty}) |\n`;
  mapsMd += `| 进攻通道 | ${lanes} |\n`;
  mapsMd += `| 渡河桥梁 | ${bridges} |\n`;
  mapsMd += `| 资源点 | ${resStr} |\n\n`;
  mapsMd += `${m.doc || ''}\n\n`;
}

fs.writeFileSync(path.join(DATA_DIR, 'units.md'), unitsMd, 'utf8');
fs.writeFileSync(path.join(DATA_DIR, 'maps.md'), mapsMd, 'utf8');

console.log(`[build_intro] 已生成 public/data/units.md（${units.size} 个单位）`);
console.log(`[build_intro] 已生成 public/data/maps.md（${maps.size} 张地图）`);
