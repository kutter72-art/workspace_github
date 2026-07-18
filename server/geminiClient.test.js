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

test('callGemini returns an error instead of throwing when fetch itself rejects', async () => {
  const fakeFetch = async () => { throw new Error('network down'); };
  const result = await callGemini(
    [{ month: 7, week: 3, team: '팀', leftText: 'a', rightText: 'b' }],
    'fake-key',
    fakeFetch
  );
  assert.strictEqual(result.error, 'Gemini 호출 실패: network down');
});
