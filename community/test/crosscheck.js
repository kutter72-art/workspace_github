// 검증 방법③ — 저장 파일 직접 대조
//
// 방법①(자동화 테스트)·방법②(브라우저 조작)와 독립적으로 확인한다.
// 자체 서버 인스턴스를 임시 저장소에 띄우고, 알려진 데이터를 직접 넣은 뒤
// ① API 응답 ② db.json 원시 레코드 ③ 이 파일 안에서의 재계산
// 세 값을 맞춰 본다. 집계 코드(tallyLunch)는 재사용하지 않는다.
//
// 실제 사이트의 데이터는 건드리지 않는다.
//
//   실행: node test/crosscheck.js

import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { createApp } from '../server.js';
import { QUIZ, BOOKS } from '../lib/catalog.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const rows = [];
let failed = 0;

function check(item, m1, m2, m3, { tolerance = 0 } = {}) {
  const vals = [m1, m2, m3];
  let ok;
  if (vals.every((v) => typeof v === 'number')) {
    ok = tolerance === 0
      ? Math.max(...vals) === Math.min(...vals)
      : (Math.max(...vals) - Math.min(...vals)) <= tolerance;
  } else {
    ok = String(m1) === String(m2) && String(m2) === String(m3);
  }
  if (!ok) failed += 1;
  rows.push({ item, m1, m2, m3, ok });
}

const main = async () => {
  const dir = mkdtempSync(join(tmpdir(), 'community-crosscheck-'));
  const dbPath = join(dir, 'db.json');
  const app = createApp({ dbPath });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const BASE = `http://127.0.0.1:${app.server.address().port}`;
  const db = () => JSON.parse(readFileSync(dbPath, 'utf8'));

  const req = async (method, path, body, cookie) => {
    const res = await fetch(BASE + path, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const sc = (res.headers.getSetCookie?.() || [])[0];
    return { status: res.status, data: await res.json().catch(() => null), cookie: sc ? sc.split(';')[0] : cookie };
  };
  const newSession = async () => (await req('GET', '/api/bootstrap')).cookie;

  // ── 0. 시작 상태가 비어 있는가 ─────────────────────────
  {
    const c = await newSession();
    const posts = (await req('GET', '/api/posts', null, c)).data;
    const lunch = (await req('GET', '/api/lunch', null, c)).data;
    const raw = db();
    check('시작 시 글 수', posts.total, raw.posts.length, 0);
    check('시작 시 점심 표 수', lunch.total, raw.lunchVotes.length, 0);
    check('시작 시 계정 수', raw.users.length, 0, 0);
    check('시작 시 성장 기록',
      raw.goals.length + raw.goalDays.length + raw.quizAttempts.length + raw.reading.length, 0, 0);
    const grow = (await req('GET', '/api/grow', null, c)).data;
    check('시작 시 자격증 최고점', grow.quiz.best, 0, 0);
    check('시작 시 기록 중인 책', grow.trackedBooks, 0, 0);
  }

  // ── 1. 알려진 표를 넣고 집계를 대조 ────────────────────
  const PLAN = {
    yeoksam: ['제육볶음', '제육볶음', '제육볶음', '돈까스', '돈까스', '포케'],
    yeouido: ['물냉면', '물냉면', '김밥'],
    guro: ['짬뽕'],
  };
  for (const [region, menus] of Object.entries(PLAN)) {
    for (const menu of menus) {
      const c = await newSession();
      const r = await req('POST', '/api/lunch/vote', { region, menu }, c);
      if (r.status !== 200) throw new Error(`투표 실패 ${region}/${menu}: ${JSON.stringify(r.data)}`);
    }
  }

  for (const [region, menus] of Object.entries(PLAN)) {
    const c = await newSession();
    const apiRes = (await req('GET', `/api/lunch?region=${region}`, null, c)).data;

    // 방법②: 저장 파일을 for 루프로 직접 센다
    let fileCount = 0;
    for (const v of db().lunchVotes) if (v.region === region) fileCount += 1;
    // 방법③: 투입한 계획값 그대로 (독립 출처)
    check(`점심 표 수 · ${region}`, apiRes.total, fileCount, menus.length);

    const tally = {};
    for (const v of db().lunchVotes) {
      if (v.region === region) tally[v.menu] = (tally[v.menu] || 0) + 1;
    }
    const planTally = {};
    for (const m of menus) planTally[m] = (planTally[m] || 0) + 1;
    const topPlan = Object.entries(planTally).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'))[0];

    check(`점심 1위 메뉴 · ${region}`, apiRes.ranking[0].menu, Object.entries(tally)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'))[0][0], topPlan[0]);
    check(`점심 1위 표 수 · ${region}`, apiRes.ranking[0].count, tally[topPlan[0]], topPlan[1]);

    const shareSum = apiRes.ranking.reduce((s, r) => s + r.share, 0);
    check(`비율 합계 · ${region}`, Number(shareSum.toFixed(1)), 100, 100, { tolerance: 0.3 });
  }

  const nationTotal = Object.values(PLAN).reduce((s, m) => s + m.length, 0);
  {
    const c = await newSession();
    const apiRes = (await req('GET', '/api/lunch?region=yeoksam', null, c)).data;
    check('전국 표 합계', apiRes.nationTotal, db().lunchVotes.length, nationTotal);
  }

  // ── 2. 공개 범위별 노출 건수 ───────────────────────────
  let n = 0;
  const signUp = async ({ company }) => {
    n += 1;
    const c = await newSession();
    const email = `cc${n}.${Date.now()}@${company ? 'crosscorp.co.kr' : 'gmail.com'}`;
    const r = await req('POST', '/api/auth/signup', { email, password: 'crosscheck123', nickname: `대조${n}` }, c);
    if (r.status !== 200) throw new Error(`가입 실패: ${JSON.stringify(r.data)}`);
    return { cookie: c, email };
  };

  const verified = await signUp({ company: true });
  const vr = await req('POST', '/api/auth/verify', { industry: '제조', years: 5 }, verified.cookie);
  if (vr.status !== 200) throw new Error(`인증 실패: ${JSON.stringify(vr.data)}`);
  const plain = await signUp({ company: false });

  const posted = { public: 2, members: 1, verified: 1, private: 1 };
  for (let i = 0; i < posted.public; i += 1) {
    await req('POST', '/api/posts', {
      body: `공개 글 ${i}`, category: 'etc', writeAs: 'account', visibility: 'public',
    }, verified.cookie);
  }
  await req('POST', '/api/posts', {
    body: '회원 공개 글', category: 'etc', writeAs: 'account', visibility: 'members',
  }, verified.cookie);
  await req('POST', '/api/posts', {
    body: '인증 전용 글 절대노출금지문장', category: 'etc', writeAs: 'badge', visibility: 'verified',
  }, verified.cookie);
  await req('POST', '/api/posts', {
    body: '비공개 글 절대노출금지문장', category: 'etc', writeAs: 'account',
    visibility: 'private', password: 'lock1234',
  }, verified.cookie);

  const guestCookie = await newSession();
  const guestList = (await req('GET', '/api/posts', null, guestCookie)).data;
  const plainList = (await req('GET', '/api/posts', null, plain.cookie)).data;
  const vList = (await req('GET', '/api/posts', null, verified.cookie)).data;

  const byVis = (v) => db().posts.filter((p) => p.visibility === v && !p.hidden).length;
  check('손님이 볼 수 있는 글', guestList.total, byVis('public'), posted.public);
  check('미인증 회원이 볼 수 있는 글', plainList.total,
    byVis('public') + byVis('members'), posted.public + posted.members);
  check('인증 직장인이 볼 수 있는 글(본인 비공개 포함)', vList.total,
    byVis('public') + byVis('members') + byVis('verified') + byVis('private'),
    posted.public + posted.members + posted.verified + posted.private);

  const privateIds = db().posts.filter((p) => p.visibility === 'private').map((p) => p.id);
  check('타인 목록에 새어나간 비공개 글',
    guestList.posts.filter((p) => privateIds.includes(p.id)).length,
    plainList.posts.filter((p) => privateIds.includes(p.id)).length, 0);

  // ── 3. 본문 유출 검사 ─────────────────────────────────
  let leak = 0;
  for (const p of db().posts) {
    if (p.visibility === 'public') continue;
    const detail = (await req('GET', `/api/posts/${p.id}`, null, guestCookie)).data;
    if (JSON.stringify(detail).includes(p.body.slice(0, 12))) leak += 1;
    const page = await fetch(`${BASE}/talk/${p.id}`).then((r) => r.text());
    if (page.includes('절대노출금지문장')) leak += 1;
  }
  check('손님에게 새어나간 비공개 본문', leak, 0, 0);

  // ── 4. 퇴근 후 성장 (기존 사이트 콘텐츠) ────────────────
  {
    const c = await newSession();
    const quiz = (await req('GET', '/api/grow', null, c)).data.quiz;

    // 문제 내용이 기존 사이트 그대로인가
    check('자격증 문제 수', quiz.total, QUIZ.length, 3);
    check('문제 분류 순서', quiz.questions.map((q) => q.topic).join(','),
      QUIZ.map((q) => q.topic).join(','), '회로이론,전기기기,전력공학');

    // 정답·해설이 클라이언트로 새지 않는가
    const wire = JSON.stringify(quiz.questions);
    check('응답에 섞인 정답·해설',
      (wire.match(/"answer"|"explain"/g) || []).length,
      QUIZ.filter((q) => wire.includes(q.explain)).length, 0);

    // 채점: API 점수 vs 저장 파일 vs 직접 채점
    const answers = QUIZ.map((q) => q.answer);
    answers[2] = (answers[2] + 1) % 4;                 // 한 문제만 일부러 틀린다
    const graded = (await req('POST', '/api/grow/quiz', { answers }, c)).data;
    const byHand = answers.filter((a, i) => a === QUIZ[i].answer).length;
    const stored = db().quizAttempts[db().quizAttempts.length - 1];
    check('자격증 채점 결과', graded.score, stored.score, byHand);
    check('자격증 최고점', graded.grow.quiz.best,
      Math.max(...db().quizAttempts.map((a) => a.score)), byHand);

    // 독서 진도: API percent vs 파일 기록 vs 직접 계산
    const target = BOOKS[0];                            // 물고기는 존재하지 않는다 · 300쪽
    const page = 150;
    const after = (await req('POST', `/api/grow/reading/${target.id}`, { page }, c)).data;
    const apiBook = after.books.find((b) => b.id === target.id);
    const fileRec = db().reading.find((r) => r.bookId === target.id);
    check('독서 진도 쪽수', apiBook.page, fileRec.page, page);
    check('독서 진도 퍼센트', apiBook.percent,
      Math.round((fileRec.page / target.pages) * 100), Math.round((page / target.pages) * 100));

    // 총 쪽수가 없는 책은 퍼센트를 만들어내지 않는다
    const noPages = BOOKS.find((b) => b.pages === null);
    const fresh = await newSession();
    const nb = (await req('GET', '/api/grow', null, fresh)).data.books.find((b) => b.id === noPages.id);
    check('쪽수 미상 책의 퍼센트', nb.percent === null ? 0 : 1, 0, 0);
  }

  // ── 5. 배포 파일 정합성 ───────────────────────────────
  const css = readFileSync(join(ROOT, 'public', 'styles.css'), 'utf8');
  const js = readFileSync(join(ROOT, 'public', 'app.js'), 'utf8');
  const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  check('CSS에 남은 포괄 transition 선언', (cssNoComments.match(/transition:\s*all\s/g) || []).length, 0, 0);

  // hidden 속성이 클래스 규칙에 밀리지 않는지.
  // 이 규칙이 없으면 .sheet{display:flex} 같은 선언 때문에
  // el.hidden = true 로 감춘 요소가 화면에 그대로 남는다.
  const hasHiddenReset = /\[hidden\]\s*\{[^}]*display\s*:\s*none\s*!important/.test(cssNoComments);
  const toggledByHidden = (js.match(/\.hidden\s*=/g) || []).length;
  check('[hidden] 무력화 방지 규칙', hasHiddenReset ? 1 : 0, 1, 1);
  check('hidden 으로 토글하는 요소가 보호됨',
    hasHiddenReset && toggledByHidden > 0 ? toggledByHidden : 0,
    toggledByHidden, toggledByHidden);
  check('색 토큰 정의 블록 수(:root / media / data-theme)', (css.match(/--ink-3:/g) || []).length, 3, 3);
  check('구조 아이콘용 이모지(스크립트)', (js.match(/[\u{1F300}-\u{1FAFF}]/gu) || []).length, 0, 0);

  // 만들어낸 숫자가 코드에 남아 있지 않은지
  const catalog = readFileSync(join(ROOT, 'lib', 'catalog.js'), 'utf8');
  check('카탈로그의 하드코딩 진도·점수',
    (catalog.match(/\b(participants|current|progress|score|best)\s*:/g) || []).length, 0, 0);
  check('남아 있는 시연 계정 문구', (js.match(/demo1234/g) || []).length, 0, 0);
  // 정답이 프런트엔드 코드에 박혀 있지 않은지
  check('클라이언트에 박힌 정답', (js.match(/answer\s*:\s*\d/g) || []).length, 0, 0);

  // ── 6. 명도 대비 (순수 계산) ──────────────────────────
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const lum = (c) => c.map((v) => (v /= 255, v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
  const ratio = (a, b) => {
    const [x, y] = [lum(hex(a)), lum(hex(b))].sort((p, q) => q - p);
    return Number(((x + 0.05) / (y + 0.05)).toFixed(2));
  };
  const pairs = [
    ['본문 잉크/배경 (light)', '#1C1A17', '#FBFAF7'],
    ['보조 잉크/배경 (light)', '#5C574E', '#FBFAF7'],
    ['캡션/카드 (light)', '#726C61', '#FFFFFF'],
    ['브랜드/배경 (light)', '#2F6B5E', '#FBFAF7'],
    ['점심 강조/배경 (light)', '#A0561A', '#FBFAF7'],
    ['본문 잉크/배경 (dark)', '#EDEAE4', '#171614'],
    ['보조 잉크/배경 (dark)', '#A9A399', '#171614'],
    ['캡션/카드 (dark)', '#948E84', '#1F1E1B'],
    ['브랜드/배경 (dark)', '#6FB9A6', '#171614'],
  ];
  for (const [name, fg, bg] of pairs) {
    const r = ratio(fg, bg);
    const ok = r >= 4.5 && css.includes(fg);
    if (!ok) failed += 1;
    rows.push({ item: `대비 ${name}`, m1: `${r}:1`, m2: r >= 4.5 ? '기준 4.5 충족' : '미달', m3: css.includes(fg) ? 'CSS에 존재' : 'CSS에 없음', ok });
  }

  app.server.close();
  rmSync(dir, { recursive: true, force: true });

  const w = (s, n2) => String(s).padEnd(n2);
  console.log('\n검증 항목'.padEnd(42) + w('방법①(API)', 20) + w('방법②(파일 직접)', 22) + w('방법③(재계산)', 18) + '판정');
  console.log('-'.repeat(118));
  for (const r of rows) console.log(w(r.item, 40) + w(r.m1, 20) + w(r.m2, 22) + w(r.m3, 18) + (r.ok ? 'OK' : 'FAIL'));
  console.log('-'.repeat(118));
  console.log(`총 ${rows.length}개 항목 · 불일치 ${failed}개\n`);
  process.exit(failed === 0 ? 0 : 1);
};

main().catch((e) => { console.error('대조 실패:', e.stack || e.message); process.exit(2); });
