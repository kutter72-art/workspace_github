// 신원(누구로 쓰는가)과 공개 범위(누가 볼 수 있는가)를 다루는 핵심 로직.
// 진단서 07장의 2축 모델을 그대로 구현한다.

import { randomBytes, scryptSync, timingSafeEqual, randomUUID } from 'node:crypto';

// ── 신원 4단계 ────────────────────────────────────────────────
// L0  guest   : 가입 없이. 세션 동안 임시 닉네임 자동 부여
// L1  account : 로그인. 고정 닉네임 + 알림 + 모아보기
// L1+ mask    : 로그인 상태에서 익명으로 쓰기 ("가면")
// L2  badge   : 회사 이메일 인증 배지로 쓰기
export const WRITE_MODES = ['guest', 'account', 'mask', 'badge'];

// ── 공개 범위 4단계 ───────────────────────────────────────────
export const VISIBILITIES = ['public', 'members', 'verified', 'private'];

export const VISIBILITY_LABEL = {
  public: '전체 공개',
  members: '회원 공개',
  verified: '인증 직장인만',
  private: '비공개',
};

export const CATEGORIES = [
  { id: 'boss', label: '상사' },
  { id: 'coworker', label: '동료' },
  { id: 'overtime', label: '야근' },
  { id: 'pay', label: '월급' },
  { id: 'move', label: '이직' },
  { id: 'etc', label: '그냥' },
];

export const REACTIONS = [
  { id: 'same', label: '나도그래' },
  { id: 'pat', label: '토닥토닥' },
  { id: 'angry', label: '화나네' },
];

const GUEST_ADJ = ['조용한', '바쁜', '지친', '커피찾는', '퇴근하는', '점심고민', '야근중인', '월요일의'];
const GUEST_NOUN = ['직장인', '대리', '사원', '과장', '주임', '연구원', '개발자', '기획자'];

export function makeGuestNick() {
  const a = GUEST_ADJ[Math.floor(Math.random() * GUEST_ADJ.length)];
  const n = GUEST_NOUN[Math.floor(Math.random() * GUEST_NOUN.length)];
  const d = Math.floor(Math.random() * 900) + 100;
  return `${a}${n}${d}`;
}

// ── 비밀번호 ─────────────────────────────────────────────────
export function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const hash = scryptSync(String(password), salt, 32).toString('hex');
  return { hash, salt };
}

export function verifyPassword(password, hash, salt) {
  if (!hash || !salt) return false;
  const candidate = scryptSync(String(password), salt, 32);
  const expected = Buffer.from(hash, 'hex');
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

export function makeToken() {
  return randomUUID().replace(/-/g, '');
}

// ── 인증 직장인 판정 ──────────────────────────────────────────
// 개인 메일 도메인은 회사 이메일로 보지 않는다.
const PERSONAL_DOMAINS = new Set([
  'gmail.com', 'naver.com', 'daum.net', 'hanmail.net', 'kakao.com',
  'nate.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'icloud.com',
]);

export function isCompanyEmail(email) {
  const at = String(email || '').split('@');
  if (at.length !== 2) return false;
  const domain = at[1].trim().toLowerCase();
  if (!domain.includes('.')) return false;
  return !PERSONAL_DOMAINS.has(domain);
}

// ── 작성자 표시 이름 결정 ────────────────────────────────────
// 서버가 결정한다. 클라이언트가 보낸 닉네임을 그대로 믿지 않는다.
export function resolveAuthor({ writeAs, user, guestNick }) {
  switch (writeAs) {
    case 'account':
      if (!user) return null;
      return { mode: 'account', nick: user.nickname, userId: user.id, verified: !!user.verified };
    case 'badge':
      if (!user || !user.verified) return null;
      return {
        mode: 'badge',
        nick: `${user.industry || '직장인'} ${user.years || ''}년차`.trim(),
        userId: user.id,
        verified: true,
      };
    case 'mask':
      // 가면: 계정은 연결해 두되(신고 시 추적 가능) 표시는 완전 익명.
      // 인증 배지를 함께 달면 "익명 + 인증 직장인"으로 대상이 좁혀져
      // 익명성이 약해지므로, 배지가 필요하면 badge 모드를 쓰게 한다.
      if (!user) return null;
      return { mode: 'mask', nick: '익명', userId: user.id, verified: false };
    case 'guest':
    default:
      return { mode: 'guest', nick: guestNick || makeGuestNick(), userId: null, verified: false };
  }
}

// ── 열람 권한 판정 ───────────────────────────────────────────
// 이 함수 하나가 공개 범위 4단계 전체를 책임진다.
export function canView(post, viewer) {
  if (!post) return false;
  if (post.hidden) {
    // 신고로 가려진 글은 작성자 본인만 볼 수 있다.
    return isOwner(post, viewer);
  }

  switch (post.visibility) {
    case 'public':
      return true;
    case 'members':
      return !!(viewer && viewer.userId);
    case 'verified':
      return !!(viewer && viewer.userId && viewer.verified);
    case 'private':
      return isOwner(post, viewer) || !!(viewer && viewer.unlocked && viewer.unlocked.includes(post.id));
    default:
      return false;
  }
}

export function isOwner(post, viewer) {
  if (!post || !viewer) return false;
  if (post.authorUserId && viewer.userId && post.authorUserId === viewer.userId) return true;
  if (!post.authorUserId && post.sessionToken && viewer.token && post.sessionToken === viewer.token) return true;
  return false;
}

// 목록/상세로 내보내기 전에 비밀 정보를 제거한다.
// 열람 권한이 없으면 공개 범위 종류와 무관하게 본문·제목·발췌를 모두 지운다.
// (private만 가렸다가 members/verified 글의 본문이 새어 나간 결함을 여기서 막는다)
export function publicPost(post, viewer, { withBody = true } = {}) {
  const locked = !canView(post, viewer);
  const lockedTitle = post.visibility === 'private'
    ? '비공개 글입니다'
    : '공개 범위가 제한된 글입니다';
  return {
    id: post.id,
    title: locked ? lockedTitle : post.title,
    body: locked || !withBody ? null : post.body,
    excerpt: locked ? null : String(post.body || '').slice(0, 80),
    category: post.category,
    authorNick: post.authorNick,
    authorMode: post.authorMode,
    verified: !!post.authorVerified,
    visibility: post.visibility,
    locked,
    reactions: post.reactions,
    commentCount: (post.comments || []).length,
    views: post.views,
    createdAt: post.createdAt,
    mine: isOwner(post, viewer),
    reportCount: (post.reports || []).length,
    hidden: !!post.hidden,
  };
}

export function publicComment(comment) {
  return {
    id: comment.id,
    body: comment.body,
    authorNick: comment.authorNick,
    authorMode: comment.authorMode,
    verified: !!comment.authorVerified,
    createdAt: comment.createdAt,
  };
}
