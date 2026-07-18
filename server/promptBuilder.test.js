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
