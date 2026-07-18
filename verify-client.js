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
