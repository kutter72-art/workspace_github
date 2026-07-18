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
