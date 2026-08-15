'use strict';

/**
 * DeepSeek Game RTS — 零依赖后端
 * 职责：
 *  1. 提供 public/ 静态资源（HTML/CSS/JS）
 *  2. 代理 POST /api/ai/command 到 DeepSeek API（敌方 AI 指挥官决策）
 *
 * 运行：node server.js
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

// ---------------------------------------------------------------- 配置读取

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');

function loadEnvFile(filePath) {
  try {
    const text = fs.readFileSync(filePath, 'utf8');
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (key && process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  } catch (_) {
    /* .env 不存在时忽略 */
  }
}
loadEnvFile(path.join(ROOT, '.env'));

const PORT = Number(process.env.PORT) || 3000;
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-v4-pro';
const DEEPSEEK_ENDPOINT = process.env.DEEPSEEK_ENDPOINT || 'https://api.deepseek.com/chat/completions';
const AI_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS) || 5000;

// ---------------------------------------------------------------- 静态文件

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.txt': 'text/plain; charset=utf-8',
};

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (urlPath === '/' || urlPath === '') urlPath = '/index.html';

  // 路径安全：禁止逃逸 public/ 目录
  const filePath = path.normalize(path.join(PUBLIC_DIR, urlPath));
  if (!filePath.startsWith(PUBLIC_DIR + path.sep) && filePath !== PUBLIC_DIR) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

// ---------------------------------------------------------------- JSON 工具

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 1_000_000) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

// ---------------------------------------------------------------- DeepSeek 调用

/**
 * 从模型返回的 content 中尽量稳健地提取一个 JSON 对象。
 * 兼容被 ```json ... ``` 包裹、或前后夹杂说明文字的情况。
 */
function extractJson(content) {
  if (!content) return null;
  // 去掉 markdown 代码块
  let text = content.replace(/```(?:json)?/gi, '```');
  const fence = text.match(/```([\s\S]*?)```/);
  if (fence) text = fence[1];
  // 尝试直接解析
  try {
    return JSON.parse(text.trim());
  } catch (_) {
    /* 继续降级提取 */
  }
  // 提取首个 { ... } 平衡对象
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch (_) {
          return null;
        }
      }
    }
  }
  return null;
}

function clampDecision(decision) {
  if (!decision || typeof decision !== 'object') return null;
  const armyFocus = ['spear', 'sword', 'archer', 'cavalry'].includes(decision.armyFocus)
    ? decision.armyFocus
    : null;
  let aggression = Number(decision.aggression);
  if (!Number.isFinite(aggression)) aggression = 50;
  aggression = Math.max(0, Math.min(100, Math.round(aggression)));
  const attackNow = decision.attackNow === true;
  let comment = typeof decision.comment === 'string' ? decision.comment.slice(0, 60) : '';
  if (!armyFocus && !attackNow && typeof decision.attackNow === 'undefined' && aggression === 50) {
    return null; // 完全非法
  }
  return { armyFocus, aggression, attackNow, comment };
}

function callDeepSeek(payload) {
  return new Promise((resolve, reject) => {
    const endpoint = new URL(DEEPSEEK_ENDPOINT);
    const body = JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages: [
        {
          role: 'system',
          content:
            '你是 RTS 游戏的敌方指挥官。你只能回复一个合法 JSON，不要输出任何其他文字。' +
            'JSON 字段：armyFocus(兵种倾向，值为 spear/sword/archer/cavalry 之一)、' +
            'aggression(0-100 进攻倾向)、attackNow(布尔)、comment(不超过30字说明)。',
        },
        {
          role: 'user',
          content: JSON.stringify(payload),
        },
      ],
      thinking: { type: 'enabled' },
      reasoning_effort: 'high',
      stream: false,
    });

    const req = https.request(
      {
        hostname: endpoint.hostname,
        port: endpoint.port || 443,
        path: endpoint.pathname + endpoint.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
        },
      },
      (res) => {
        let size = 0;
        const chunks = [];
        res.on('data', (c) => {
          size += c.length;
          if (size > 5_000_000) {
            reject(new Error('response too large'));
            req.destroy();
            return;
          }
          chunks.push(c);
        });
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode !== 200) {
            reject(new Error(`deepseek http ${res.statusCode}: ${text.slice(0, 300)}`));
            return;
          }
          try {
            const data = JSON.parse(text);
            const content = data?.choices?.[0]?.message?.content;
            const decision = extractJson(typeof content === 'string' ? content : '');
            const clamped = clampDecision(decision);
            if (!clamped) reject(new Error('无法从模型输出解析出合法决策 JSON'));
            else resolve(clamped);
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(AI_TIMEOUT_MS, () => {
      req.destroy(new Error('timeout'));
    });
    req.write(body);
    req.end();
  });
}

// ---------------------------------------------------------------- 路由

async function handleAiCommand(req, res) {
  if (!DEEPSEEK_API_KEY) {
    sendJson(res, 200, { ok: false, reason: 'no_key', message: '未配置 DEEPSEEK_API_KEY，使用规则 AI' });
    return;
  }
  let payload;
  try {
    payload = await readJsonBody(req);
  } catch (e) {
    sendJson(res, 400, { ok: false, reason: 'bad_request', message: String(e.message) });
    return;
  }
  try {
    const decision = await callDeepSeek(payload);
    sendJson(res, 200, { ok: true, decision, source: 'deepseek' });
  } catch (e) {
    // 超时/失败/非法 → 降级，不报错中断
    const msg = String(e && e.message ? e.message : e);
    sendJson(res, 200, { ok: false, reason: 'degraded', message: msg.slice(0, 200) });
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'POST' && url.pathname === '/api/ai/command') {
    handleAiCommand(req, res).catch((e) => {
      sendJson(res, 500, { ok: false, reason: 'error', message: String(e.message) });
    });
    return;
  }
  if (req.method === 'GET' && url.pathname === '/api/health') {
    sendJson(res, 200, {
      ok: true,
      hasKey: !!DEEPSEEK_API_KEY,
      model: DEEPSEEK_MODEL,
    });
    return;
  }
  if (req.method === 'GET' || req.method === 'HEAD') {
    serveStatic(req, res);
    return;
  }
  res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Method Not Allowed');
});

server.listen(PORT, () => {
  console.log(`[RTS] DeepSeek Game RTS 服务器已启动`);
  console.log(`[RTS] 访问地址：http://localhost:${PORT}`);
  console.log(`[RTS] DeepSeek AI：${DEEPSEEK_API_KEY ? '已配置 (' + DEEPSEEK_MODEL + ')' : '未配置（纯规则 AI 模式）'}`);
});
