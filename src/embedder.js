/**
 * src/embedder.js — Node bridge to scripts/embedder_worker.py
 *
 * 一个常驻 Python 子进程加载 fastembed + bge-small-zh-v1.5 模型，
 * 通过 stdin/stdout JSON-lines 协议提供 embedding 服务。
 *
 * Public API:
 *   embed(text: string): Promise<number[]>           // 512 dims
 *   embedBatch(texts: string[]): Promise<number[][]> // 顺序逐条调，复用同一进程
 *   shutdown(): Promise<void>
 *   isReady(): boolean
 *
 * 协议见 scripts/embedder_worker.py 文件头。
 *
 * 设计取舍：
 *   - 单进程常驻：模型加载 ~3-5s，分摊到一次启动
 *   - 串行队列：fastembed 自身非线程安全，且我们用例（导入、抽牌前算 question embedding）
 *     不需要并发。串行最简单稳定
 *   - 启动失败/未配置：调用方拿到 reject(...)，draw-engine 等会降级
 *   - 启动幂等：多次 require 共享同一个进程（getEmbedder 是 module-singleton）
 */

const { spawn } = require('child_process');
const path = require('path');
const readline = require('readline');

const WORKER_PATH = path.join(__dirname, '..', 'scripts', 'embedder_worker.py');
const PYTHON_BIN = process.platform === 'win32' ? 'python' : 'python3';
const REQUEST_TIMEOUT_MS = 30000;
const READY_TIMEOUT_MS = 60000;
const EXPECTED_DIM = 512;

let singleton = null;

class Embedder {
  constructor() {
    this.proc = null;
    this.ready = false;
    this.pending = new Map(); // corrId -> {resolve, reject, timer}
    this.queue = [];          // {text, resolve, reject}
    this.processing = false;
    this.nextId = 1;
    this.readyPromise = null;
    this.bootError = null;
  }

  start() {
    if (this.readyPromise) return this.readyPromise;

    this.readyPromise = new Promise((resolve, reject) => {
      this.proc = spawn(PYTHON_BIN, [WORKER_PATH], {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      this.proc.on('error', (err) => {
        this.bootError = err;
        if (!this.ready) reject(err);
      });

      this.proc.on('exit', (code, signal) => {
        const reason = `embedder exited code=${code} signal=${signal}`;
        if (!this.ready) reject(new Error(reason));
        this.ready = false;
        // Drain pending requests
        for (const [, p] of this.pending) {
          clearTimeout(p.timer);
          p.reject(new Error(reason));
        }
        this.pending.clear();
        for (const item of this.queue) {
          item.reject(new Error(reason));
        }
        this.queue = [];
      });

      this.proc.stderr.setEncoding('utf-8');
      this.proc.stderr.on('data', (chunk) => {
        // human log, prefix to make it obvious
        process.stderr.write('[embedder.py] ' + chunk);
      });

      const rl = readline.createInterface({ input: this.proc.stdout });
      rl.on('line', (line) => this._handleLine(line, resolve));

      const bootTimer = setTimeout(() => {
        if (!this.ready) {
          reject(new Error(`embedder boot timeout (>${READY_TIMEOUT_MS}ms) — fastembed model load may be slow on first run`));
          try { this.proc.kill(); } catch (_) {}
        }
      }, READY_TIMEOUT_MS);
      this.bootTimer = bootTimer;
    });

    return this.readyPromise;
  }

  _handleLine(line, resolveReady) {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch (e) {
      process.stderr.write('[embedder] bad line from worker: ' + line + '\n');
      return;
    }

    if (msg.id === '_ready' && msg.ok) {
      this.ready = true;
      clearTimeout(this.bootTimer);
      resolveReady();
      this._drain();
      return;
    }
    if (msg.id === '_boot' && msg.error) {
      this.bootError = new Error(msg.error);
      // exit handler will reject readyPromise
      return;
    }

    const p = this.pending.get(msg.id);
    if (!p) {
      process.stderr.write('[embedder] unknown corr id: ' + msg.id + '\n');
      return;
    }
    clearTimeout(p.timer);
    this.pending.delete(msg.id);
    if (msg.error) {
      p.reject(new Error(msg.error));
    } else if (Array.isArray(msg.vec) && msg.vec.length === EXPECTED_DIM) {
      p.resolve(msg.vec);
    } else {
      p.reject(new Error('malformed embedder response'));
    }

    // single in-flight policy: drain next from queue
    this.processing = false;
    this._drain();
  }

  _drain() {
    if (!this.ready || this.processing) return;
    const item = this.queue.shift();
    if (!item) return;

    const id = String(this.nextId++);
    this.processing = true;
    const timer = setTimeout(() => {
      this.pending.delete(id);
      this.processing = false;
      item.reject(new Error(`embed timeout id=${id}`));
      this._drain();
    }, REQUEST_TIMEOUT_MS);

    this.pending.set(id, { resolve: item.resolve, reject: item.reject, timer });
    try {
      this.proc.stdin.write(JSON.stringify({ id, text: item.text }) + '\n');
    } catch (e) {
      clearTimeout(timer);
      this.pending.delete(id);
      this.processing = false;
      item.reject(e);
      this._drain();
    }
  }

  embed(text) {
    return new Promise((resolve, reject) => {
      this.queue.push({ text: text || '', resolve, reject });
      this._drain();
    });
  }

  async embedBatch(texts) {
    const out = [];
    for (const t of texts) {
      out.push(await this.embed(t));
    }
    return out;
  }

  async shutdown() {
    if (!this.proc) return;
    try {
      this.proc.stdin.write(JSON.stringify({ op: 'exit' }) + '\n');
    } catch (_) {}
    return new Promise((resolve) => {
      this.proc.once('exit', () => resolve());
      setTimeout(() => {
        try { this.proc.kill(); } catch (_) {}
        resolve();
      }, 3000);
    });
  }

  isReady() {
    return this.ready;
  }
}

function getEmbedder() {
  if (!singleton) singleton = new Embedder();
  return singleton;
}

async function embed(text) {
  const e = getEmbedder();
  await e.start();
  return e.embed(text);
}

async function embedBatch(texts) {
  const e = getEmbedder();
  await e.start();
  return e.embedBatch(texts);
}

async function shutdown() {
  if (!singleton) return;
  await singleton.shutdown();
  singleton = null;
}

module.exports = {
  embed,
  embedBatch,
  shutdown,
  getEmbedder,
  EXPECTED_DIM
};
