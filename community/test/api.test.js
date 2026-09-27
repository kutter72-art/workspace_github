// 검증 방법① — 자동화 테스트
// 서버를 임시 포트에 띄우고 실제 HTTP로 두드린다. 내부 함수를 직접 부르지 않는다.
//
// 미리 채워둔 데이터가 없으므로, 각 테스트는 필요한 계정과 글을 스스로 만든다.

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createApp } from '../server.js';
import { tallyLunch, screenContent, autoTitle } from '../lib/api.js';
import { canView } from '../lib/identity.js';
import { REGIONS, QUIZ, BOOKS } from '../lib/catalog.js';

let base;
let app;
let tmpDir;
let dbPath;

before(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'community-test-'));
  dbPath = join(tmpDir, 'db.json');
  app = createApp({ dbPath });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${app.server.address().port}`;
});

after(() => {
  app.server.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

// 세션(쿠키)을 들고 다니는 미니 클라이언트 — 서로 다른 사용자를 흉내낸다.
function client() {
  let cookie = null;
  return {
    get cookie() { return cookie; },
    async req(method, path, body) {
      const res = await fetch(base + path, {
        method,
        headers: {
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(cookie ? { Cookie: cookie } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const setCookie = res.headers.getSetCookie?.() || [];
      if (setCookie.length) cookie = setCookie[0].split(';')[0];
      let data = null;
      try { data = await res.json(); } catch { data = null; }
      return { status: res.status, data, res };
    },
    get(p) { return this.req('GET', p); },
    post(p, b) { return this.req('POST', p, b || {}); },
  };
}

async function html(path) {
  const res = await fetch(base + path);
  return { status: res.status, type: res.headers.get('content-type'), body: await res.text() };
}

const db = () => JSON.parse(readFileSync(dbPath, 'utf8'));

// ── 테스트용 계정 만들기 ────────────────────────────────
let seq = 0;
const PW = 'testpass123';

async function guest() {
  const c = client();
  await c.get('/api/bootstrap');
  return c;
}

async function member({ company = false } = {}) {
  seq += 1;
  const c = await guest();
  const email = `tester${seq}.${Date.now()}@${company ? 'testcorp.co.kr' : 'gmail.com'}`;
  const nickname = `테스터${seq}${Math.floor(Math.random() * 900) + 100}`;
  const r = await c.post('/api/auth/signup', { email, password: PW, nickname });
  assert.equal(r.status, 200, `가입 실패: ${JSON.stringify(r.data)}`);
  c.email = email;
  c.nickname = nickname;
  return c;
}

async function verifiedMember() {
  const c = await member({ company: true });
  const r = await c.post('/api/auth/verify', { industry: '제조', years: 5 });
  assert.equal(r.status, 200, `인증 실패: ${JSON.stringify(r.data)}`);
  return c;
}

const userIdOf = (c) => db().users.find((u) => u.email === c.email).id;

async function writePost(c, overrides = {}) {
  const r = await c.post('/api/posts', {
    body: '테스트로 남기는 글입니다.',
    category: 'etc',
    writeAs: 'guest',
    visibility: 'public',
    ...overrides,
  });
  assert.equal(r.status, 200, `글쓰기 실패: ${JSON.stringify(r.data)}`);
  return r.data.post;
}

/* ═════════ 0. 초기 상태 — 만들어낸 숫자가 없어야 한다 ═════════ */
describe('초기 상태', () => {
  test('새로 만든 저장소에는 글·표·점수·인증·계정이 하나도 없다', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'community-empty-'));
    const fresh = createApp({ dbPath: join(dir, 'db.json') });
    await new Promise((r) => fresh.server.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${fresh.server.address().port}`;

    const boot = await fetch(`${url}/api/bootstrap`).then((r) => r.json());
    const cookie = 'x=1';
    const today = await fetch(`${url}/api/today`, { headers: { Cookie: cookie } }).then((r) => r.json());
    const posts = await fetch(`${url}/api/posts`, { headers: { Cookie: cookie } }).then((r) => r.json());
    const lunch = await fetch(`${url}/api/lunch`, { headers: { Cookie: cookie } }).then((r) => r.json());
    const brk = await fetch(`${url}/api/break`, { headers: { Cookie: cookie } }).then((r) => r.json());
    const grow = await fetch(`${url}/api/grow`, { headers: { Cookie: cookie } }).then((r) => r.json());
    const raw = JSON.parse(readFileSync(join(dir, 'db.json'), 'utf8'));

    assert.equal(posts.total, 0, '글 0');
    assert.equal(lunch.total, 0, '점심 표 0');
    assert.equal(lunch.nationTotal, 0, '전국 표 0');
    assert.deepEqual(lunch.ranking, [], '순위 비어 있음');
    assert.equal(lunch.myVote, null);
    assert.equal(brk.played, 0, '게임 기록 0');
    assert.equal(today.lunchTop, null);
    assert.equal(today.lunchTotal, 0);
    assert.equal(today.postCount, 0);

    assert.equal(raw.users.length, 0, '미리 만든 계정 없음');
    assert.equal(raw.posts.length, 0, '미리 만든 글 없음');
    assert.equal(raw.lunchVotes.length, 0, '미리 만든 표 없음');
    assert.equal(raw.breakScores.length, 0, '미리 만든 점수 없음');
    assert.equal(raw.goals.length, 0, '미리 만든 목표 없음');
    assert.equal(raw.goalDays.length, 0, '미리 만든 완료 기록 없음');
    assert.equal(raw.quizAttempts.length, 0, '미리 만든 문제풀이 기록 없음');
    assert.equal(raw.reading.length, 0, '미리 만든 독서 진도 없음');

    // 퇴근 후 성장 — 문제·책은 설정이고, 기록은 0에서 시작한다
    assert.equal(grow.quiz.total, QUIZ.length);
    assert.equal(grow.quiz.best, 0);
    assert.equal(grow.quiz.attempts, 0);
    assert.equal(grow.goal.text, '');
    assert.equal(grow.goal.streak, 0);
    assert.equal(grow.goal.totalDays, 0);
    assert.equal(grow.books.length, BOOKS.length);
    for (const b of grow.books) {
      assert.equal(b.page, 0, `${b.title} 진도 0`);
      assert.ok(b.percent === 0 || b.percent === null, `${b.title} 진도율은 0 또는 미상`);
    }
    assert.equal(grow.trackedBooks, 0);
    assert.ok(boot.regions.length > 0 && boot.menuGroups.length > 0, '지역·메뉴 설정은 있어야 한다');

    fresh.server.close();
    rmSync(dir, { recursive: true, force: true });
  });
});

/* ═════════ 1. 서버 저장 — 진단서 F-01의 핵심 ═════════ */
describe('서버 저장 · 글 공유', () => {
  test('A가 쓴 글을 B가 읽을 수 있다', async () => {
    const a = await guest();
    const b = await guest();
    assert.notEqual(a.cookie, b.cookie, '두 클라이언트는 서로 다른 세션이어야 한다');

    const post = await writePost(a, {
      body: '옆 팀이랑 일정이 계속 어긋납니다. 다들 어떻게 맞추시나요?',
      category: 'coworker',
    });

    const list = await b.get('/api/posts');
    assert.ok(list.data.posts.some((p) => p.id === post.id), 'B의 목록에 A의 글이 있어야 한다');

    const detail = await b.get(`/api/posts/${post.id}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.data.denied, false);
    assert.match(detail.data.post.body, /일정이 계속 어긋납니다/);

    assert.equal(detail.data.post.mine, false, 'B에게는 내 글이 아니어야 한다');
    const own = await a.get(`/api/posts/${post.id}`);
    assert.equal(own.data.post.mine, true, 'A에게는 내 글이어야 한다');
  });

  test('디스크에 실제로 기록된다', async () => {
    const a = await guest();
    const post = await writePost(a, { body: '디스크 영속성 확인용 글입니다.' });
    assert.ok(db().posts.some((p) => p.id === post.id), 'db.json에 글이 남아야 한다');
  });
});

/* ═════════ 2. 신원 4단계 ═════════ */
describe('신원 4단계', () => {
  test('손님은 guest만, 로그인하면 account·mask가 열린다', async () => {
    const c = await guest();
    const boot = await c.get('/api/me');
    assert.deepEqual(boot.data.me.writeModes, ['guest']);
    assert.equal(boot.data.me.level, 'L0');

    const m = await member();
    const me = await m.get('/api/me');
    assert.equal(me.data.me.level, 'L1');
    assert.deepEqual(me.data.me.writeModes, ['account', 'mask']);
  });

  test('회사 이메일로 인증하면 badge까지 열린다', async () => {
    const v = await verifiedMember();
    const me = await v.get('/api/me');
    assert.equal(me.data.me.level, 'L2');
    assert.deepEqual(me.data.me.writeModes, ['account', 'mask', 'badge']);
  });

  test('가면(mask) — 화면엔 익명, 서버엔 계정이 연결된다', async () => {
    const m = await member();
    const post = await writePost(m, { body: '가면으로 쓰는 글입니다.', writeAs: 'mask' });
    assert.equal(post.authorNick, '익명', '표시 이름은 익명이어야 한다');

    const stored = db().posts.find((p) => p.id === post.id);
    assert.equal(stored.authorUserId, userIdOf(m), '신고 대응을 위해 계정은 연결돼 있어야 한다');
    assert.equal(stored.authorNick, '익명');
  });

  test('가면은 인증 배지를 달지 않는다 — 익명 범위가 좁아지지 않도록', async () => {
    const v = await verifiedMember();

    const masked = await writePost(v, { body: '인증 계정이 가면으로 쓴 글', writeAs: 'mask' });
    assert.equal(masked.authorNick, '익명');
    assert.equal(masked.verified, false, '가면 글에는 인증 배지가 붙지 않는다');

    const badged = await writePost(v, { body: '같은 계정이 배지로 쓴 글', writeAs: 'badge' });
    assert.equal(badged.verified, true);
    assert.match(badged.authorNick, /년차/);

    assert.equal(db().posts.find((p) => p.id === masked.id).authorUserId, userIdOf(v));
  });

  test('클라이언트가 보낸 닉네임·인증 주장은 무시된다', async () => {
    const c = await guest();
    const post = await writePost(c, { body: '위조 시도', authorNick: '관리자', verified: true });
    assert.notEqual(post.authorNick, '관리자');
    assert.equal(post.verified, false);
  });

  test('권한 밖 작성 방식은 403', async () => {
    const c = await guest();
    const r = await c.post('/api/posts', {
      body: '손님이 배지로 쓰려는 시도', category: 'etc',
      writeAs: 'badge', visibility: 'public',
    });
    assert.equal(r.status, 403);
  });
});

/* ═════════ 3. 공개 범위 4단계 ═════════ */
describe('공개 범위 4단계', () => {
  test('members — 비로그인은 막히고 로그인은 통과', async () => {
    const author = await member();
    const post = await writePost(author, {
      body: '회원만 보는 글', category: 'move', writeAs: 'account', visibility: 'members',
    });

    const g = await guest();
    const denied = await g.get(`/api/posts/${post.id}`);
    assert.equal(denied.data.denied, true);
    assert.equal(denied.data.post.body, null, '본문이 새어나가면 안 된다');
    assert.equal(denied.data.post.excerpt, null);

    const other = await member();
    const ok = await other.get(`/api/posts/${post.id}`);
    assert.equal(ok.data.denied, false);
    assert.match(ok.data.post.body, /회원만 보는 글/);
  });

  test('verified — 미인증 회원은 막히고 인증 회원은 통과', async () => {
    const author = await verifiedMember();
    const post = await writePost(author, {
      body: '인증 직장인만 보는 글', category: 'pay', writeAs: 'badge', visibility: 'verified',
    });

    const plain = await member();
    const denied = await plain.get(`/api/posts/${post.id}`);
    assert.equal(denied.data.denied, true);
    assert.equal(denied.data.post.body, null);

    const ok = await author.get(`/api/posts/${post.id}`);
    assert.equal(ok.data.denied, false);
  });

  test('private — 남에게는 목록에서도 숨고, 비밀번호로만 열린다', async () => {
    const author = await guest();
    const post = await writePost(author, {
      body: '나만 보는 기록', visibility: 'private', password: 'secret9',
    });

    const other = await guest();
    const list = await other.get('/api/posts');
    assert.ok(!list.data.posts.some((p) => p.id === post.id), '남의 비공개 글은 목록에 없어야 한다');

    const denied = await other.get(`/api/posts/${post.id}`);
    assert.equal(denied.data.denied, true);
    assert.equal(denied.data.post.title, '비공개 글입니다');

    assert.equal((await other.post(`/api/posts/${post.id}/unlock`, { password: 'nope' })).status, 401);

    const right = await other.post(`/api/posts/${post.id}/unlock`, { password: 'secret9' });
    assert.equal(right.status, 200);
    assert.match(right.data.post.body, /나만 보는 기록/);

    const again = await other.get(`/api/posts/${post.id}`);
    assert.equal(again.data.denied, false, '잠금 해제는 세션에 남는다');
  });

  test('본인 비공개 글은 목록에 보인다', async () => {
    const author = await guest();
    const post = await writePost(author, {
      body: '내 비공개 메모', visibility: 'private', password: 'mine1234',
    });
    const list = await author.get('/api/posts');
    assert.ok(list.data.posts.some((p) => p.id === post.id));
  });

  test('canView 순수 함수 — 4단계 전수 검사', () => {
    const post = (visibility) => ({
      visibility, hidden: false, authorUserId: 'u1', sessionToken: null,
    });
    const g = { token: 't-guest', userId: null, verified: false, unlocked: [] };
    const m = { token: 't-m', userId: 'u2', verified: false, unlocked: [] };
    const v = { token: 't-v', userId: 'u3', verified: true, unlocked: [] };
    const owner = { token: 't-o', userId: 'u1', verified: false, unlocked: [] };

    const table = [
      ['public',   [true,  true,  true,  true]],
      ['members',  [false, true,  true,  true]],
      ['verified', [false, false, true,  false]],
      ['private',  [false, false, false, true]],
    ];
    for (const [vis, expected] of table) {
      assert.deepEqual([g, m, v, owner].map((who) => canView(post(vis), who)), expected, `${vis} 판정이 어긋남`);
    }
  });
});

/* ═════════ 4. 점심 집계 — 실제 표에서만 나온다 ═════════ */
describe('점심 집계', () => {
  test('표를 넣은 만큼만 순위가 생긴다', async () => {
    const region = 'pangyo';
    const before = (await (await guest()).get(`/api/lunch?region=${region}`)).data.total;

    // 서로 다른 세션 5명이 투표
    const picks = ['제육볶음', '제육볶음', '돈까스', '포케', '제육볶음'];
    for (const menu of picks) {
      const c = await guest();
      const r = await c.post('/api/lunch/vote', { region, menu });
      assert.equal(r.status, 200);
    }

    const after = await (await guest()).get(`/api/lunch?region=${region}`);
    assert.equal(after.data.total, before + picks.length);
    assert.equal(after.data.ranking[0].menu, '제육볶음');
    assert.equal(after.data.ranking[0].count, 3);

    // 저장 파일과도 일치해야 한다
    const stored = db().lunchVotes.filter((v) => v.region === region).length;
    assert.equal(after.data.total, stored);
  });

  test('tallyLunch — 개수 합 = 전체, 비율 합 ≈ 100', () => {
    const votes = [
      { region: 'a', menu: '제육볶음' }, { region: 'a', menu: '제육볶음' },
      { region: 'a', menu: '돈까스' }, { region: 'b', menu: '물냉면' },
    ];
    const a = tallyLunch(votes, 'a');
    assert.equal(a.total, 3);
    assert.equal(a.ranking.reduce((s, r) => s + r.count, 0), 3);
    assert.ok(Math.abs(a.ranking.reduce((s, r) => s + r.share, 0) - 100) < 0.2);
    assert.equal(a.ranking[0].menu, '제육볶음');
    assert.equal(a.ranking[0].count, 2);
    assert.equal(tallyLunch(votes, null).total, 4);
    assert.deepEqual(tallyLunch([], 'a').ranking, [], '표가 없으면 순위도 없다');
  });

  test('한 세션은 지역당 한 표 — 다시 투표하면 갱신된다', async () => {
    const region = 'jongno';
    const c = await guest();
    const before = (await c.get(`/api/lunch?region=${region}`)).data.total;

    await c.post('/api/lunch/vote', { region, menu: '김밥' });
    const after1 = await c.get(`/api/lunch?region=${region}`);
    assert.equal(after1.data.total, before + 1);
    assert.equal(after1.data.myVote, '김밥');

    const second = await c.post('/api/lunch/vote', { region, menu: '우동' });
    assert.equal(second.data.changed, true);
    const after2 = await c.get(`/api/lunch?region=${region}`);
    assert.equal(after2.data.total, before + 1, '표가 늘어나면 안 된다');
    assert.equal(after2.data.myVote, '우동');
  });

  test('없는 지역·메뉴는 거부된다', async () => {
    const c = await guest();
    assert.equal((await c.post('/api/lunch/vote', { region: 'nowhere', menu: '김밥' })).status, 400);
    assert.equal((await c.post('/api/lunch/vote', { region: REGIONS[0].id, menu: '없는메뉴' })).status, 400);
  });
});

/* ═════════ 5. 퇴근 후 성장 — 기존 사이트 콘텐츠 ═════════ */
describe('퇴근 후 성장 · 오늘의 10분', () => {
  test('목표를 저장하고 완료 표시를 켜고 끌 수 있다', async () => {
    const c = await guest();
    assert.equal((await c.post('/api/grow/goal/done', {})).status, 400, '목표 없이 완료 표시 불가');

    const saved = await c.post('/api/grow/goal', { text: '기출 3문제 풀기' });
    assert.equal(saved.status, 200);
    assert.equal(saved.data.goal.text, '기출 3문제 풀기');
    assert.equal(saved.data.goal.doneToday, false);

    const done = await c.post('/api/grow/goal/done', {});
    assert.equal(done.data.goal.doneToday, true);
    assert.equal(done.data.goal.totalDays, 1);
    assert.equal(done.data.goal.streak, 1);

    const undone = await c.post('/api/grow/goal/done', { done: false });
    assert.equal(undone.data.goal.doneToday, false);
    assert.equal(undone.data.goal.totalDays, 0);
  });

  test('내 목표는 남에게 보이지 않는다', async () => {
    const a = await guest();
    const b = await guest();
    await a.post('/api/grow/goal', { text: '내 목표만 보임' });
    assert.equal((await b.get('/api/grow')).data.goal.text, '');
  });
});

describe('퇴근 후 성장 · 자격증 연습', () => {
  test('문제는 기존 사이트의 전기 3문제 그대로다', async () => {
    const c = await guest();
    const q = (await c.get('/api/grow')).data.quiz;
    assert.equal(q.total, 3);
    assert.deepEqual(q.questions.map((x) => x.topic), ['회로이론', '전기기기', '전력공학']);
    assert.match(q.questions[0].question, /6Ω과 3Ω을 병렬/);
    assert.match(q.questions[1].question, /변압기의 기본 원리/);
    assert.match(q.questions[2].question, /송전 전압을 높였을 때/);
  });

  test('정답과 해설은 클라이언트로 나가지 않는다', async () => {
    const c = await guest();
    const raw = JSON.stringify((await c.get('/api/grow')).data.quiz.questions);
    assert.ok(!raw.includes('answer'), '정답 인덱스가 새면 안 된다');
    assert.ok(!raw.includes('explain'), '해설이 미리 새면 안 된다');
    for (const q of QUIZ) assert.ok(!raw.includes(q.explain), `해설 노출: ${q.id}`);
  });

  test('채점은 서버가 하고 최고 점수가 기록된다', async () => {
    const c = await guest();
    const correct = QUIZ.map((q) => q.answer);

    const wrong = await c.post('/api/grow/quiz', { answers: correct.map((a) => (a + 1) % 4) });
    assert.equal(wrong.data.score, 0);
    assert.equal(wrong.data.results.length, 3);
    assert.ok(wrong.data.results.every((r) => !r.correct));
    assert.ok(wrong.data.results.every((r) => typeof r.explain === 'string' && r.explain.length > 0),
      '제출 후에는 해설을 받는다');

    const all = await c.post('/api/grow/quiz', { answers: correct });
    assert.equal(all.data.score, 3);
    assert.equal(all.data.grow.quiz.best, 3);
    assert.equal(all.data.grow.quiz.attempts, 2);
    assert.equal(all.data.grow.quiz.lastScore, 3);

    // 최고 점수는 내려가지 않는다
    const again = await c.post('/api/grow/quiz', { answers: correct.map((a) => (a + 1) % 4) });
    assert.equal(again.data.grow.quiz.best, 3);
  });

  test('답 개수가 맞지 않으면 거부', async () => {
    const c = await guest();
    assert.equal((await c.post('/api/grow/quiz', { answers: [0] })).status, 400);
    assert.equal((await c.post('/api/grow/quiz', {})).status, 400);
  });

  test('내 점수는 남에게 보이지 않는다', async () => {
    const a = await guest();
    const b = await guest();
    await a.post('/api/grow/quiz', { answers: QUIZ.map((q) => q.answer) });
    assert.equal((await b.get('/api/grow')).data.quiz.best, 0);
  });
});

describe('퇴근 후 성장 · 독서 기록', () => {
  test('책 목록은 기존 서재 그대로다', async () => {
    const c = await guest();
    const books = (await c.get('/api/grow')).data.books;
    assert.deepEqual(books.map((b) => b.title), [
      '물고기는 존재하지 않는다', '아주 작은 습관의 힘', '프로젝트 헤일메리', '보스의 탄생',
    ]);
    assert.equal(books[0].author, '룰루 밀러');
    assert.equal(books[0].pages, 300);
    assert.equal(books[1].pages, 359);
    assert.equal(books[2].pages, 692);
  });

  test('진도를 기록하면 퍼센트가 계산된다', async () => {
    const c = await guest();
    const r = await c.post('/api/grow/reading/b-fish', { page: 150 });
    const b = r.data.books.find((x) => x.id === 'b-fish');
    assert.equal(b.page, 150);
    assert.equal(b.percent, 50);
    assert.equal(r.data.trackedBooks, 1);
  });

  test('+5% 는 총 쪽수 기준으로 더해지고 범위를 넘지 않는다', async () => {
    const c = await guest();
    await c.post('/api/grow/reading/b-habit', { page: 0 });
    const step = await c.post('/api/grow/reading/b-habit', { delta: 5 });
    assert.equal(step.data.books.find((x) => x.id === 'b-habit').page, Math.round(359 * 0.05));

    await c.post('/api/grow/reading/b-habit', { page: 359 });
    const over = await c.post('/api/grow/reading/b-habit', { delta: 5 });
    assert.equal(over.data.books.find((x) => x.id === 'b-habit').page, 359, '총 쪽수를 넘지 않는다');
  });

  test('총 쪽수가 없는 책은 NaN 대신 미상으로 표시되고, 입력하면 계산된다', async () => {
    const c = await guest();
    const before = (await c.get('/api/grow')).data.books.find((b) => b.id === 'b-boss');
    assert.equal(before.pages, null);
    assert.equal(before.percent, null, '퍼센트를 지어내지 않는다');
    assert.equal(before.needsPages, true);

    // 쪽수를 모르면 +5% 도 거부
    assert.equal((await c.post('/api/grow/reading/b-boss', { delta: 5 })).status, 400);

    await c.post('/api/grow/reading/b-boss', { pages: 400, page: 0 });
    const after = (await c.post('/api/grow/reading/b-boss', { page: 100 })).data.books
      .find((b) => b.id === 'b-boss');
    assert.equal(after.pages, 400);
    assert.equal(after.percent, 25);
    assert.equal(after.needsPages, false);
  });

  test('잘못된 입력과 없는 책은 거부', async () => {
    const c = await guest();
    assert.equal((await c.post('/api/grow/reading/없는책', { page: 1 })).status, 404);
    assert.equal((await c.post('/api/grow/reading/b-fish', { page: -5 })).status, 400);
    assert.equal((await c.post('/api/grow/reading/b-boss', { pages: 0 })).status, 400);
  });

  test('내 진도는 남에게 보이지 않는다', async () => {
    const a = await guest();
    const b = await guest();
    await a.post('/api/grow/reading/b-hail', { page: 300 });
    assert.equal((await b.get('/api/grow')).data.books.find((x) => x.id === 'b-hail').page, 0);
  });
});

/* ═════════ 6. 반응 · 신고 ═════════ */
describe('반응과 신고', () => {
  test('한 사람은 한 번 — 재클릭은 취소, 다른 반응은 변경', async () => {
    const author = await guest();
    const post = await writePost(author, { body: '반응 테스트용 글' });

    const u = await guest();
    let res = await u.post(`/api/posts/${post.id}/reactions`, { reaction: 'same' });
    assert.equal(res.data.reactions.same, 1);

    res = await u.post(`/api/posts/${post.id}/reactions`, { reaction: 'same' });
    assert.equal(res.data.reactions.same, 0, '같은 걸 다시 누르면 취소');

    res = await u.post(`/api/posts/${post.id}/reactions`, { reaction: 'pat' });
    assert.equal(res.data.reactions.pat, 1);
    res = await u.post(`/api/posts/${post.id}/reactions`, { reaction: 'angry' });
    assert.equal(res.data.reactions.pat, 0, '다른 걸 누르면 이전 것은 내려간다');
    assert.equal(res.data.reactions.angry, 1);
  });

  test('새 글의 반응·조회수는 0에서 시작한다', async () => {
    const author = await guest();
    const post = await writePost(author, { body: '갓 쓴 글' });
    assert.deepEqual(post.reactions, { same: 0, pat: 0, angry: 0 });
    assert.equal(post.views, 0);
    assert.equal(post.commentCount, 0);
  });

  test('신고 3건이면 자동으로 가려진다 (임시조치)', async () => {
    const author = await guest();
    const post = await writePost(author, { body: '신고 임계 테스트' });

    let last;
    for (let i = 0; i < 3; i += 1) {
      const rc = await guest();
      last = await rc.post(`/api/posts/${post.id}/report`, { reason: '욕설' });
    }
    assert.equal(last.data.reportCount, 3);
    assert.equal(last.data.hidden, true);

    const stranger = await guest();
    const list = await stranger.get('/api/posts');
    assert.ok(!list.data.posts.some((p) => p.id === post.id), '가려진 글은 목록에서 빠진다');

    const own = await author.get(`/api/posts/${post.id}`);
    assert.equal(own.data.denied, false, '작성자 본인은 계속 볼 수 있다');
  });

  test('같은 사람이 두 번 신고하면 409', async () => {
    const author = await guest();
    const post = await writePost(author, { body: '중복 신고 테스트' });
    const rc = await guest();
    assert.equal((await rc.post(`/api/posts/${post.id}/report`, {})).status, 200);
    assert.equal((await rc.post(`/api/posts/${post.id}/report`, {})).status, 409);
  });
});

/* ═════════ 7. 자동 필터 ═════════ */
describe('자동 필터', () => {
  test('전화번호·성씨+직급·회사명을 잡아낸다', () => {
    assert.ok(screenContent('연락처는 010-1234-5678 입니다.').length > 0);
    assert.ok(screenContent('김부장님이 또 그러시네요').length > 0);
    assert.ok(screenContent('주식회사 대하에서 있었던 일').length > 0);
    assert.equal(screenContent('오늘 점심은 제육볶음이었다.').length, 0, '평범한 문장은 통과');
  });

  test('/api/screen 이 경고를 돌려준다', async () => {
    const c = await guest();
    const r = await c.post('/api/screen', { text: '박과장 010-9876-5432' });
    assert.ok(r.data.warnings.length >= 2);
  });
});

/* ═════════ 8. 실제 경로와 공유 카드 (F-04) ═════════ */
describe('실제 경로와 공유 카드', () => {
  test('모든 탭 경로가 200 HTML을 돌려준다', async () => {
    for (const p of ['/', '/lunch', '/talk', '/break', '/grow', '/me']) {
      const r = await html(p);
      assert.equal(r.status, 200, `${p} 응답 코드`);
      assert.match(r.type, /text\/html/, `${p} 콘텐츠 타입`);
      assert.match(r.body, /<div class="sheet-backdrop"/, `${p} 셸 렌더링`);
    }
  });

  test('경로마다 제목과 설명이 다르다', async () => {
    const lunch = await html('/lunch');
    const talk = await html('/talk');
    assert.match(lunch.body, /<title>점심 · 오늘의 직장인<\/title>/);
    assert.match(talk.body, /<title>토크 · 오늘의 직장인<\/title>/);
    assert.notEqual(lunch.body, talk.body);
  });

  test('공개 글은 개별 주소에 공유 카드가 붙는다', async () => {
    const a = await guest();
    const post = await writePost(a, {
      body: '공유 카드가 붙는지 확인하는 글입니다.', title: '공유 확인용 제목',
    });
    const page = await html(`/talk/${post.id}`);
    assert.equal(page.status, 200);
    assert.match(page.body, /<title>공유 확인용 제목 · 오늘의 직장인<\/title>/);
    assert.match(page.body, /og:description" content="공유 카드가 붙는지/);
  });

  test('비공개 글의 본문은 공유 카드에 새지 않는다', async () => {
    const a = await guest();
    const post = await writePost(a, {
      body: '절대로바깥에노출되면안되는문장', title: '비밀 제목',
      visibility: 'private', password: 'pw1234',
    });
    const page = await html(`/talk/${post.id}`);
    assert.ok(!page.body.includes('절대로바깥에노출되면안되는문장'), '본문이 메타에 새면 안 된다');
    assert.ok(!page.body.includes('비밀 제목'), '제목도 새면 안 된다');
    assert.match(page.body, /공개되지 않은 글/);
  });

  test('정적 자원이 제공되고 경로 탈출은 막힌다', async () => {
    const css = await html('/assets/styles.css');
    assert.equal(css.status, 200);
    assert.match(css.type, /text\/css/);
    assert.notEqual((await html('/assets/../../package.json')).status, 200);
  });
});

/* ═════════ 9. 입력 검증 ═════════ */
describe('입력 검증', () => {
  test('빈 본문·없는 카테고리·잘못된 공개범위는 거부', async () => {
    const c = await guest();
    assert.equal((await c.post('/api/posts', {
      body: '', category: 'etc', writeAs: 'guest', visibility: 'public',
    })).status, 400);
    assert.equal((await c.post('/api/posts', {
      body: '내용은 충분함', category: '없는카테고리', writeAs: 'guest', visibility: 'public',
    })).status, 400);
    assert.equal((await c.post('/api/posts', {
      body: '내용은 충분함', category: 'etc', writeAs: 'guest', visibility: '이상한범위',
    })).status, 400);
  });

  test('손님도 비밀번호 없이 공개 글을 쓸 수 있다', async () => {
    const c = await guest();
    const r = await c.post('/api/posts', {
      body: '비밀번호 없이 쓰는 첫 글', category: 'etc',
      writeAs: 'guest', visibility: 'public',
    });
    assert.equal(r.status, 200, '첫 행동에 비밀번호를 요구하지 않는다');

    // 같은 세션에서는 본인 글로 인식된다
    const own = await c.get(`/api/posts/${r.data.post.id}`);
    assert.equal(own.data.post.mine, true);
  });

  test('비공개 글에는 비밀번호가 반드시 필요하다', async () => {
    const c = await guest();
    const r = await c.post('/api/posts', {
      body: '비밀번호 없는 비공개 글', category: 'etc',
      writeAs: 'guest', visibility: 'private',
    });
    assert.equal(r.status, 400);
  });

  test('제목을 비우면 본문 첫 줄이 제목이 된다', async () => {
    const c = await guest();
    const post = await writePost(c, { body: '첫 줄이 제목이 됩니다\n둘째 줄은 본문입니다.' });
    assert.equal(post.title, '첫 줄이 제목이 됩니다');
  });

  test('자동 제목은 40자 안에서 말이 끊기지 않게 잘린다', () => {
    assert.equal(autoTitle('짧은 제목'), '짧은 제목');

    const long = autoTitle('오늘 회의가 갑자기 잡혔는데 자료를 30분 만에 만들라고 하시네요 어떻게 하죠');
    assert.ok(long.length <= 41, '41자를 넘지 않는다');
    assert.ok(long.endsWith('…'), '잘렸으면 말줄임표가 붙는다');
    assert.ok(!/\s…$/.test(long), '말줄임표 앞에 공백이 남지 않는다');

    const noSpace = autoTitle('가'.repeat(80));
    assert.ok(noSpace.length <= 41);
    assert.ok(noSpace.endsWith('…'));

    assert.equal(autoTitle('첫 줄입니다\n둘째 줄입니다'), '첫 줄입니다');
  });

  test('중복 가입과 잘못된 로그인은 거부', async () => {
    const m = await member();
    const c = await guest();
    assert.equal((await c.post('/api/auth/signup', {
      email: m.email, password: 'whatever8', nickname: '다른이름',
    })).status, 409);
    assert.equal((await c.post('/api/auth/login', {
      email: m.email, password: 'wrongpass',
    })).status, 401);
  });

  test('개인 메일 도메인은 직장인 인증 대상이 아니다', async () => {
    const m = await member();           // gmail.com 으로 가입
    const me = await m.get('/api/me');
    assert.equal(me.data.me.canVerify, false);
    assert.equal((await m.post('/api/auth/verify', { industry: 'IT', years: 3 })).status, 400);
  });

  test('없는 API 경로는 404', async () => {
    const c = await guest();
    assert.equal((await c.get('/api/nothing-here')).status, 404);
  });
});

/* ═════════ 10. 조회수 ═════════ */
describe('조회수', () => {
  test('같은 세션이 여러 번 열어도 1회만 오른다', async () => {
    const a = await guest();
    const post = await writePost(a, { body: '조회수 테스트' });

    const v = await guest();
    const first = await v.get(`/api/posts/${post.id}`);
    const second = await v.get(`/api/posts/${post.id}`);
    assert.equal(first.data.post.views, 1);
    assert.equal(second.data.post.views, 1, '같은 세션 재방문은 세지 않는다');

    const w = await guest();
    assert.equal((await w.get(`/api/posts/${post.id}`)).data.post.views, 2, '다른 세션은 센다');
  });
});
