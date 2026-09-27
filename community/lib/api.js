// API 핸들러. 모든 권한 판정은 서버에서 한다 —
// 클라이언트가 보낸 닉네임·인증여부·소유권 주장은 신뢰하지 않는다.

import { randomUUID } from 'node:crypto';
import {
  WRITE_MODES, VISIBILITIES, CATEGORIES, REACTIONS,
  hashPassword, verifyPassword, makeToken, makeGuestNick,
  isCompanyEmail, resolveAuthor, canView, isOwner,
  publicPost, publicComment,
} from './identity.js';
import { REGIONS, MENU_GROUPS, ALL_MENUS, QUIZ, BOOKS, quizForClient } from './catalog.js';

const HIDE_THRESHOLD = 3; // 신고 3건이면 자동 가림 (임시조치 대응)

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function need(value, name) {
  if (value === undefined || value === null || String(value).trim() === '') {
    throw new ApiError(400, `${name}을(를) 입력해 주세요.`);
  }
  return String(value).trim();
}

function limit(text, name, min, max) {
  const t = String(text ?? '').trim();
  if (t.length < min) throw new ApiError(400, `${name}은(는) ${min}자 이상이어야 합니다.`);
  if (t.length > max) throw new ApiError(400, `${name}은(는) ${max}자를 넘을 수 없습니다.`);
  return t;
}

// ── 자동 필터 ────────────────────────────────────────────────
// 진단서 09장: "삼가주세요" 안내문을 실제 동작으로.
const RANK_WORDS = '사장|부사장|전무|상무|이사|부장|차장|과장|팀장|대리|주임|사원';
const SCREENS = [
  { re: /01[016-9][-. ]?\d{3,4}[-. ]?\d{4}/, msg: '전화번호로 보이는 내용이 있습니다.' },
  { re: /[가-힣]{2,4}@[\w.-]+\.\w{2,}/, msg: '이메일 주소가 포함돼 있습니다.' },
  { re: new RegExp(`[가-힣]{1}\\s?(${RANK_WORDS})(님)?`), msg: '성씨+직급 형태의 표현이 있습니다. 특정 개인이 드러날 수 있어요.' },
  { re: /주식회사\s?[가-힣A-Za-z]{2,}|[가-힣]{2,}\s?(주)/, msg: '회사명으로 보이는 표현이 있습니다.' },
];

export function screenContent(text) {
  const t = String(text || '');
  return SCREENS.filter((s) => s.re.test(t)).map((s) => s.msg);
}

// ── 제목 자동 생성 ───────────────────────────────────────────
// 제목을 비우면 본문 첫 줄을 쓴다. 40자를 넘으면 문장부호나 띄어쓰기에서
// 끊어 말이 중간에 잘리지 않게 한다.
export function autoTitle(text) {
  const first = String(text).split('\n')[0].trim();
  if (first.length <= 40) return first;
  const head = first.slice(0, 40);
  const cut = Math.max(
    head.lastIndexOf(' '), head.lastIndexOf('.'), head.lastIndexOf(','),
    head.lastIndexOf('?'), head.lastIndexOf('!'),
  );
  const base = cut >= 20 ? head.slice(0, cut) : head;
  return `${base.replace(/[.,?!]$/, '').trimEnd()}…`;
}

// ── 점심 집계 ────────────────────────────────────────────────
// 저장된 표 레코드를 매번 세어 순위를 만든다. 고정값을 쓰지 않는다.
export function tallyLunch(votes, region) {
  const scoped = region ? votes.filter((v) => v.region === region) : votes;
  const counts = new Map();
  for (const v of scoped) counts.set(v.menu, (counts.get(v.menu) || 0) + 1);
  const total = scoped.length;
  const ranking = [...counts.entries()]
    .map(([menu, count]) => ({
      menu,
      count,
      share: total ? Number(((count / total) * 100).toFixed(1)) : 0,
    }))
    .sort((a, b) => b.count - a.count || a.menu.localeCompare(b.menu, 'ko'));
  return { total, ranking, menuCount: counts.size };
}

export function createApi(store) {
  // ── 세션 ────────────────────────────────────────────────
  function ensureSession(token) {
    let session = store.findSession(token);
    if (!session) {
      session = store.addSession({
        token: makeToken(),
        userId: null,
        guestNick: makeGuestNick(),
        unlocked: [],
        viewed: [],
        createdAt: new Date().toISOString(),
      });
    }
    if (!session.unlocked) session.unlocked = [];
    if (!session.viewed) session.viewed = [];
    return session;
  }

  function viewerOf(session) {
    const user = session.userId ? store.findUserById(session.userId) : null;
    return {
      token: session.token,
      userId: user ? user.id : null,
      verified: !!(user && user.verified),
      unlocked: session.unlocked || [],
      user,
    };
  }

  function meOf(session) {
    const v = viewerOf(session);
    return {
      level: v.userId ? (v.verified ? 'L2' : 'L1') : 'L0',
      loggedIn: !!v.userId,
      verified: v.verified,
      nickname: v.user ? v.user.nickname : session.guestNick,
      guestNick: session.guestNick,
      email: v.user ? v.user.email : null,
      industry: v.user ? v.user.industry : null,
      years: v.user ? v.user.years : null,
      canVerify: !!(v.user && !v.user.verified && isCompanyEmail(v.user.email)),
      writeModes: v.userId
        ? (v.verified ? ['account', 'mask', 'badge'] : ['account', 'mask'])
        : ['guest'],
      visibilities: v.userId
        ? (v.verified ? ['public', 'members', 'verified', 'private'] : ['public', 'members', 'private'])
        : ['public', 'private'],
    };
  }

  // ── 퇴근 후 성장 상태 ───────────────────────────────────
  const keyOf = (session) => viewerOf(session).userId || session.token;
  const todayStr = () => new Date().toISOString().slice(0, 10);

  // 연속 며칠 이어졌는지 — 오늘(또는 어제)부터 거꾸로 센다.
  function streakOf(days) {
    const set = new Set(days);
    const d = new Date();
    if (!set.has(todayStr())) d.setDate(d.getDate() - 1);
    let n = 0;
    for (;;) {
      const key = d.toISOString().slice(0, 10);
      if (!set.has(key)) break;
      n += 1;
      d.setDate(d.getDate() - 1);
    }
    return n;
  }

  function growState(session) {
    const key = keyOf(session);
    const today = todayStr();

    const myDays = store.goalDays().filter((d) => d.by === key).map((d) => d.date);
    const goal = store.goalOf(key);

    const myAttempts = store.quizAttempts().filter((a) => a.by === key);
    const best = myAttempts.reduce((m, a) => Math.max(m, a.score), 0);

    const books = BOOKS.map((b) => {
      const mine = store.readingOf(key, b.id);
      const pages = b.pages ?? mine?.pages ?? null;
      const page = mine?.page ?? 0;
      return {
        id: b.id, title: b.title, author: b.author,
        pages, page,
        // 총 쪽수를 모르면 퍼센트를 만들어내지 않는다 (원본의 NaN% 자리)
        percent: pages ? Math.round((page / pages) * 100) : null,
        needsPages: !pages,
      };
    });
    const tracked = books.filter((b) => b.page > 0).length;

    return {
      goal: {
        text: goal ? goal.text : '',
        doneToday: myDays.includes(today),
        totalDays: myDays.length,
        streak: streakOf(myDays),
      },
      quiz: {
        questions: quizForClient(),
        total: QUIZ.length,
        best,
        attempts: myAttempts.length,
        lastScore: myAttempts.length ? myAttempts[myAttempts.length - 1].score : null,
      },
      books,
      trackedBooks: tracked,
    };
  }

  // ── 라우트 ──────────────────────────────────────────────
  const routes = {
    'GET /api/bootstrap': ({ session }) => ({
      me: meOf(session),
      categories: CATEGORIES,
      reactions: REACTIONS,
      regions: REGIONS,
      menuGroups: MENU_GROUPS,
      visibilityLabels: {
        public: '전체 공개', members: '회원 공개',
        verified: '인증 직장인만', private: '비공개',
      },
    }),

    'GET /api/me': ({ session }) => ({ me: meOf(session) }),

    'POST /api/auth/signup': ({ session, body }) => {
      const email = need(body.email, '이메일').toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        throw new ApiError(400, '이메일 형식이 올바르지 않습니다.');
      }
      if (store.findUserByEmail(email)) throw new ApiError(409, '이미 가입된 이메일입니다.');
      const password = limit(body.password, '비밀번호', 8, 64);
      const nickname = limit(body.nickname, '닉네임', 2, 16);
      if (store.data.users.some((u) => u.nickname === nickname)) {
        throw new ApiError(409, '이미 쓰이는 닉네임입니다.');
      }
      const { hash, salt } = hashPassword(password);
      const user = store.addUser({
        id: `user-${randomUUID().slice(0, 8)}`,
        email, passwordHash: hash, salt, nickname,
        verified: false, industry: '', years: 0,
        createdAt: new Date().toISOString(),
      });
      store.updateSession(session.token, { userId: user.id });
      return { me: meOf(store.findSession(session.token)) };
    },

    'POST /api/auth/login': ({ session, body }) => {
      const email = need(body.email, '이메일').toLowerCase();
      const password = need(body.password, '비밀번호');
      const user = store.findUserByEmail(email);
      if (!user || !verifyPassword(password, user.passwordHash, user.salt)) {
        throw new ApiError(401, '이메일 또는 비밀번호가 맞지 않습니다.');
      }
      store.updateSession(session.token, { userId: user.id });
      return { me: meOf(store.findSession(session.token)) };
    },

    'POST /api/auth/logout': ({ session }) => {
      store.updateSession(session.token, { userId: null, unlocked: [] });
      return { me: meOf(store.findSession(session.token)) };
    },

    // L2 인증: 계정 이메일 도메인이 회사 도메인이면 배지 부여
    'POST /api/auth/verify': ({ session, body }) => {
      const v = viewerOf(session);
      if (!v.user) throw new ApiError(401, '로그인이 필요합니다.');
      if (!isCompanyEmail(v.user.email)) {
        throw new ApiError(400, '회사 이메일로 가입한 계정만 인증할 수 있습니다. (개인 메일 도메인은 제외)');
      }
      const industry = limit(body.industry || '기타', '업종', 1, 12);
      const years = Math.max(0, Math.min(50, Number(body.years) || 0));
      store.updateUser(v.user.id, { verified: true, industry, years });
      return { me: meOf(store.findSession(session.token)) };
    },

    // ── 토크 ──────────────────────────────────────────────
    'GET /api/posts': ({ session, query }) => {
      const viewer = viewerOf(session);
      const category = query.get('category') || '';
      const sort = query.get('sort') || 'new';
      const q = (query.get('q') || '').trim().toLowerCase();

      let list = store.allPosts().filter((p) => canView(p, viewer) || p.visibility === 'private');
      // 비공개 글은 본인 것만 목록에 남긴다.
      list = list.filter((p) => p.visibility !== 'private' || isOwner(p, viewer));
      if (category) list = list.filter((p) => p.category === category);
      if (q) {
        list = list.filter((p) =>
          `${p.title} ${p.body} ${p.authorNick}`.toLowerCase().includes(q));
      }

      const score = (p) => p.reactions.same + p.reactions.pat + p.reactions.angry;
      const sorters = {
        new: (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
        hot: (a, b) => score(b) - score(a) || new Date(b.createdAt) - new Date(a.createdAt),
        comment: (a, b) => b.comments.length - a.comments.length || new Date(b.createdAt) - new Date(a.createdAt),
      };
      list = [...list].sort(sorters[sort] || sorters.new);

      return {
        posts: list.map((p) => publicPost(p, viewer, { withBody: false })),
        total: list.length,
        counts: CATEGORIES.map((c) => ({
          ...c,
          count: store.allPosts().filter((p) =>
            p.category === c.id && canView(p, viewer)).length,
        })),
      };
    },

    'POST /api/posts': ({ session, body }) => {
      const viewer = viewerOf(session);
      const me = meOf(session);

      const text = limit(body.body, '내용', 2, 4000);
      const category = need(body.category, '카테고리');
      if (!CATEGORIES.some((c) => c.id === category)) throw new ApiError(400, '없는 카테고리입니다.');

      const writeAs = String(body.writeAs || 'guest');
      if (!WRITE_MODES.includes(writeAs)) throw new ApiError(400, '알 수 없는 작성 방식입니다.');
      if (!me.writeModes.includes(writeAs)) {
        throw new ApiError(403, '지금 계정 상태에서는 선택할 수 없는 작성 방식입니다.');
      }

      const visibility = String(body.visibility || 'public');
      if (!VISIBILITIES.includes(visibility)) throw new ApiError(400, '알 수 없는 공개 범위입니다.');
      if (!me.visibilities.includes(visibility)) {
        throw new ApiError(403, '지금 계정 상태에서는 선택할 수 없는 공개 범위입니다.');
      }

      const author = resolveAuthor({ writeAs, user: viewer.user, guestNick: session.guestNick });
      if (!author) throw new ApiError(403, '작성 권한을 확인할 수 없습니다.');

      // 제목은 선택 — 비우면 본문 첫 줄을 제목으로 (진단서 08장)
      const rawTitle = String(body.title ?? '').trim();
      const title = rawTitle || autoTitle(text);

      // 비밀번호는 비공개 글을 다시 열 때만 반드시 필요하다.
      // 손님이 공개 글을 쓸 때까지 비밀번호를 요구하면 첫 행동의 문턱만 높아진다.
      // (같은 세션 안에서는 비밀번호 없이도 본인 글로 인식되어 지울 수 있다)
      let pw = { hash: null, salt: null };
      const given = String(body.password ?? '').trim();
      if (visibility === 'private') {
        pw = hashPassword(limit(given, '비밀번호', 4, 64));
      } else if (given) {
        pw = hashPassword(limit(given, '비밀번호', 4, 64));
      }

      const post = store.addPost({
        id: `post-${randomUUID().slice(0, 8)}`,
        title,
        body: text,
        category,
        authorMode: author.mode,
        authorNick: author.nick,
        authorUserId: author.userId,
        authorVerified: author.verified,
        sessionToken: author.userId ? null : session.token,
        visibility,
        passwordHash: pw.hash,
        salt: pw.salt,
        reactions: { same: 0, pat: 0, angry: 0 },
        reactedBy: {},
        views: 0,
        createdAt: new Date().toISOString(),
        comments: [],
        reports: [],
        hidden: false,
      });

      return { post: publicPost(post, viewer), warnings: screenContent(`${title} ${text}`) };
    },

    'GET /api/posts/:id': ({ session, params }) => {
      const viewer = viewerOf(session);
      const post = store.findPost(params.id);
      if (!post) throw new ApiError(404, '글을 찾을 수 없습니다.');
      if (!canView(post, viewer)) {
        return {
          post: publicPost(post, viewer),
          comments: [],
          denied: true,
          reason: post.visibility === 'private'
            ? '비공개 글입니다. 비밀번호를 입력하면 열람할 수 있습니다.'
            : post.visibility === 'verified'
              ? '인증 직장인만 볼 수 있는 글입니다.'
              : '로그인한 회원만 볼 수 있는 글입니다.',
        };
      }
      // 조회수는 세션당 한 번만
      if (!session.viewed.includes(post.id)) {
        session.viewed.push(post.id);
        post.views += 1;
        store.save();
      }
      return { post: publicPost(post, viewer), comments: post.comments.map(publicComment), denied: false };
    },

    'POST /api/posts/:id/unlock': ({ session, params, body }) => {
      const post = store.findPost(params.id);
      if (!post) throw new ApiError(404, '글을 찾을 수 없습니다.');
      if (post.visibility !== 'private') throw new ApiError(400, '비공개 글이 아닙니다.');
      const password = need(body.password, '비밀번호');
      if (!verifyPassword(password, post.passwordHash, post.salt)) {
        throw new ApiError(401, '비밀번호가 맞지 않습니다.');
      }
      if (!session.unlocked.includes(post.id)) session.unlocked.push(post.id);
      store.save();
      const viewer = viewerOf(store.findSession(session.token));
      return { post: publicPost(post, viewer), comments: post.comments.map(publicComment) };
    },

    'POST /api/posts/:id/comments': ({ session, params, body }) => {
      const viewer = viewerOf(session);
      const me = meOf(session);
      const post = store.findPost(params.id);
      if (!post) throw new ApiError(404, '글을 찾을 수 없습니다.');
      if (!canView(post, viewer)) throw new ApiError(403, '이 글에는 댓글을 쓸 수 없습니다.');

      const text = limit(body.body, '댓글', 1, 1000);
      const writeAs = String(body.writeAs || 'guest');
      if (!me.writeModes.includes(writeAs)) throw new ApiError(403, '선택할 수 없는 작성 방식입니다.');
      const author = resolveAuthor({ writeAs, user: viewer.user, guestNick: session.guestNick });
      if (!author) throw new ApiError(403, '작성 권한을 확인할 수 없습니다.');

      const comment = {
        id: `c-${randomUUID().slice(0, 8)}`,
        body: text,
        authorMode: author.mode,
        authorNick: author.nick,
        authorUserId: author.userId,
        authorVerified: author.verified,
        sessionToken: author.userId ? null : session.token,
        createdAt: new Date().toISOString(),
      };
      post.comments.push(comment);
      store.save();
      return { comment: publicComment(comment), warnings: screenContent(text) };
    },

    'POST /api/posts/:id/reactions': ({ session, params, body }) => {
      const viewer = viewerOf(session);
      const post = store.findPost(params.id);
      if (!post) throw new ApiError(404, '글을 찾을 수 없습니다.');
      if (!canView(post, viewer)) throw new ApiError(403, '볼 수 없는 글입니다.');
      const kind = need(body.reaction, '반응');
      if (!REACTIONS.some((r) => r.id === kind)) throw new ApiError(400, '없는 반응입니다.');

      if (!post.reactedBy) post.reactedBy = {};
      const key = viewer.userId || session.token;
      const already = Object.entries(post.reactedBy).find(([, list]) => list.includes(key));
      if (already) {
        // 같은 사람은 한 번만 — 다시 누르면 취소, 다른 걸 누르면 변경
        const [prev, list] = already;
        post.reactedBy[prev] = list.filter((k) => k !== key);
        post.reactions[prev] = Math.max(0, post.reactions[prev] - 1);
        if (prev === kind) {
          store.save();
          return { reactions: post.reactions, mine: null };
        }
      }
      if (!post.reactedBy[kind]) post.reactedBy[kind] = [];
      post.reactedBy[kind].push(key);
      post.reactions[kind] += 1;
      store.save();
      return { reactions: post.reactions, mine: kind };
    },

    'POST /api/posts/:id/report': ({ session, params, body }) => {
      const viewer = viewerOf(session);
      const post = store.findPost(params.id);
      if (!post) throw new ApiError(404, '글을 찾을 수 없습니다.');
      const key = viewer.userId || session.token;
      if (!post.reports) post.reports = [];
      if (post.reports.some((r) => r.by === key)) {
        throw new ApiError(409, '이미 신고한 글입니다.');
      }
      post.reports.push({
        by: key,
        reason: limit(body.reason || '기타', '신고 사유', 1, 200),
        at: new Date().toISOString(),
      });
      // 임시조치: 누적 신고가 기준을 넘으면 자동으로 가린다.
      if (post.reports.length >= HIDE_THRESHOLD) post.hidden = true;
      store.save();
      return { reportCount: post.reports.length, hidden: post.hidden, threshold: HIDE_THRESHOLD };
    },

    // ── 점심 ──────────────────────────────────────────────
    'GET /api/lunch': ({ session, query }) => {
      const region = query.get('region') || REGIONS[0].id;
      if (!REGIONS.some((r) => r.id === region)) throw new ApiError(400, '없는 지역입니다.');
      const votes = store.lunchVotes();
      const local = tallyLunch(votes, region);
      const nation = tallyLunch(votes, null);
      const mine = votes.find((v) => v.sessionToken === session.token && v.region === region);
      return {
        region,
        regionLabel: REGIONS.find((r) => r.id === region).label,
        total: local.total,
        nationTotal: nation.total,
        menuCount: local.menuCount,
        ranking: local.ranking.slice(0, 8),
        nationRanking: nation.ranking.slice(0, 3),
        myVote: mine ? mine.menu : null,
        updatedAt: new Date().toISOString(),
      };
    },

    'POST /api/lunch/vote': ({ session, body }) => {
      const region = need(body.region, '지역');
      if (!REGIONS.some((r) => r.id === region)) throw new ApiError(400, '없는 지역입니다.');
      const menu = need(body.menu, '메뉴');
      const found = ALL_MENUS.find((m) => m.menu === menu);
      if (!found) throw new ApiError(400, '없는 메뉴입니다.');

      const existing = store.lunchVotes().find(
        (v) => v.sessionToken === session.token && v.region === region);
      if (existing) {
        existing.menu = menu;
        existing.group = found.group;
        existing.at = new Date().toISOString();
        store.save();
      } else {
        store.addLunchVote({
          id: `vote-${randomUUID().slice(0, 8)}`,
          region, menu, group: found.group,
          sessionToken: session.token,
          at: new Date().toISOString(),
        });
      }
      const local = tallyLunch(store.lunchVotes(), region);
      return {
        ok: true, changed: !!existing, myVote: menu,
        total: local.total, ranking: local.ranking.slice(0, 8),
      };
    },

    // ── 숨돌리기 ──────────────────────────────────────────
    'GET /api/break': () => {
      const scores = store.breakScores();
      const board = {};
      for (const g of ['stamp', 'breath']) {
        board[g] = scores.filter((s) => s.game === g)
          .sort((a, b) => b.score - a.score).slice(0, 5);
      }
      return { board, played: scores.length };
    },

    'POST /api/break/score': ({ session, body }) => {
      const game = need(body.game, '게임');
      if (!['stamp', 'breath'].includes(game)) throw new ApiError(400, '없는 게임입니다.');
      const score = Math.max(0, Math.min(9999, Number(body.score) || 0));
      const viewer = viewerOf(session);
      const entry = store.addBreakScore({
        id: `bs-${randomUUID().slice(0, 8)}`,
        game, score,
        nick: viewer.user ? viewer.user.nickname : session.guestNick,
        at: new Date().toISOString(),
      });
      const ranked = store.breakScores().filter((s) => s.game === game)
        .sort((a, b) => b.score - a.score);
      return { entry, rank: ranked.findIndex((s) => s.id === entry.id) + 1, of: ranked.length };
    },

    // ── 퇴근 후 성장 ──────────────────────────────────────
    // 기존 사이트의 '오늘의 10분 · 자격증 연습 · 독서 기록' 세 칸을 그대로 가져왔다.
    'GET /api/grow': ({ session }) => growState(session),

    'POST /api/grow/goal': ({ session, body }) => {
      const key = keyOf(session);
      store.setGoal(key, limit(body.text, '목표', 1, 80));
      return growState(session);
    },

    'POST /api/grow/goal/done': ({ session, body }) => {
      const key = keyOf(session);
      if (!store.goalOf(key)) throw new ApiError(400, '먼저 오늘의 목표를 적어 주세요.');
      const today = todayStr();
      if (body.done === false) store.unmarkGoalDay(key, today);
      else store.markGoalDay(key, today);
      return growState(session);
    },

    // 채점은 서버에서 한다. 정답은 클라이언트로 나가지 않는다.
    'POST /api/grow/quiz': ({ session, body }) => {
      const key = keyOf(session);
      const answers = Array.isArray(body.answers) ? body.answers : null;
      if (!answers || answers.length !== QUIZ.length) {
        throw new ApiError(400, `${QUIZ.length}문제를 모두 풀어 주세요.`);
      }
      const results = QUIZ.map((q, i) => {
        const picked = Number(answers[i]);
        return {
          id: q.id,
          picked: Number.isInteger(picked) ? picked : -1,
          answer: q.answer,
          correct: picked === q.answer,
          explain: q.explain,
        };
      });
      const score = results.filter((r) => r.correct).length;
      store.addQuizAttempt({
        id: `qa-${randomUUID().slice(0, 8)}`,
        by: key, score, total: QUIZ.length, at: new Date().toISOString(),
      });
      return { score, total: QUIZ.length, results, grow: growState(session) };
    },

    'POST /api/grow/reading/:bookId': ({ session, params, body }) => {
      const key = keyOf(session);
      const book = BOOKS.find((b) => b.id === params.bookId);
      if (!book) throw new ApiError(404, '목록에 없는 책입니다.');

      const current = store.readingOf(key, book.id);
      // 총 쪽수는 카탈로그 값이 우선, 없으면 사용자가 입력한 값을 쓴다.
      let pages = book.pages ?? current?.pages ?? null;
      if (body.pages !== undefined && body.pages !== null && String(body.pages).trim() !== '') {
        const p = Number(body.pages);
        if (!Number.isInteger(p) || p < 1 || p > 20000) throw new ApiError(400, '총 쪽수를 올바르게 입력해 주세요.');
        pages = book.pages ?? p;
      }

      let page = current?.page ?? 0;
      if (body.page !== undefined && body.page !== null && String(body.page).trim() !== '') {
        const p = Number(body.page);
        if (!Number.isInteger(p) || p < 0) throw new ApiError(400, '읽은 쪽수를 올바르게 입력해 주세요.');
        page = p;
      } else if (body.delta !== undefined) {
        const d = Number(body.delta);
        if (!Number.isFinite(d)) throw new ApiError(400, '증가량이 올바르지 않습니다.');
        if (!pages) throw new ApiError(400, '총 쪽수를 먼저 입력해 주세요.');
        page = Math.round(page + (pages * d) / 100);
      }
      if (pages) page = Math.max(0, Math.min(pages, page));

      store.setReading(key, book.id, page, pages);
      return growState(session);
    },

    // ── 오늘(홈) ──────────────────────────────────────────
    'GET /api/today': ({ session, query }) => {
      const viewer = viewerOf(session);
      const region = query.get('region') || REGIONS[0].id;
      const lunch = tallyLunch(store.lunchVotes(), region);
      const visible = store.allPosts().filter((p) => canView(p, viewer));
      const score = (p) => p.reactions.same + p.reactions.pat + p.reactions.angry;
      return {
        region,
        regionLabel: (REGIONS.find((r) => r.id === region) || REGIONS[0]).label,
        lunchTop: lunch.ranking[0] || null,
        lunchTotal: lunch.total,
        hotPosts: [...visible].sort((a, b) => score(b) - score(a)).slice(0, 3)
          .map((p) => publicPost(p, viewer, { withBody: false })),
        latestPosts: [...visible].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
          .slice(0, 3).map((p) => publicPost(p, viewer, { withBody: false })),
        postCount: visible.length,
        grow: (() => {
          const g = growState(session);
          return {
            goalText: g.goal.text,
            goalDoneToday: g.goal.doneToday,
            goalStreak: g.goal.streak,
            quizBest: g.quiz.best,
            quizTotal: g.quiz.total,
            quizAttempts: g.quiz.attempts,
            trackedBooks: g.trackedBooks,
            bookCount: g.books.length,
          };
        })(),
      };
    },

    // 자동 필터 미리보기 (글쓰기 화면에서 실시간 안내)
    'POST /api/screen': ({ body }) => ({ warnings: screenContent(body.text || '') }),
  };

  return { routes, ensureSession, viewerOf, meOf };
}
