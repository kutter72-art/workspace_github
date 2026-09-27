// 무의존성 HTTP 서버.
// 진단서 F-04 해결: iframe 없이 실제 경로(/lunch, /talk/:id ...)를 서버가 직접 응답하고,
// 개별 글에는 공유 카드(OG 메타)를 서버에서 주입한다.

import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, extname } from 'node:path';

import { Store, defaultDbPath } from './lib/store.js';
import { createApi, ApiError } from './lib/api.js';
import { canView } from './lib/identity.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(ROOT, 'public');

const PAGE_ROUTES = ['/', '/lunch', '/talk', '/break', '/grow', '/me'];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function readBody(req, maxBytes = 256 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > maxBytes) {
        reject(new ApiError(413, '내용이 너무 깁니다.'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new ApiError(400, '요청 본문이 올바른 JSON이 아닙니다.'));
      }
    });
    req.on('error', reject);
  });
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

// 경로 패턴 매칭: 'GET /api/posts/:id' → { id: '...' }
function matchRoute(routes, method, pathname) {
  const direct = `${method} ${pathname}`;
  if (routes[direct]) return { handler: routes[direct], params: {} };
  for (const key of Object.keys(routes)) {
    const [m, pattern] = key.split(' ');
    if (m !== method || !pattern.includes(':')) continue;
    const pp = pattern.split('/');
    const ap = pathname.split('/');
    if (pp.length !== ap.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < pp.length; i += 1) {
      if (pp[i].startsWith(':')) params[pp[i].slice(1)] = decodeURIComponent(ap[i]);
      else if (pp[i] !== ap[i]) { ok = false; break; }
    }
    if (ok) return { handler: routes[key], params };
  }
  return null;
}

export function createApp({ dbPath } = {}) {
  // 저장소는 완전히 빈 상태로 시작한다.
  // 지역·메뉴·문제·책 목록은 코드(catalog.js)에 있는 설정이고,
  // 글·표·점수·진도·계정은 실제 사용으로만 생긴다.
  const store = new Store(dbPath || defaultDbPath(ROOT));
  const api = createApi(store);

  const shellPath = join(PUBLIC, 'index.html');

  function renderShell(pathname, viewer) {
    let html = readFileSync(shellPath, 'utf8');
    let title = '오늘의 직장인';
    let desc = '점심으로 만나서, 고민을 나누고, 한숨 돌리고, 같이 조금 자라는 곳.';

    const m = pathname.match(/^\/talk\/([^/]+)$/);
    if (m) {
      const post = store.findPost(m[1]);
      if (post && canView(post, viewer) && post.visibility === 'public') {
        title = `${post.title} · 오늘의 직장인`;
        desc = String(post.body).replace(/\s+/g, ' ').slice(0, 120);
      } else if (post) {
        title = '공개되지 않은 글 · 오늘의 직장인';
        desc = '이 글은 공개 범위가 제한돼 있습니다.';
      }
    } else {
      const named = {
        '/lunch': ['점심 · 오늘의 직장인', '우리 동네 직장인들이 오늘 뭘 먹는지 보고, 한 표 보태세요.'],
        '/talk': ['토크 · 오늘의 직장인', '회사 이야기, 익명으로도 아이디로도.'],
        '/break': ['숨돌리기 · 오늘의 직장인', '1분만 딴생각하고 돌아오기.'],
        '/grow': ['성장 · 오늘의 직장인', '혼자 하면 3일, 같이 하면 30일.'],
        '/me': ['내 서랍 · 오늘의 직장인', '내가 쓴 글과 계정 설정.'],
      }[pathname];
      if (named) [title, desc] = named;
    }

    return html
      .replaceAll('{{TITLE}}', escapeHtml(title))
      .replaceAll('{{DESC}}', escapeHtml(desc))
      .replaceAll('{{PATH}}', escapeHtml(pathname));
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = decodeURIComponent(url.pathname);

    // 세션 확보 (없으면 손님 세션 발급)
    const cookies = parseCookies(req.headers.cookie);
    const session = api.ensureSession(cookies.sid);
    const setCookie = cookies.sid !== session.token
      ? [`sid=${session.token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`]
      : [];

    const send = (status, payload, type = 'application/json; charset=utf-8', extraHeaders = {}) => {
      // 클라이언트가 이미 끊었으면 조용히 넘어간다.
      // (탭을 새로고침하거나 이동하면 응답 도중 소켓이 닫힌다)
      if (res.writableEnded || res.destroyed || res.headersSent) return;
      const headers = { 'Content-Type': type, 'Cache-Control': 'no-store', ...extraHeaders };
      if (setCookie.length) headers['Set-Cookie'] = setCookie;
      try {
        res.writeHead(status, headers);
        res.end(typeof payload === 'string' || Buffer.isBuffer(payload) ? payload : JSON.stringify(payload));
      } catch { /* 이미 닫힌 소켓 */ }
    };

    req.on('aborted', () => { /* 중단은 정상적인 상황으로 취급 */ });
    res.on('error', () => { /* 끊긴 소켓에 쓰다 난 오류는 무시 */ });

    try {
      // ── API ──
      if (pathname.startsWith('/api/')) {
        const matched = matchRoute(api.routes, req.method, pathname);
        if (!matched) return send(404, { error: '없는 API 경로입니다.' });
        const body = req.method === 'GET' ? {} : await readBody(req);
        const result = await matched.handler({
          session, body, params: matched.params, query: url.searchParams, req,
        });
        return send(200, result);
      }

      // ── 정적 파일 ──
      if (pathname.startsWith('/assets/')) {
        const rel = normalize(pathname.replace('/assets/', '')).replace(/^(\.\.[/\\])+/, '');
        const file = join(PUBLIC, rel);
        if (!file.startsWith(PUBLIC) || !existsSync(file) || !statSync(file).isFile()) {
          return send(404, 'Not found', 'text/plain; charset=utf-8');
        }
        return send(200, readFileSync(file), MIME[extname(file)] || 'application/octet-stream');
      }

      // ── 페이지 (실제 경로 · iframe 없음) ──
      if (PAGE_ROUTES.includes(pathname) || /^\/talk\/[^/]+$/.test(pathname)) {
        const viewer = api.viewerOf(session);
        return send(200, renderShell(pathname, viewer), 'text/html; charset=utf-8');
      }

      return send(404, renderShell('/', api.viewerOf(session)), 'text/html; charset=utf-8');
    } catch (err) {
      if (err instanceof ApiError) return send(err.status, { error: err.message });
      // 예기치 못한 오류도 서버를 죽이지 않는다.
      process.stderr.write(`[error] ${pathname} :: ${err && err.stack ? err.stack : err}\n`);
      return send(500, { error: '서버에서 문제가 발생했습니다.' });
    }
  });

  return { server, store, api };
}

// 직접 실행될 때만 리스닝
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === normalize(process.argv[1]);
if (isMain) {
  const port = Number(process.env.PORT) || 4173;
  const { server } = createApp();

  // 요청 하나가 서버 전체를 내리지 못하게 한다.
  server.on('clientError', (err, socket) => {
    if (!socket.destroyed) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  });
  process.on('uncaughtException', (err) => {
    process.stderr.write(`[uncaught] ${err && err.stack ? err.stack : err}\n`);
  });
  process.on('unhandledRejection', (err) => {
    process.stderr.write(`[unhandled] ${err && err.stack ? err.stack : err}\n`);
  });

  server.listen(port, '127.0.0.1', () => {
    process.stdout.write(`오늘의 직장인 — http://127.0.0.1:${port}\n`);
  });
}
