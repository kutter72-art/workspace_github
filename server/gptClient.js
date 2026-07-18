const { buildVerifyPrompt, parseSlideResults } = require('./promptBuilder');

const GPT_MODEL = 'gpt-4o-mini';

async function callGpt(slides, apiKey, fetchImpl) {
  const doFetch = fetchImpl || fetch;
  if (!apiKey) return { error: 'API 키가 설정되지 않았습니다' };

  try {
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
  } catch (e) {
    return { error: 'GPT 호출 실패: ' + e.message };
  }
}

module.exports = { callGpt, GPT_MODEL };
