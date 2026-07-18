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

test('callGpt returns an error instead of throwing when fetch itself rejects', async () => {
  const fakeFetch = async () => { throw new Error('network down'); };
  const result = await callGpt(
    [{ month: 7, week: 3, team: '팀', leftText: 'a', rightText: 'b' }],
    'fake-key',
    fakeFetch
  );
  assert.strictEqual(result.error, 'GPT 호출 실패: network down');
});
