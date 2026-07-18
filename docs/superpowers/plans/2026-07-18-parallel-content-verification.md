# 병렬 콘텐츠 검증 (Gemini + GPT) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "내용 검증" (content verification) feature that sends generated PPTX slide text to a local Node.js/Express proxy server, which calls Gemini 2.5 Flash and GPT-4o mini in parallel, and displays both models' findings side-by-side in the browser.

**Architecture:** A new `server/` Express app exposes `POST /verify`. It calls two provider-specific client modules (`geminiClient.js`, `gptClient.js`) via `Promise.allSettled` so one failing provider doesn't block the other. Both clients share a `promptBuilder.js` module for prompt construction and JSON-response parsing. The browser side adds a single new file, `verify-client.js`, containing `extractPlainText()`, `verifyContent()`, and `renderVerifyResults()`, loaded via `<script src="verify-client.js">` from the actual host file `주간보고서_작성기.html` (which does not load `pptx_code.js` via `<script src>` — it inlines an equivalent copy of that logic itself). `pptx_code.js` is not modified by this feature — it is the core OOXML-generation reference file and has no dependency on this UI feature.

**Tech Stack:** Node.js (18+, for built-in `fetch` and `node:test`), Express, cors, dotenv. No new browser dependencies — plain JS, reuses existing `htmlParas()`/`xmlEsc()`.

## Global Constraints

- API keys (`GEMINI_API_KEY`, `OPENAI_API_KEY`) live only in `server/.env`, never in browser code or committed files.
- Gemini model: `gemini-2.5-flash`. GPT model: `gpt-4o-mini`. (Spec: [2026-07-18-parallel-content-verification-design.md](../specs/2026-07-18-parallel-content-verification-design.md))
- Verification targets the **final generated slide text** (post-`htmlParas()` extraction), not raw HTML input.
- One provider failing must not block the other's results (`Promise.allSettled`).
- Server runs locally only: `http://localhost:3001` (configurable via `PORT` env var).
- No automated test framework exists for the browser-side code in this repo — client-side tasks are verified manually in-browser, per project convention.

---

### Task 1: Server scaffold + shared prompt builder

**Files:**
- Create: `server/package.json`
- Create: `server/.env.example`
- Create: `server/.gitignore`
- Create: `server/promptBuilder.js`
- Test: `server/promptBuilder.test.js`

**Interfaces:**
- Produces: `buildVerifyPrompt(slides: {month, week, team, leftText, rightText}[]): string`, `extractJsonArray(text: string): string`, `parseSlideResults(text: string): { slideResults: {slideIndex: number, issues: {type: string, description: string}[]}[] }`

- [ ] **Step 1: Create the server directory and package.json**

```json
{
  "name": "weekly-report-verify-server",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "start": "node index.js",
    "test": "node --test"
  },
  "dependencies": {
    "cors": "^2.8.5",
    "dotenv": "^16.4.5",
    "express": "^4.19.2"
  }
}
```

Save as `server/package.json`.

- [ ] **Step 2: Create `.env.example` and `.gitignore`**

`server/.env.example`:
```
GEMINI_API_KEY=
OPENAI_API_KEY=
PORT=3001
```

`server/.gitignore`:
```
node_modules/
.env
```

- [ ] **Step 3: Install dependencies**

Run: `cd server && npm install`
Expected: `node_modules/` created, no errors.

- [ ] **Step 4: Write the failing tests for the prompt builder**

Create `server/promptBuilder.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { buildVerifyPrompt, extractJsonArray, parseSlideResults } = require('./promptBuilder');

test('buildVerifyPrompt includes month/week/team and content for each slide', () => {
  const prompt = buildVerifyPrompt([
    { month: 7, week: 3, team: '공정관리팀', leftText: '실적 내용', rightText: '계획 내용' }
  ]);
  assert.ok(prompt.includes('월: 7'));
  assert.ok(prompt.includes('주차: 3'));
  assert.ok(prompt.includes('팀명: 공정관리팀'));
  assert.ok(prompt.includes('실적 내용'));
  assert.ok(prompt.includes('계획 내용'));
});

test('extractJsonArray pulls the JSON array out of surrounding text', () => {
  const text = '여기 결과입니다:\n[{"slideIndex":0,"issues":[]}]\n감사합니다.';
  assert.strictEqual(extractJsonArray(text), '[{"slideIndex":0,"issues":[]}]');
});

test('parseSlideResults returns parsed array on valid JSON', () => {
  const result = parseSlideResults('[{"slideIndex":0,"issues":[{"type":"typo","description":"x"}]}]');
  assert.deepStrictEqual(result, {
    slideResults: [{ slideIndex: 0, issues: [{ type: 'typo', description: 'x' }] }]
  });
});

test('parseSlideResults falls back to raw text on invalid JSON', () => {
  const result = parseSlideResults('이건 JSON이 아님');
  assert.strictEqual(result.slideResults[0].issues[0].type, 'raw');
  assert.strictEqual(result.slideResults[0].issues[0].description, '이건 JSON이 아님');
});
```

- [ ] **Step 5: Run tests to verify they fail**

Run: `cd server && npm test`
Expected: FAIL — `Cannot find module './promptBuilder'`

- [ ] **Step 6: Implement `promptBuilder.js`**

Create `server/promptBuilder.js`:

```js
function buildVerifyPrompt(slides) {
  const slideBlocks = slides.map(function (s, i) {
    return '슬라이드 ' + i + ' (월: ' + s.month + ', 주차: ' + s.week + ', 팀명: ' + s.team + ')\n'
      + '[금주 실적]\n' + s.leftText + '\n'
      + '[차주계획]\n' + s.rightText;
  }).join('\n\n');

  return '다음은 주간보고 슬라이드 내용입니다. 각 슬라이드에서 아래 세 가지 문제를 찾아 지적해주세요:\n'
    + '1. 오탈자/문법 오류\n'
    + '2. 내용 누락/불일치\n'
    + '3. 형식/구조 일관성 (월, 주차, 팀명 등 필수 항목 누락 여부)\n\n'
    + slideBlocks
    + '\n\n반드시 아래 JSON 형식으로만 응답하세요 (다른 텍스트 없이):\n'
    + '[{"slideIndex": 0, "issues": [{"type": "typo", "description": "..."}]}]';
}

function extractJsonArray(text) {
  const match = text.match(/\[[\s\S]*\]/);
  return match ? match[0] : text;
}

function parseSlideResults(text) {
  try {
    return { slideResults: JSON.parse(extractJsonArray(text)) };
  } catch (e) {
    return { slideResults: [{ slideIndex: -1, issues: [{ type: 'raw', description: text }] }] };
  }
}

module.exports = { buildVerifyPrompt, extractJsonArray, parseSlideResults };
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd server && npm test`
Expected: PASS — 4 tests passing.

- [ ] **Step 8: Commit**

```bash
git add server/package.json server/.env.example server/.gitignore server/promptBuilder.js server/promptBuilder.test.js
git commit -m "feat: add verify-server scaffold and shared prompt builder"
```

---

### Task 2: Gemini client module

**Files:**
- Create: `server/geminiClient.js`
- Test: `server/geminiClient.test.js`

**Interfaces:**
- Consumes: `buildVerifyPrompt`, `parseSlideResults` from `./promptBuilder` (Task 1)
- Produces: `callGemini(slides, apiKey, fetchImpl?): Promise<{ slideResults: [...] } | { error: string }>`

- [ ] **Step 1: Write the failing tests**

Create `server/geminiClient.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { callGemini } = require('./geminiClient');

test('callGemini returns an error when no API key is provided', async () => {
  const result = await callGemini([{ month: 7, week: 3, team: '팀', leftText: 'a', rightText: 'b' }], '');
  assert.deepStrictEqual(result, { error: 'API 키가 설정되지 않았습니다' });
});

test('callGemini parses slideResults from a successful response', async () => {
  const fakeFetch = async () => ({
    ok: true,
    json: async () => ({
      candidates: [{ content: { parts: [{ text: '[{"slideIndex":0,"issues":[]}]' }] } }]
    })
  });
  const result = await callGemini(
    [{ month: 7, week: 3, team: '팀', leftText: 'a', rightText: 'b' }],
    'fake-key',
    fakeFetch
  );
  assert.deepStrictEqual(result, { slideResults: [{ slideIndex: 0, issues: [] }] });
});

test('callGemini returns an error when the API responds with a non-OK status', async () => {
  const fakeFetch = async () => ({ ok: false, status: 429, text: async () => 'rate limited' });
  const result = await callGemini(
    [{ month: 7, week: 3, team: '팀', leftText: 'a', rightText: 'b' }],
    'fake-key',
    fakeFetch
  );
  assert.strictEqual(result.error, 'Gemini API 오류 (429): rate limited');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && npm test`
Expected: FAIL — `Cannot find module './geminiClient'`

- [ ] **Step 3: Implement `geminiClient.js`**

Create `server/geminiClient.js`:

```js
const { buildVerifyPrompt, parseSlideResults } = require('./promptBuilder');

const GEMINI_MODEL = 'gemini-2.5-flash';

async function callGemini(slides, apiKey, fetchImpl) {
  const doFetch = fetchImpl || fetch;
  if (!apiKey) return { error: 'API 키가 설정되지 않았습니다' };

  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + GEMINI_MODEL
    + ':generateContent?key=' + apiKey;
  const res = await doFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: buildVerifyPrompt(slides) }] }] })
  });
  if (!res.ok) {
    const body = await res.text();
    return { error: 'Gemini API 오류 (' + res.status + '): ' + body };
  }
  const data = await res.json();
  const text = data.candidates && data.candidates[0] && data.candidates[0].content
    && data.candidates[0].content.parts && data.candidates[0].content.parts[0]
    && data.candidates[0].content.parts[0].text;
  if (!text) return { error: 'Gemini 응답에 텍스트가 없습니다' };
  return parseSlideResults(text);
}

module.exports = { callGemini, GEMINI_MODEL };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && npm test`
Expected: PASS — 7 tests passing total (4 from Task 1 + 3 new).

- [ ] **Step 5: Commit**

```bash
git add server/geminiClient.js server/geminiClient.test.js
git commit -m "feat: add Gemini client for content verification"
```

---

### Task 3: GPT client module

**Files:**
- Create: `server/gptClient.js`
- Test: `server/gptClient.test.js`

**Interfaces:**
- Consumes: `buildVerifyPrompt`, `parseSlideResults` from `./promptBuilder` (Task 1)
- Produces: `callGpt(slides, apiKey, fetchImpl?): Promise<{ slideResults: [...] } | { error: string }>`

- [ ] **Step 1: Write the failing tests**

Create `server/gptClient.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { callGpt } = require('./gptClient');

test('callGpt returns an error when no API key is provided', async () => {
  const result = await callGpt([{ month: 7, week: 3, team: '팀', leftText: 'a', rightText: 'b' }], '');
  assert.deepStrictEqual(result, { error: 'API 키가 설정되지 않았습니다' });
});

test('callGpt parses slideResults from a successful response', async () => {
  const fakeFetch = async () => ({
    ok: true,
    json: async () => ({
      choices: [{ message: { content: '[{"slideIndex":0,"issues":[]}]' } }]
    })
  });
  const result = await callGpt(
    [{ month: 7, week: 3, team: '팀', leftText: 'a', rightText: 'b' }],
    'fake-key',
    fakeFetch
  );
  assert.deepStrictEqual(result, { slideResults: [{ slideIndex: 0, issues: [] }] });
});

test('callGpt returns an error when the API responds with a non-OK status', async () => {
  const fakeFetch = async () => ({ ok: false, status: 401, text: async () => 'invalid key' });
  const result = await callGpt(
    [{ month: 7, week: 3, team: '팀', leftText: 'a', rightText: 'b' }],
    'fake-key',
    fakeFetch
  );
  assert.strictEqual(result.error, 'GPT API 오류 (401): invalid key');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && npm test`
Expected: FAIL — `Cannot find module './gptClient'`

- [ ] **Step 3: Implement `gptClient.js`**

Create `server/gptClient.js`:

```js
const { buildVerifyPrompt, parseSlideResults } = require('./promptBuilder');

const GPT_MODEL = 'gpt-4o-mini';

async function callGpt(slides, apiKey, fetchImpl) {
  const doFetch = fetchImpl || fetch;
  if (!apiKey) return { error: 'API 키가 설정되지 않았습니다' };

  const res = await doFetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + apiKey
    },
    body: JSON.stringify({
      model: GPT_MODEL,
      messages: [{ role: 'user', content: buildVerifyPrompt(slides) }]
    })
  });
  if (!res.ok) {
    const body = await res.text();
    return { error: 'GPT API 오류 (' + res.status + '): ' + body };
  }
  const data = await res.json();
  const text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!text) return { error: 'GPT 응답에 텍스트가 없습니다' };
  return parseSlideResults(text);
}

module.exports = { callGpt, GPT_MODEL };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && npm test`
Expected: PASS — 10 tests passing total.

- [ ] **Step 5: Commit**

```bash
git add server/gptClient.js server/gptClient.test.js
git commit -m "feat: add GPT client for content verification"
```

---

### Task 4: `/verify` route wiring

**Files:**
- Create: `server/index.js`
- Test: `server/index.test.js`

**Interfaces:**
- Consumes: `callGemini` from `./geminiClient` (Task 2), `callGpt` from `./gptClient` (Task 3)
- Produces: `createApp(): express.Express` — an Express app with `POST /verify` wired. When run directly (`node index.js`), listens on `process.env.PORT || 3001`.
- Response shape: `{ gemini: {slideResults:[...]} | {error}, gpt: {slideResults:[...]} | {error} }`

- [ ] **Step 1: Write the failing tests**

Create `server/index.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { createApp } = require('./index');

function withServer(app, fn) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, async () => {
      const port = server.address().port;
      try {
        await fn('http://localhost:' + port);
        resolve();
      } catch (e) {
        reject(e);
      } finally {
        server.close();
      }
    });
  });
}

test('POST /verify returns 400 when slides is missing or empty', async () => {
  const app = createApp();
  await withServer(app, async (base) => {
    const res = await fetch(base + '/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    assert.strictEqual(res.status, 400);
  });
});

test('POST /verify returns gemini and gpt error keys when no API keys are set', async () => {
  delete process.env.GEMINI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  const app = createApp();
  await withServer(app, async (base) => {
    const res = await fetch(base + '/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slides: [{ month: 7, week: 3, team: '팀', leftText: 'a', rightText: 'b' }]
      })
    });
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(data.gemini, { error: 'API 키가 설정되지 않았습니다' });
    assert.deepStrictEqual(data.gpt, { error: 'API 키가 설정되지 않았습니다' });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && npm test`
Expected: FAIL — `Cannot find module './index'`

- [ ] **Step 3: Implement `index.js`**

Create `server/index.js`:

```js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { callGemini } = require('./geminiClient');
const { callGpt } = require('./gptClient');

function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '2mb' }));

  app.post('/verify', async function (req, res) {
    const slides = req.body && req.body.slides;
    if (!Array.isArray(slides) || slides.length === 0) {
      return res.status(400).json({ error: 'slides 배열이 비어 있습니다' });
    }

    const [geminiResult, gptResult] = await Promise.allSettled([
      callGemini(slides, process.env.GEMINI_API_KEY),
      callGpt(slides, process.env.OPENAI_API_KEY)
    ]);

    res.json({
      gemini: geminiResult.status === 'fulfilled' ? geminiResult.value : { error: geminiResult.reason.message },
      gpt: gptResult.status === 'fulfilled' ? gptResult.value : { error: gptResult.reason.message }
    });
  });

  return app;
}

if (require.main === module) {
  const app = createApp();
  const port = process.env.PORT || 3001;
  app.listen(port, function () {
    console.log('검증 서버 실행 중: http://localhost:' + port);
    if (!process.env.GEMINI_API_KEY) console.warn('경고: GEMINI_API_KEY가 설정되지 않았습니다');
    if (!process.env.OPENAI_API_KEY) console.warn('경고: OPENAI_API_KEY가 설정되지 않았습니다');
  });
}

module.exports = { createApp };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && npm test`
Expected: PASS — 12 tests passing total.

- [ ] **Step 5: Manually verify the server boots**

Run: `cd server && cp .env.example .env && npm start`
Expected console output: `검증 서버 실행 중: http://localhost:3001` plus two warnings about missing API keys (since `.env` is still blank). Stop with Ctrl+C.

- [ ] **Step 6: Commit**

```bash
git add server/index.js server/index.test.js
git commit -m "feat: wire POST /verify route calling Gemini and GPT in parallel"
```

---

### Task 5: Shared browser verification module (`verify-client.js`)

**Files:**
- Create: `verify-client.js`

**Interfaces:**
- Consumes (all provided by whatever host page loads this file via `<script src="verify-client.js">`, loaded *after* the host's own script that defines them): `htmlParas(html)` (returns `{type, text}[]`), `xmlEsc(s)`, global `slides` array (`{id, month, week, team, leftHtml, rightHtml}[]`), `setStatus(msg)`, `sanitizeHtml(html)`
- Produces: `extractPlainText(html): string`, `async function verifyContent(): Promise<void>`, `renderVerifyResults(data): void` — for use by the host HTML's `btnVerify` button (Task 6)

This is a **new standalone file**, not an addition to `pptx_code.js`. The actual host page (`주간보고서_작성기.html`, wired in Task 6) does not load `pptx_code.js` via `<script src>` — it inlines an equivalent copy of `htmlParas`/`buildSlideXml`/`savePptx` itself. Putting the verify feature in its own file and loading it once via `<script src>` avoids duplicating this new code into two places. `pptx_code.js` is not touched by this task.

- [ ] **Step 1: Create `verify-client.js`**

```js
const VERIFY_SERVER_URL = 'http://localhost:3001/verify';

function extractPlainText(html) {
  return htmlParas(html)
    .filter(function(p) { return p.type !== 'empty'; })
    .map(function(p) { return p.text; })
    .join('\n');
}

async function verifyContent() {
  if (!slides.length) { setStatus('검증할 슬라이드가 없습니다.'); return; }

  slides.forEach(function(s) {
    const l = document.getElementById('left_' + s.id);
    const r = document.getElementById('right_' + s.id);
    if (l) s.leftHtml = sanitizeHtml(l.innerHTML);
    if (r) s.rightHtml = sanitizeHtml(r.innerHTML);
  });

  const btn = document.getElementById('btnVerify');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ 검증 중...'; }
  setStatus('내용 검증 중...');
  try {
    const payload = {
      slides: slides.map(function(s) {
        return {
          month: s.month, week: s.week, team: s.team,
          leftText: extractPlainText(s.leftHtml),
          rightText: extractPlainText(s.rightHtml)
        };
      })
    };
    const res = await fetch(VERIFY_SERVER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error('서버 응답 오류: ' + res.status);
    const data = await res.json();
    renderVerifyResults(data);
    setStatus('내용 검증 완료');
  } catch (e) {
    console.error(e);
    setStatus('검증 서버(localhost:3001)에 연결할 수 없습니다. server 폴더에서 서버를 먼저 실행하세요.');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🔍 내용 검증'; }
  }
}

function renderVerifyColumn(result) {
  if (result.error) {
    return '<div style="color:#b00;padding:8px;">' + xmlEsc(result.error) + '</div>';
  }
  return (result.slideResults || []).map(function(sr) {
    const issuesHtml = (sr.issues || []).map(function(iss) {
      return '<li><b>[' + xmlEsc(iss.type) + ']</b> ' + xmlEsc(iss.description) + '</li>';
    }).join('');
    return '<div style="margin-bottom:12px;">'
      + '<div style="font-weight:bold;">슬라이드 ' + (sr.slideIndex + 1) + '</div>'
      + (issuesHtml ? '<ul>' + issuesHtml + '</ul>' : '<div style="color:#666;">문제 없음</div>')
      + '</div>';
  }).join('');
}

function renderVerifyResults(data) {
  let panel = document.getElementById('verifyPanel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'verifyPanel';
    panel.style.cssText = 'position:fixed;top:5%;left:5%;width:90%;height:85%;background:#fff;'
      + 'border:1px solid #999;box-shadow:0 4px 20px rgba(0,0,0,0.3);z-index:9999;'
      + 'overflow:auto;padding:16px;font-family:"맑은 고딕",sans-serif;';
    document.body.appendChild(panel);
  }
  panel.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">'
    + '<h2 style="margin:0;">내용 검증 결과</h2>'
    + '<button onclick="document.getElementById(\'verifyPanel\').remove()">닫기</button>'
    + '</div>'
    + '<div style="display:flex;gap:16px;">'
    + '<div style="flex:1;border-right:1px solid #ddd;padding-right:16px;"><h3>Gemini</h3>' + renderVerifyColumn(data.gemini) + '</div>'
    + '<div style="flex:1;"><h3>GPT</h3>' + renderVerifyColumn(data.gpt) + '</div>'
    + '</div>';
}
```

- [ ] **Step 2: Commit**

```bash
git add verify-client.js
git commit -m "feat: add shared verify-client.js for content verification"
```

(No automated test here — this file only runs inside a browser DOM with host-provided globals; manual browser verification happens in Task 6 where it's wired to a real button.)

---

### Task 6: Wire the feature into the host page (`주간보고서_작성기.html`)

**Files:**
- Modify: `주간보고서_작성기.html` (toolbar around line 388, first `<script>` block ends at line 375, main script starts at line 413, ends at line 1355)

**Interfaces:**
- Consumes: `verify-client.js` (Task 5) via `<script src="verify-client.js"></script>`
- Existing globals this file already defines that `verify-client.js` depends on: `htmlParas` (`:1031`), `xmlEsc`, `slides`, `setStatus`, `sanitizeHtml` (`:995`)

- [ ] **Step 1: Add the "내용 검증" button to the toolbar**

In `주간보고서_작성기.html`, find the toolbar block:

```html
  <button class="tb-btn primary" onclick="savePptx()" id="btnPptx">💾 PPTX 저장</button>
  <div class="tb-sep"></div>
  <button class="tb-btn danger" onclick="confirmClearAll()">🗑 전체 초기화</button>
```

Replace with:

```html
  <button class="tb-btn primary" onclick="savePptx()" id="btnPptx">💾 PPTX 저장</button>
  <button class="tb-btn" onclick="verifyContent()" id="btnVerify">🔍 내용 검증</button>
  <div class="tb-sep"></div>
  <button class="tb-btn danger" onclick="confirmClearAll()">🗑 전체 초기화</button>
```

- [ ] **Step 2: Load `verify-client.js` after the main inline script**

Find the end of the file:

```html
</script>
</body>
```

Replace with:

```html
</script>
<script src="verify-client.js"></script>
</body>
```

This must come after the closing `</script>` of the main inline script (line 1355), not inside it — `verify-client.js` calls `htmlParas`, `xmlEsc`, `slides`, `setStatus`, `sanitizeHtml`, which must already exist as globals by the time it loads (they do, since it's a `<script>` tag placed after them, and browsers run same-page scripts in document order).

- [ ] **Step 3: Manually verify end-to-end in the browser**

1. Run: `cd server && npm start` (with real or dummy keys in `server/.env`)
2. Open `주간보고서_작성기.html` directly in a browser (double-click or `file://` URL) — confirm no console errors on load (verifies `verify-client.js` loaded and found its dependencies)
3. Click "+ 페이지 추가", fill in some 금주 실적/차주계획 text
4. Click "🔍 내용 검증"
5. Expected: status shows "내용 검증 중..." then "내용 검증 완료", and a panel appears with "Gemini" and "GPT" columns side-by-side showing findings (or "문제 없음" if none)

- [ ] **Step 4: Manually verify error handling**

1. Stop the server (Ctrl+C)
2. Click "🔍 내용 검증" again
3. Expected: status bar shows "검증 서버(localhost:3001)에 연결할 수 없습니다. server 폴더에서 서버를 먼저 실행하세요." and no panel/crash

- [ ] **Step 5: Commit**

```bash
git add "주간보고서_작성기.html"
git commit -m "feat: wire content verification button into the report editor page"
```

---

## Self-Review Notes

- **Spec coverage:** All spec sections map to tasks — architecture (Tasks 1-4), server component (Tasks 1-4), client component (Tasks 5-6), error handling (Task 4 status-code path, Task 6 Step 4 manual check), testing (automated for server in Tasks 1-4, manual for client in Task 6).
- **Type/name consistency:** `slides` payload shape (`{month, week, team, leftText, rightText}`) is identical across `promptBuilder.js`, `geminiClient.js`, `gptClient.js`, `index.js`, and the client-side call site in `verify-client.js`. Response shape (`{gemini, gpt}` each `{slideResults} | {error}`) is consistent from `index.js` through to `renderVerifyColumn`.
- **No duplication:** the verify feature's browser code exists in exactly one file (`verify-client.js`), loaded by reference from the host page rather than copy-pasted, avoiding the duplication an earlier draft of this plan had between `pptx_code.js` and the host HTML.
- **Out of scope carried over from spec:** no serverless deployment, no pre-generation HTML verification, no automatic merge of duplicate issues across models. `pptx_code.js` is intentionally left unmodified by this feature.
