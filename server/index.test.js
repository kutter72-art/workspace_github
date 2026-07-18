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
