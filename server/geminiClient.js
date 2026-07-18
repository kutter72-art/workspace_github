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
