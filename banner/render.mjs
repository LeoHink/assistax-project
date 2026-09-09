#!/usr/bin/env node
/**
 * render.mjs — deterministic capture of banner.html to MP4.
 *
 * Zero npm dependencies: uses only Node built-ins (>=22 for global WebSocket),
 * the system Chromium, and the system ffmpeg.
 *
 *   node render.mjs                                  full 10s render -> banner.mp4
 *   node render.mjs --stills 0.6,1.5,2.6,3.7,5,9.5   just those frames -> stills/
 *   node render.mjs --out /tmp/x.mp4 --crf 20        overrides
 *
 * How it works: banner.html?capture=1 exposes window.__seek(t), which seeks all
 * five <video> elements AND paints every animated property from t. Nothing is
 * driven by wall-clock, so frame N is byte-reproducible.
 */
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));

/* ---------------------------------------------------------------- args -- */
function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  return i === -1 ? fallback : process.argv[i + 1];
}
const given = (name) => process.argv.includes('--' + name);
// fps and duration default to whatever banner.html's CFG says -- they are read
// from the page after it loads (see below), so the composition stays the single
// source of truth. Passing --fps/--duration overrides it.
const OPTS = {
  fps:      Number(arg('fps', 30)),
  duration: Number(arg('duration', 10)),
  width:    Number(arg('width', 1920)),
  height:   Number(arg('height', 1080)),
  crf:      String(arg('crf', 18)),
  preset:   String(arg('preset', 'slow')),
  out:      path.resolve(DIR, arg('out', 'banner.mp4')),
  chromium: arg('chromium', process.env.CHROMIUM || 'chromium'),
  stills:   arg('stills', null),
};

const log = (...a) => process.stderr.write(a.join(' ') + '\n');

/* -------------------------------------------------------------- server -- */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.webm': 'video/webm',
  '.mp4':  'video/mp4',
  '.png':  'image/png',
  '.js':   'text/javascript',
  '.css':  'text/css',
};

async function freePort() {
  const s = net.createServer();
  s.listen(0, '127.0.0.1');
  await once(s, 'listening');
  const { port } = s.address();
  await new Promise(r => s.close(r));
  return port;
}

async function serve() {
  const port = await freePort();
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'banner.html';
    const file = path.join(DIR, rel);
    // never serve outside banner/
    if (!file.startsWith(DIR)) { res.writeHead(403).end(); return; }
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) { res.writeHead(404).end('not found'); return; }
      const type = MIME[path.extname(file)] || 'application/octet-stream';

      // Range support is load-bearing, not a nicety. Without it Chromium marks
      // the media non-seekable (video.seekable is an empty range), silently
      // clamps every `currentTime = x` to 0, and still fires `seeked` -- so the
      // capture loop runs at full speed while every frame shows the clip's
      // first frame. The result is a video whose robots never move.
      const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
      if (range) {
        let start = range[1] === '' ? null : Number(range[1]);
        let end   = range[2] === '' ? null : Number(range[2]);
        if (start === null) {                       // suffix range: last N bytes
          start = Math.max(0, st.size - (end ?? 0));
          end = st.size - 1;
        } else if (end === null || end >= st.size) {
          end = st.size - 1;
        }
        if (start > end || start >= st.size) {
          res.writeHead(416, { 'content-range': `bytes */${st.size}` }).end();
          return;
        }
        res.writeHead(206, {
          'content-type': type,
          'content-length': end - start + 1,
          'content-range': `bytes ${start}-${end}/${st.size}`,
          'accept-ranges': 'bytes',
          'cache-control': 'no-store',
        });
        fs.createReadStream(file, { start, end }).pipe(res);
        return;
      }

      res.writeHead(200, {
        'content-type': type,
        'content-length': st.size,
        'accept-ranges': 'bytes',
        'cache-control': 'no-store',
      });
      fs.createReadStream(file).pipe(res);
    });
  });
  server.listen(port, '127.0.0.1');
  await once(server, 'listening');
  return { server, base: `http://127.0.0.1:${port}` };
}

/* ----------------------------------------------------------------- CDP -- */
class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  /** Evaluate an expression in the page, awaiting any promise it returns. */
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression, awaitPromise: true, returnByValue: true,
    });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    }
    return r.result.value;
  }
}

async function launchChromium(url) {
  const port = await freePort();
  const profile = await fsp.mkdtemp(path.join(os.tmpdir(), 'assistax-banner-'));
  const flags = [
    '--headless',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    `--window-size=${OPTS.width},${OPTS.height}`,
    '--force-device-scale-factor=1',
    '--hide-scrollbars',
    '--mute-audio',
    '--autoplay-policy=no-user-gesture-required',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-dev-shm-usage',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    ...(process.env.HF_NO_SANDBOX ? ['--no-sandbox'] : []),
    'about:blank',
  ];
  const proc = spawn(OPTS.chromium, flags, { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  proc.stderr.on('data', d => { stderr += d; });
  proc.on('exit', (code) => {
    if (code !== 0 && !proc.__expected) {
      log(`\nchromium exited (${code}). stderr:\n${stderr.slice(-2000)}`);
      if (/sandbox/i.test(stderr)) log('hint: retry with HF_NO_SANDBOX=1');
    }
  });

  // wait for the debugging endpoint
  let target;
  for (let i = 0; i < 100; i++) {
    try {
      const list = await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json());
      target = list.find(t => t.type === 'page');
      if (target) break;
    } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 100));
  }
  if (!target) { proc.kill(); throw new Error('chromium devtools endpoint never came up'); }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await once(ws, 'open');
  const cdp = new CDP(ws);

  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: OPTS.width, height: OPTS.height, deviceScaleFactor: 1, mobile: false,
  });

  await cdp.send('Page.navigate', { url });
  await once(ws, 'message'); // at minimum one event lands; real gate is __ready below

  const close = async () => {
    proc.__expected = true;
    try { ws.close(); } catch {}
    proc.kill();
    await fsp.rm(profile, { recursive: true, force: true }).catch(() => {});
  };
  return { cdp, close };
}

async function waitReady(cdp) {
  for (let i = 0; i < 300; i++) {
    try {
      const ok = await cdp.eval('(async()=>{ if(!window.__ready) return false; await window.__ready; return true; })()');
      if (ok) return;
    } catch { /* page still navigating */ }
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('page never signalled __ready (fonts/videos failed to load?)');
}

const shot = async (cdp) => Buffer.from(
  (await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false })).data,
  'base64',
);

/* ---------------------------------------------------------------- main -- */
const { server, base } = await serve();
const { cdp, close } = await launchChromium(`${base}/banner.html?capture=1`);
const done = async () => { await close(); server.close(); };

try {
  await waitReady(cdp);

  // Adopt the composition's own timing unless the caller overrode it. Keeping a
  // second copy of the duration here is how a 12s CFG got rendered as 10s.
  const cfg = JSON.parse(await cdp.eval('JSON.stringify({fps:CFG.fps,duration:CFG.duration})'));
  if (!given('fps'))      OPTS.fps = cfg.fps;
  if (!given('duration')) OPTS.duration = cfg.duration;

  if (OPTS.stills) {
    const dir = path.join(DIR, 'stills');
    await fsp.mkdir(dir, { recursive: true });
    for (const raw of OPTS.stills.split(',')) {
      const t = Number(raw.trim());
      await cdp.eval(`window.__seek(${t})`);
      const file = path.join(dir, `t${t.toFixed(2).replace('.', '_')}.png`);
      await fsp.writeFile(file, await shot(cdp));
      log(`still ${t.toFixed(2)}s -> ${path.relative(process.cwd(), file)}`);
    }
  } else {
    const frames = Math.round(OPTS.duration * OPTS.fps);
    log(`rendering ${frames} frames @ ${OPTS.fps}fps (${OPTS.duration}s)`);
    const ff = spawn('ffmpeg', [
      '-nostdin', '-y', '-loglevel', 'error',
      '-f', 'image2pipe', '-framerate', String(OPTS.fps), '-i', '-',
      '-an',                                   // explicitly no audio
      '-c:v', 'libx264', '-preset', OPTS.preset, '-crf', OPTS.crf,
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
      OPTS.out,
    ], { stdio: ['pipe', 'inherit', 'inherit'] });

    const t0 = Date.now();
    for (let n = 0; n < frames; n++) {
      await cdp.eval(`window.__seek(${(n / OPTS.fps).toFixed(6)})`);
      const png = await shot(cdp);
      if (!ff.stdin.write(png)) await once(ff.stdin, 'drain');
      if (n % 15 === 0 || n === frames - 1) {
        const pct = ((n + 1) / frames * 100).toFixed(0).padStart(3);
        const rate = (n + 1) / ((Date.now() - t0) / 1000);
        process.stderr.write(`\r  ${pct}%  frame ${n + 1}/${frames}  ${rate.toFixed(1)} fps  `);
      }
    }
    ff.stdin.end();
    const [code] = await once(ff, 'close');
    log('');
    if (code !== 0) throw new Error(`ffmpeg exited ${code}`);
    log(`wrote ${path.relative(process.cwd(), OPTS.out)}`);
  }
} finally {
  await done();
}
