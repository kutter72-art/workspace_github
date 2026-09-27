// 클라이언트 — 실제 경로 기반 라우팅 (iframe 없음, History API)
// 아이콘은 전부 SVG. 이모지를 구조 아이콘으로 쓰지 않는다 (진단서 F-06).

/* ───────── 아이콘 ───────── */
const S = (d, extra = '') =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
        stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${d}${extra}</svg>`;

const ICONS = {
  today: S('<circle cx="12" cy="12" r="8"/><path d="M12 8v4l2.5 2"/>'),
  lunch: S('<path d="M5 3v8a3 3 0 0 0 3 3v7"/><path d="M8 3v6"/><path d="M11 3v6"/><path d="M17 3c-1.5 2-2 4-2 6s.7 3 2 3h2V3z"/><path d="M19 12v9"/>'),
  talk: S('<path d="M20 14a2 2 0 0 1-2 2H8l-4 3V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z"/>'),
  break: S('<path d="M4 19h13a3 3 0 0 0 0-6h-1"/><path d="M4 13h12v6"/><path d="M8 4v3M11 3v4M14 4v3"/>'),
  grow: S('<path d="M12 21V9"/><path d="M12 12c0-3 2-6 6-6 0 4-3 6-6 6z"/><path d="M12 15c0-2.6-1.8-5-5-5 0 3.4 2.4 5 5 5z"/>'),
  theme: S('<circle cx="12" cy="12" r="4.5"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/>'),
  close: S('<path d="M6 6l12 12M18 6L6 18"/>'),
  check: S('<path d="M4 12.5l5 5L20 6.5"/>'),
  lock: S('<rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>'),
  shield: S('<path d="M12 3l7 3v6c0 4.4-3 7.7-7 9-4-1.3-7-4.6-7-9V6z"/><path d="M9 12l2 2 4-4"/>'),
  flag: S('<path d="M5 21V4"/><path d="M5 5h11l-2 3.5L16 12H5"/>'),
  back: S('<path d="M15 5l-7 7 7 7"/>'),
  pencil: S('<path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z"/><path d="M15 6l3 3"/>'),
  search: S('<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/>'),
  empty: S('<rect x="3.5" y="6" width="17" height="13" rx="2.5"/><path d="M3.5 10h17"/><path d="M9 15h6"/>'),
  spark: S('<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/>'),
  users: S('<circle cx="9" cy="9" r="3.2"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><path d="M16 6.3a3.2 3.2 0 0 1 0 5.4"/><path d="M17.5 14.5a5.5 5.5 0 0 1 3 4.5"/>'),
};

const icon = (n) => ICONS[n] || '';

/* ───────── 유틸 ───────── */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 줄바꿈 보존 + 이스케이프
function multiline(v) {
  return esc(v).replace(/\n/g, '<br>');
}

function ago(iso) {
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const m = Math.floor(diff / 60000);
  if (m < 1) return '방금 전';
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}일 전`;
  return new Date(iso).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: options.body ? { 'Content-Type': 'application/json' } : {},
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch { /* 본문 없는 응답 */ }
  if (!res.ok) throw new Error(data.error || `요청에 실패했습니다. (${res.status})`);
  return data;
}

function toast(message, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind ? 'is-error' : ''}`.trim();
  el.textContent = message;
  $('#toastStack').append(el);
  setTimeout(() => el.remove(), 4000);
}

/* ───────── 전역 상태 ───────── */
const state = {
  me: null,
  meta: null,
  region: localStorage.getItem('region') || 'yeoksam',
  talkFilter: { category: '', sort: 'new', q: '' },
};

/* ───────── 시트 ───────── */
// aria-modal 을 선언했으면 실제로 배경을 못 만지게 해야 한다.
// 배경에 inert 를 걸고, Tab 이 시트 밖으로 새지 않도록 순환시킨다.
const BACKDROP_TARGETS = ['.topbar', '#view', '.bottomnav', '.sitefoot', '.skip-link'];
let lastFocused = null;

function setBackgroundInert(on) {
  BACKDROP_TARGETS.forEach((sel) => {
    const el = $(sel);
    if (!el) return;
    if (on) el.setAttribute('inert', '');
    else el.removeAttribute('inert');
  });
}

function sheetFocusables() {
  return $$('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])', $('#sheet'))
    .filter((el) => !el.disabled && el.getClientRects().length);
}

function openSheet(title, html, onMount) {
  lastFocused = document.activeElement;
  $('#sheetTitle').textContent = title;
  $('#sheetBody').innerHTML = html;
  $('#sheet').hidden = false;
  $('#sheetBackdrop').hidden = false;
  document.body.style.overflow = 'hidden';
  setBackgroundInert(true);
  if (onMount) onMount($('#sheetBody'));
  const first = $('#sheetBody').querySelector('textarea, input:not([type=hidden]), select, button');
  (first || $('#sheetClose')).focus();
}

function closeSheet() {
  if ($('#sheet').hidden) return;
  $('#sheet').hidden = true;
  $('#sheetBackdrop').hidden = true;
  $('#sheetBody').innerHTML = '';
  document.body.style.overflow = '';
  setBackgroundInert(false);
  // 열기 전에 있던 자리로 초점을 돌려준다
  if (lastFocused && lastFocused.isConnected) lastFocused.focus();
  lastFocused = null;
}

$('#sheetClose').addEventListener('click', closeSheet);
$('#sheetBackdrop').addEventListener('click', closeSheet);

document.addEventListener('keydown', (e) => {
  if ($('#sheet').hidden) return;
  if (e.key === 'Escape') { closeSheet(); return; }
  if (e.key !== 'Tab') return;

  const items = sheetFocusables();
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault(); last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault(); first.focus();
  } else if (!$('#sheet').contains(document.activeElement)) {
    e.preventDefault(); first.focus();
  }
});

/* ───────── 공통 조각 ───────── */
function visBadge(v) {
  const map = {
    public: '전체 공개', members: '회원 공개',
    verified: '인증 직장인만', private: '비공개',
  };
  const cls = v === 'private' ? 'badge-lock' : 'badge-vis';
  const ic = v === 'private' || v === 'verified' ? icon('lock') : '';
  return `<span class="badge ${cls}">${ic}${esc(map[v] || v)}</span>`;
}

function authorLine(p) {
  const verified = p.verified ? `<span class="badge badge-verified">${icon('shield')}인증</span>` : '';
  const mode = { guest: '손님', account: '아이디', mask: '가면', badge: '인증 배지' }[p.authorMode] || '';
  return `<span>${esc(p.authorNick)}</span>${verified}<span title="작성 방식">${esc(mode)}</span>`;
}

function postCard(p) {
  const cat = (state.meta?.categories || []).find((c) => c.id === p.category);
  return `
    <a class="postcard ${p.locked ? 'is-locked' : ''}" href="/talk/${esc(p.id)}" data-link>
      <div class="row" style="gap:var(--s2)">
        ${cat ? `<span class="badge badge-vis">${esc(cat.label)}</span>` : ''}
        ${visBadge(p.visibility)}
        ${p.mine ? '<span class="badge badge-verified">내 글</span>' : ''}
      </div>
      <h3>${esc(p.title)}</h3>
      ${p.excerpt ? `<p class="excerpt">${esc(p.excerpt)}${p.excerpt.length >= 80 ? '…' : ''}</p>` : ''}
      <div class="metaline">
        ${authorLine(p)}
        <span>${esc(ago(p.createdAt))}</span>
        <span class="num">댓글 ${p.commentCount}</span>
        <span class="num">조회 ${p.views}</span>
      </div>
    </a>`;
}

function emptyState(title, body, actionHtml = '') {
  return `<div class="empty">${icon('empty')}<h3>${esc(title)}</h3><p>${esc(body)}</p>${actionHtml}</div>`;
}

function skeleton() {
  return `<div class="skeleton-page" aria-hidden="true">
    <div class="sk sk-title"></div><div class="sk sk-line"></div>
    <div class="sk sk-card"></div><div class="sk sk-card"></div></div>`;
}

/* ───────── 신원 표시 ───────── */
function paintIdentity() {
  const me = state.me;
  if (!me) return;
  $('#identityLevel').textContent = me.level;
  $('#identityNick').textContent = me.nickname;
  $('#identityChip').setAttribute(
    'aria-label',
    `내 서랍 — 현재 ${me.level} ${me.loggedIn ? '로그인' : '손님'}, 닉네임 ${me.nickname}`);
}

/* ───────── 뷰: 오늘 ───────── */
async function viewToday(root) {
  root.innerHTML = skeleton();
  const d = await api(`/api/today?region=${encodeURIComponent(state.region)}`);
  const region = (state.meta.regions || []).find((r) => r.id === d.region);

  root.dataset.tabcolor = 'today';

  // 아무 기록도 없는 상태에서 0만 늘어놓으면 고장난 화면처럼 보인다.
  // 첫 방문이면 숫자 대신 할 일을 보여준다.
  const noGrowRecord = !d.grow.goalText && d.grow.goalStreak === 0
    && d.grow.quizAttempts === 0 && d.grow.trackedBooks === 0;
  const brandNew = d.lunchTotal === 0 && d.postCount === 0 && noGrowRecord;
  if (brandNew) {
    root.innerHTML = `
      <div class="page-head">
        <span class="eyebrow">오늘</span>
        <h1>${esc(region ? region.label : d.regionLabel)}의 오늘</h1>
        <p>점심으로 만나서, 고민을 나누고, 한숨 돌리고, 같이 조금 자라는 곳.</p>
      </div>

      <div class="card stack">
        <div class="stack-s">
          <h2>아직 아무 기록도 없습니다</h2>
          <p class="caption">
            여기 보이는 숫자는 전부 실제 기록에서 계산합니다.
            미리 채워 둔 값이 없으므로, 첫 기록은 직접 남기셔야 합니다.
          </p>
        </div>
        <div class="startlist">
          <a class="startitem" href="/lunch" data-link>
            <span class="startitem-ic">${icon('lunch')}</span>
            <span class="startitem-tx"><strong>점심 한 표 보태기</strong><small>10초면 됩니다. 순위가 여기서 만들어져요.</small></span>
          </a>
          <button type="button" class="startitem" id="startWrite">
            <span class="startitem-ic">${icon('talk')}</span>
            <span class="startitem-tx"><strong>첫 글 남기기</strong><small>익명으로 써도 됩니다. 로그인도 필요 없어요.</small></span>
          </button>
          <a class="startitem" href="/grow" data-link>
            <span class="startitem-ic">${icon('grow')}</span>
            <span class="startitem-tx"><strong>퇴근 후 10분</strong><small>전기 3문제 풀거나, 읽던 책 몇 쪽 기록하기.</small></span>
          </a>
        </div>
      </div>`;
    $('#startWrite').addEventListener('click', openWriteSheet);
    return;
  }

  root.innerHTML = `
    <div class="page-head">
      <span class="eyebrow">오늘</span>
      <h1>${esc(region ? region.label : d.regionLabel)}의 오늘</h1>
      <p>점심으로 만나서, 고민을 나누고, 한숨 돌리고, 같이 조금 자라는 곳.</p>
      <div class="row"><button type="button" class="btn" id="homeWriteBtn">${icon('pencil')}글쓰기</button></div>
    </div>

    <div class="stack-l">
      <div class="tiles">
        <div class="tile">
          <span class="v num">${d.lunchTotal}</span>
          <span class="k">오늘 점심 투표</span>
          <span class="s">${esc(d.regionLabel)} 기준</span>
        </div>
        <div class="tile">
          <span class="v">${d.lunchTop ? esc(d.lunchTop.menu) : '—'}</span>
          <span class="k">지금 1위</span>
          <span class="s num">${d.lunchTop ? `${d.lunchTop.share}% · ${d.lunchTop.count}표` : '아직 표가 없어요'}</span>
        </div>
        <div class="tile">
          <span class="v num">${d.postCount}</span>
          <span class="k">내가 볼 수 있는 글</span>
          <span class="s">공개 범위에 따라 달라져요</span>
        </div>
        <div class="tile">
          <span class="v num">${d.grow.quizAttempts > 0 ? `${d.grow.quizBest}/${d.grow.quizTotal}` : '—'}</span>
          <span class="k">자격증 최고</span>
          <span class="s">${d.grow.trackedBooks > 0
            ? `책 ${d.grow.trackedBooks}권 기록 중`
            : `${d.grow.goalDoneToday ? '오늘 10분 완료' : '퇴근 후 성장'}`}</span>
        </div>
      </div>

      <section class="stack">
        <div class="spread">
          <h2>지금 반응이 많은 글</h2>
          <a href="/talk" data-link class="btn-quiet btn-sm">토크 전체</a>
        </div>
        ${d.hotPosts.length
          ? `<div class="postlist">${d.hotPosts.map(postCard).join('')}</div>`
          : emptyState('아직 글이 없어요', '첫 글을 남기면 여기에 보입니다.',
              '<button type="button" class="btn" data-write>글쓰기</button>')}
      </section>

      <section class="stack">
        <div class="spread">
          <h2>방금 올라온 글</h2>
        </div>
        ${d.latestPosts.length
          ? `<div class="postlist">${d.latestPosts.map(postCard).join('')}</div>`
          : emptyState('아직 글이 없어요', '첫 글을 남겨 보세요.',
              '<button type="button" class="btn" data-write>글쓰기</button>')}
      </section>
    </div>`;

  $('#homeWriteBtn').addEventListener('click', openWriteSheet);
  root.querySelectorAll('[data-write]').forEach((b) => b.addEventListener('click', openWriteSheet));
}

/* ───────── 뷰: 점심 ───────── */
async function viewLunch(root) {
  root.innerHTML = skeleton();
  const d = await api(`/api/lunch?region=${encodeURIComponent(state.region)}`);
  const max = d.ranking[0]?.count || 1;

  root.dataset.tabcolor = 'lunch';
  root.innerHTML = `
    <div class="page-head">
      <span class="eyebrow">점심</span>
      <h1>지금 ${esc(d.regionLabel)} 직장인들은 뭐 먹지?</h1>
      <p>아래 순위는 저장된 표를 매번 다시 세어 만듭니다. 고정된 숫자가 아닙니다.</p>
    </div>

    <div class="stack-l">
      <section class="card stack">
        <div class="field">
          <label for="regionSel">회사 근처 지역</label>
          <select id="regionSel">
            ${state.meta.regions.map((r) =>
              `<option value="${esc(r.id)}" ${r.id === d.region ? 'selected' : ''}>${esc(r.label)} · ${esc(r.city)}</option>`).join('')}
          </select>
        </div>
        <div class="tiles">
          <div class="tile"><span class="v num">${d.total}</span><span class="k">이 지역 표</span></div>
          <div class="tile"><span class="v num">${d.nationTotal}</span><span class="k">전체 표</span></div>
          <div class="tile"><span class="v num">${d.menuCount}</span><span class="k">선택된 메뉴 종류</span></div>
        </div>
      </section>

      <section class="stack">
        <h2>실시간 순위</h2>
        ${d.total === 0
          ? emptyState('이 지역은 아직 조용해요', '첫 표를 보태면 순위가 만들어집니다.')
          : `<div class="card rank">${d.ranking.map((r, i) => `
              <div class="rank-row ${i === 0 ? 'top' : ''}">
                <span class="pos num">${i + 1}</span>
                <span class="rank-bar">
                  <span class="nm">${esc(r.menu)}</span>
                  <span class="rank-track"><span class="rank-fill" style="width:${Math.round((r.count / max) * 100)}%"></span></span>
                </span>
                <span class="val num">${r.share}% · ${r.count}표</span>
              </div>`).join('')}</div>`}
      </section>

      <section class="stack">
        <h2>내 점심 한 표</h2>
        <p class="caption">${d.myVote ? `지금 선택: <strong>${esc(d.myVote)}</strong> — 다시 고르면 바뀝니다.` : '카테고리를 고르고 메뉴를 선택하세요.'}</p>
        <div class="card stack" id="voteBox">
          ${state.meta.menuGroups.map((g) => `
            <div class="stack-s">
              <h4>${esc(g.label)}</h4>
              <div class="chips">
                ${g.items.map((m) => `
                  <button type="button" class="chip ${d.myVote === m ? 'is-on' : ''}"
                          data-vote="${esc(m)}" aria-pressed="${d.myVote === m}">${esc(m)}</button>`).join('')}
              </div>
            </div>`).join('')}
        </div>
      </section>

      <section class="stack">
        <h2>전국 TOP 3</h2>
        <div class="grid grid-3">
          ${d.nationRanking.map((r, i) => `
            <div class="card">
              <span class="caption num">전국 ${i + 1}위</span>
              <h3>${esc(r.menu)}</h3>
              <span class="caption num">${r.share}% · ${r.count}표</span>
            </div>`).join('')}
        </div>
      </section>
    </div>`;

  $('#regionSel').addEventListener('change', (e) => {
    state.region = e.target.value;
    localStorage.setItem('region', state.region);
    render();
  });

  root.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-vote]');
    if (!btn) return;
    try {
      const r = await api('/api/lunch/vote', {
        method: 'POST',
        body: { region: state.region, menu: btn.dataset.vote },
      });
      toast(r.changed ? `${btn.dataset.vote}(으)로 바꿨습니다.` : `${btn.dataset.vote}에 한 표 보탰습니다.`);
      render();
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

/* ───────── 뷰: 토크 목록 ───────── */
async function viewTalk(root) {
  root.innerHTML = skeleton();
  const f = state.talkFilter;
  const qs = new URLSearchParams({ category: f.category, sort: f.sort, q: f.q });
  const d = await api(`/api/posts?${qs}`);

  root.dataset.tabcolor = 'talk';
  root.innerHTML = `
    <div class="page-head">
      <span class="eyebrow">토크</span>
      <h1>회사 이야기</h1>
      <p>실명·부서·직급 등 특정 개인을 알아볼 수 있는 정보는 삼가주세요.</p>
    </div>

    <div class="stack-l">
      <section class="stack">
        <div class="spread">
          <div class="row">
            <label class="visually-hidden" for="searchInput">검색</label>
            <input id="searchInput" type="text" placeholder="제목·내용 검색"
                   value="${esc(f.q)}" style="min-height:44px;padding:0 var(--s3);border:1px solid var(--line-strong);border-radius:var(--r-chip);background:var(--surface);font-size:16px;max-width:220px">
            <button type="button" class="btn-quiet btn-sm" id="searchBtn">${icon('search')}검색</button>
          </div>
          <button type="button" class="btn" id="writeBtn">${icon('pencil')}글쓰기</button>
        </div>

        <div class="chips">
          <button type="button" class="chip ${!f.category ? 'is-on' : ''}" data-cat="">전체</button>
          ${d.counts.map((c) => `
            <button type="button" class="chip ${f.category === c.id ? 'is-on' : ''}" data-cat="${esc(c.id)}">
              ${esc(c.label)} <span class="num" style="opacity:.75">${c.count}</span>
            </button>`).join('')}
        </div>

        <div class="chips">
          ${[['new', '최신순'], ['hot', '공감순'], ['comment', '댓글순']].map(([id, label]) => `
            <button type="button" class="chip ${f.sort === id ? 'is-on' : ''}" data-sort="${id}">${label}</button>`).join('')}
        </div>
      </section>

      <section class="stack">
        <p class="caption num">${d.total}개의 글</p>
        ${d.posts.length
          ? `<div class="postlist">${d.posts.map(postCard).join('')}</div>`
          : (f.q || f.category)
            ? emptyState('조건에 맞는 글이 없어요', '검색어나 카테고리를 바꿔 보세요.',
                '<button type="button" class="btn-quiet" data-clear>조건 지우기</button>')
            : emptyState('아직 올라온 글이 없어요',
                '익명으로 써도 됩니다. 로그인도 필요 없어요.',
                '<button type="button" class="btn" data-write>첫 글 남기기</button>')}
      </section>
    </div>`;

  $('#writeBtn').addEventListener('click', openWriteSheet);
  root.querySelectorAll('[data-write]').forEach((b) => b.addEventListener('click', openWriteSheet));
  root.querySelectorAll('[data-clear]').forEach((b) => b.addEventListener('click', () => {
    state.talkFilter = { category: '', sort: 'new', q: '' };
    render();
  }));
  $('#searchBtn').addEventListener('click', () => {
    state.talkFilter.q = $('#searchInput').value.trim();
    render();
  });
  $('#searchInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { state.talkFilter.q = e.target.value.trim(); render(); }
  });
  root.addEventListener('click', (e) => {
    const cat = e.target.closest('[data-cat]');
    if (cat) { state.talkFilter.category = cat.dataset.cat; render(); return; }
    const sort = e.target.closest('[data-sort]');
    if (sort) { state.talkFilter.sort = sort.dataset.sort; render(); }
  });
}

/* ───────── 뷰: 글 상세 ───────── */
async function viewPost(root, id) {
  root.innerHTML = skeleton();
  const d = await api(`/api/posts/${encodeURIComponent(id)}`);
  const p = d.post;
  root.dataset.tabcolor = 'talk';

  if (d.denied) {
    root.innerHTML = `
      <a href="/talk" data-link class="btn-quiet btn-sm">${icon('back')}목록</a>
      <div class="stack" style="margin-top:var(--s4)">
        ${emptyState('이 글은 지금 볼 수 없어요', d.reason)}
        ${p.visibility === 'private' ? `
          <form class="card stack" id="unlockForm">
            <div class="field">
              <label for="unlockPw">비밀번호</label>
              <input id="unlockPw" type="password" autocomplete="off" placeholder="글을 쓸 때 정한 비밀번호">
            </div>
            <button class="btn" type="submit">${icon('lock')}열어보기</button>
          </form>` : ''}
        ${p.visibility === 'members' || p.visibility === 'verified' ? `
          <button type="button" class="btn" id="loginPrompt">로그인하기</button>` : ''}
      </div>`;

    const form = $('#unlockForm');
    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
          await api(`/api/posts/${encodeURIComponent(id)}/unlock`, {
            method: 'POST', body: { password: $('#unlockPw').value },
          });
          toast('열었습니다.');
          render();
        } catch (err) { toast(err.message, 'error'); }
      });
    }
    const lp = $('#loginPrompt');
    if (lp) lp.addEventListener('click', openLoginSheet);
    return;
  }

  const cat = (state.meta.categories || []).find((c) => c.id === p.category);
  root.innerHTML = `
    <a href="/talk" data-link class="btn-quiet btn-sm">${icon('back')}목록</a>

    <article class="card stack" style="margin-top:var(--s4)">
      <div class="row">
        ${cat ? `<span class="badge badge-vis">${esc(cat.label)}</span>` : ''}
        ${visBadge(p.visibility)}
        ${p.mine ? '<span class="badge badge-verified">내 글</span>' : ''}
      </div>
      <h1>${esc(p.title)}</h1>
      <div class="metaline caption row">
        ${authorLine(p)}<span>${esc(ago(p.createdAt))}</span>
        <span class="num">조회 ${p.views}</span>
      </div>
      <div style="font-size:16px;line-height:1.8">${multiline(p.body)}</div>

      <div class="reactline">
        ${state.meta.reactions.map((r) => `
          <button type="button" class="react-btn" data-react="${esc(r.id)}" aria-pressed="false">
            ${esc(r.label)} <span class="n num">${p.reactions[r.id]}</span>
          </button>`).join('')}
        <button type="button" class="react-btn" id="reportBtn">${icon('flag')}신고</button>
      </div>
    </article>

    <section class="stack" style="margin-top:var(--s5)">
      <h2 class="num">댓글 ${d.comments.length}</h2>
      ${d.comments.length ? d.comments.map((c) => `
        <div class="card card-tight stack-s">
          <div class="metaline caption row">
            <span>${esc(c.authorNick)}</span>
            ${c.verified ? `<span class="badge badge-verified">${icon('shield')}인증</span>` : ''}
            <span>${esc(ago(c.createdAt))}</span>
          </div>
          <div>${multiline(c.body)}</div>
        </div>`).join('')
        : emptyState('첫 댓글을 남겨 보세요', '짧은 한마디도 큰 힘이 됩니다.')}

      <form class="card stack" id="commentForm">
        <div class="field">
          <label for="commentBody">댓글</label>
          <textarea id="commentBody" style="min-height:88px" placeholder="어떻게 생각하세요?" required></textarea>
        </div>
        <div class="field">
          <label>누구로 쓸까요</label>
          <div class="radio-row" id="commentAs">
            ${writeModeOptions('cmt')}
          </div>
        </div>
        <button class="btn" type="submit">댓글 등록</button>
      </form>
    </section>`;

  root.querySelectorAll('[data-react]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        const r = await api(`/api/posts/${encodeURIComponent(id)}/reactions`, {
          method: 'POST', body: { reaction: btn.dataset.react },
        });
        root.querySelectorAll('[data-react]').forEach((b) => {
          b.querySelector('.n').textContent = r.reactions[b.dataset.react];
          b.setAttribute('aria-pressed', String(r.mine === b.dataset.react));
        });
      } catch (err) { toast(err.message, 'error'); }
    });
  });

  $('#reportBtn').addEventListener('click', async () => {
    try {
      const r = await api(`/api/posts/${encodeURIComponent(id)}/report`, {
        method: 'POST', body: { reason: '부적절한 내용' },
      });
      toast(r.hidden
        ? `신고 ${r.reportCount}건 — 기준(${r.threshold}건)을 넘어 임시로 가려졌습니다.`
        : `신고했습니다. (누적 ${r.reportCount}건 / 기준 ${r.threshold}건)`);
    } catch (err) { toast(err.message, 'error'); }
  });

  root.querySelectorAll('[data-open-login]').forEach((btn) => {
    btn.addEventListener('click', openLoginSheet);
  });

  $('#commentForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const writeAs = $('#commentAs input:checked')?.value || state.me.writeModes[0];
    try {
      const r = await api(`/api/posts/${encodeURIComponent(id)}/comments`, {
        method: 'POST', body: { body: $('#commentBody').value, writeAs },
      });
      if (r.warnings?.length) r.warnings.forEach((w) => toast(w, 'error'));
      toast('댓글을 등록했습니다.');
      render();
    } catch (err) { toast(err.message, 'error'); }
  });
}

/* ───────── 뷰: 숨돌리기 ───────── */
async function viewBreak(root) {
  root.innerHTML = skeleton();
  const d = await api('/api/break');
  root.dataset.tabcolor = 'break';

  root.innerHTML = `
    <div class="page-head">
      <span class="eyebrow">숨돌리기</span>
      <h1>1분만 딴생각하고 돌아오기</h1>
      <p>잘하지 않아도 됩니다. 손만 움직이면 됩니다.</p>
    </div>

    <div class="stack-l">
      <section class="card stack">
        <div class="spread">
          <h2>도장 깨기</h2>
          <span class="caption">20초 · 켜진 칸을 누르세요</span>
        </div>
        <div class="row">
          <button type="button" class="btn" id="stampStart">시작</button>
          <span class="caption num" id="stampStatus">대기 중</span>
        </div>
        <div class="stampgrid" id="stampGrid">
          ${Array.from({ length: 16 }, (_, i) =>
            `<button type="button" class="stampcell" data-cell="${i}" aria-label="칸 ${i + 1}">${icon('check')}</button>`).join('')}
        </div>
      </section>

      <section class="card stack">
        <div class="spread">
          <h2>숨 고르기</h2>
          <span class="caption">4초 들이쉬고 4초 내쉬기</span>
        </div>
        <div class="breather">
          <div class="breath-orb is-out" id="breathOrb">준비</div>
          <button type="button" class="btn" id="breathStart">6번 호흡 시작</button>
        </div>
      </section>

      <section class="stack">
        <h2>오늘의 기록</h2>
        <div class="grid grid-2">
          ${[['stamp', '도장 깨기'], ['breath', '숨 고르기']].map(([g, label]) => `
            <div class="card stack-s">
              <h3>${label}</h3>
              ${d.board[g].length
                ? `<div class="rank">${d.board[g].map((s, i) => `
                    <div class="rank-row">
                      <span class="pos num">${i + 1}</span>
                      <span class="rank-bar"><span class="nm">${esc(s.nick)}</span></span>
                      <span class="val num">${s.score}</span>
                    </div>`).join('')}</div>`
                : '<p class="caption">아직 기록이 없어요.</p>'}
            </div>`).join('')}
        </div>
      </section>
    </div>`;

  // 도장 깨기
  let live = -1, hits = 0, timer = null, tick = null;
  const grid = $('#stampGrid');
  const status = $('#stampStatus');

  function litUp() {
    grid.querySelectorAll('.stampcell').forEach((c) => c.classList.remove('is-live'));
    live = Math.floor(Math.random() * 16);
    grid.querySelector(`[data-cell="${live}"]`).classList.add('is-live');
  }

  $('#stampStart').addEventListener('click', () => {
    if (timer) return;
    hits = 0;
    let left = 20;
    status.textContent = `${left}초 · 0개`;
    litUp();
    tick = setInterval(litUp, 900);
    timer = setInterval(async () => {
      left -= 1;
      status.textContent = `${left}초 · ${hits}개`;
      if (left <= 0) {
        clearInterval(timer); clearInterval(tick);
        timer = null; tick = null;
        grid.querySelectorAll('.stampcell').forEach((c) => c.classList.remove('is-live'));
        try {
          const r = await api('/api/break/score', { method: 'POST', body: { game: 'stamp', score: hits } });
          toast(`${hits}개 — ${r.of}명 중 ${r.rank}위입니다.`);
          render();
        } catch (err) { toast(err.message, 'error'); }
      }
    }, 1000);
  });

  grid.addEventListener('click', (e) => {
    const cell = e.target.closest('[data-cell]');
    if (!cell || !timer) return;
    if (Number(cell.dataset.cell) === live) { hits += 1; litUp(); }
  });

  // 숨 고르기
  $('#breathStart').addEventListener('click', async () => {
    const orb = $('#breathOrb');
    const btn = $('#breathStart');
    btn.disabled = true;
    let cycle = 0;
    const step = () => {
      if (cycle >= 6) {
        orb.className = 'breath-orb is-out';
        orb.textContent = '완료';
        btn.disabled = false;
        api('/api/break/score', { method: 'POST', body: { game: 'breath', score: 6 } })
          .then(() => { toast('6번 호흡을 마쳤습니다.'); render(); })
          .catch((err) => toast(err.message, 'error'));
        return;
      }
      orb.className = 'breath-orb is-in';
      orb.textContent = '들이쉬기';
      setTimeout(() => {
        orb.className = 'breath-orb is-out';
        orb.textContent = '내쉬기';
        cycle += 1;
        setTimeout(step, 4000);
      }, 4000);
    };
    step();
  });
}

/* ───────── 뷰: 성장 (기존 '퇴근 후 성장' 구성) ───────── */
let quizState = null; // { idx, answers, results }

async function viewGrow(root) {
  root.innerHTML = skeleton();
  const d = await api('/api/grow');
  root.dataset.tabcolor = 'grow';

  root.innerHTML = `
    <div class="page-head">
      <span class="eyebrow">퇴근 후 성장 · 오늘 10분</span>
      <h1>거창한 계획보다, 오늘 딱 10분.</h1>
      <p>자격증 문제 세 개, 책 몇 쪽, 작은 목표 하나부터 이어가요.</p>
    </div>

    <div class="stack-l">
      <section class="card stack" id="goalCard">
        <div class="spread">
          <h2>오늘의 10분</h2>
          <span class="caption num">${d.goal.streak > 0
            ? `${d.goal.streak}일 연속 · 누적 ${d.goal.totalDays}일`
            : d.goal.totalDays > 0 ? `누적 ${d.goal.totalDays}일` : '아직 기록 없음'}</span>
        </div>
        <div class="field">
          <label for="goalText">퇴근 후 무엇을 해볼까요?</label>
          <input id="goalText" type="text" maxlength="80" value="${esc(d.goal.text)}"
                 placeholder="예: 기출 3문제 풀기 / 20쪽 읽기">
        </div>
        <div class="row">
          <button type="button" class="btn-quiet" id="goalSave">목표 저장</button>
          <button type="button" class="btn ${d.goal.doneToday ? 'btn-quiet' : ''}" id="goalDone"
                  aria-pressed="${d.goal.doneToday}">
            ${d.goal.doneToday ? `${icon('check')}오늘 완료함` : '완료 표시'}
          </button>
        </div>
      </section>

      <section class="card stack" id="quizCard">
        <div class="spread">
          <h2>자격증 연습</h2>
          <span class="caption num">${d.quiz.attempts > 0
            ? `최고 ${d.quiz.best}/${d.quiz.total} · ${d.quiz.attempts}회 풀이`
            : '아직 풀어보지 않았어요'}</span>
        </div>
        <div id="quizBody"></div>
      </section>

      <section class="stack">
        <div class="spread">
          <h2>독서 기록</h2>
          <span class="caption num">${d.trackedBooks > 0
            ? `${d.trackedBooks}권 기록 중`
            : `${d.books.length}권 · 아직 기록 없음`}</span>
        </div>
        <div class="grid grid-2">
          ${d.books.map((b) => `
            <div class="card stack" data-book="${esc(b.id)}">
              <div class="stack-s">
                <h3>${esc(b.title)}</h3>
                <p class="caption">${esc(b.author)}</p>
              </div>
              ${b.needsPages ? `
                <div class="field">
                  <label for="pages-${esc(b.id)}">총 쪽수</label>
                  <input id="pages-${esc(b.id)}" type="number" min="1" max="20000"
                         inputmode="numeric" placeholder="예: 320" data-pages>
                  <span class="hint">총 쪽수를 알려주시면 진도를 계산해 드려요.</span>
                </div>
                <button type="button" class="btn-quiet" data-savepages>쪽수 저장</button>
              ` : `
                <div class="stack-s">
                  <div class="spread">
                    <span class="caption num">${b.page} / ${b.pages}쪽</span>
                    <span class="caption num">${b.percent}%</span>
                  </div>
                  <div class="progress-track"><span class="progress-fill" style="width:${b.percent}%"></span></div>
                </div>
                <div class="row">
                  <label class="visually-hidden" for="page-${esc(b.id)}">${esc(b.title)} 읽은 쪽</label>
                  <input id="page-${esc(b.id)}" type="number" min="0" max="${b.pages}" value="${b.page}"
                         inputmode="numeric" data-page
                         style="min-height:44px;width:110px;padding:0 var(--s3);border:1px solid var(--line-strong);border-radius:var(--r-chip);background:var(--surface);font-size:16px">
                  <button type="button" class="btn-quiet btn-sm" data-savepage>쪽수 기록</button>
                  <button type="button" class="btn-quiet btn-sm" data-delta="5">+5%</button>
                </div>
              `}
            </div>`).join('')}
        </div>
        <p class="note">기록은 이 계정(또는 이 브라우저 세션)에 저장되며, 다른 사람에게는 보이지 않습니다.</p>
      </section>
    </div>`;

  paintQuiz(d);

  $('#goalSave').addEventListener('click', async () => {
    try {
      await api('/api/grow/goal', { method: 'POST', body: { text: $('#goalText').value } });
      toast('오늘의 목표를 저장했습니다.');
      render();
    } catch (err) { toast(err.message, 'error'); }
  });

  $('#goalDone').addEventListener('click', async () => {
    try {
      const r = await api('/api/grow/goal/done', { method: 'POST', body: { done: !d.goal.doneToday } });
      toast(r.goal.doneToday
        ? (r.goal.streak > 1 ? `${r.goal.streak}일 연속입니다.` : '오늘 완료했습니다.')
        : '완료 표시를 지웠습니다.');
      render();
    } catch (err) { toast(err.message, 'error'); }
  });

  root.querySelectorAll('[data-book]').forEach((card) => {
    const id = card.dataset.book;
    const save = async (body) => {
      try {
        await api(`/api/grow/reading/${encodeURIComponent(id)}`, { method: 'POST', body });
        render();
      } catch (err) { toast(err.message, 'error'); }
    };
    card.querySelector('[data-savepages]')?.addEventListener('click',
      () => save({ pages: card.querySelector('[data-pages]').value, page: 0 }));
    card.querySelector('[data-savepage]')?.addEventListener('click',
      () => save({ page: card.querySelector('[data-page]').value }));
    card.querySelector('[data-delta]')?.addEventListener('click',
      () => save({ delta: 5 }));
  });
}

// 문제는 한 번에 하나씩. 정답은 제출한 뒤 서버가 알려준다.
function paintQuiz(d) {
  const box = $('#quizBody');
  if (!box) return;
  const qs = d.quiz.questions;

  if (!quizState || quizState.total !== qs.length) {
    quizState = { idx: 0, answers: new Array(qs.length).fill(null), results: null, total: qs.length };
  }

  if (quizState.results) {
    const { score, results } = quizState;
    box.innerHTML = `
      <div class="stack">
        <div class="spread">
          <h3 class="num">${score} / ${qs.length}</h3>
          <span class="caption">${score === qs.length ? '전부 맞혔어요.' : '짧게 자주 보는 것이 오래 남습니다.'}</span>
        </div>
        ${results.map((r, i) => `
          <div class="card card-tight stack-s">
            <div class="row">
              <span class="badge ${r.correct ? 'badge-verified' : 'badge-lock'}">${r.correct ? '정답' : '오답'}</span>
              <span class="caption">${esc(qs[i].topic)}</span>
            </div>
            <div>${esc(qs[i].question)}</div>
            <div class="caption">정답 — ${esc(qs[i].options[r.answer])}${
              r.correct ? '' : ` · 고른 답 ${r.picked >= 0 ? esc(qs[i].options[r.picked]) : '없음'}`}</div>
            <div class="caption">${esc(r.explain)}</div>
          </div>`).join('')}
        <button type="button" class="btn" id="quizRetry">다시 풀기</button>
      </div>`;
    $('#quizRetry').addEventListener('click', () => {
      quizState = null;
      paintQuiz(d);
    });
    return;
  }

  const i = quizState.idx;
  const q = qs[i];
  box.innerHTML = `
    <div class="stack">
      <div class="row">
        <span class="badge badge-vis num">${i + 1} / ${qs.length}</span>
        <span class="badge badge-vis">${esc(q.topic)}</span>
      </div>
      <p style="font-size:16px">${esc(q.question)}</p>
      <div class="radio-row" role="group" aria-label="보기">
        ${q.options.map((o, oi) => `
          <label class="radio-opt">
            <input type="radio" name="quiz-${esc(q.id)}" value="${oi}" ${quizState.answers[i] === oi ? 'checked' : ''}>
            <span>${esc(o)}</span></label>`).join('')}
      </div>
      <div class="row">
        ${i > 0 ? '<button type="button" class="btn-quiet" id="quizPrev">이전</button>' : ''}
        <button type="button" class="btn" id="quizNext">${i === qs.length - 1 ? '결과 보기' : '다음 문제'}</button>
      </div>
      <p class="hint" id="quizHint"></p>
    </div>`;

  box.querySelectorAll(`input[name="quiz-${q.id}"]`).forEach((input) => {
    input.addEventListener('change', () => {
      quizState.answers[i] = Number(input.value);
      $('#quizHint').textContent = '';
    });
  });

  $('#quizPrev')?.addEventListener('click', () => { quizState.idx -= 1; paintQuiz(d); });

  $('#quizNext').addEventListener('click', async () => {
    if (quizState.answers[i] === null) {
      $('#quizHint').textContent = '보기를 하나 고른 뒤 넘어갈 수 있어요.';
      return;
    }
    if (i < qs.length - 1) { quizState.idx += 1; paintQuiz(d); return; }
    try {
      const r = await api('/api/grow/quiz', { method: 'POST', body: { answers: quizState.answers } });
      quizState.results = r.results;
      quizState.score = r.score;
      paintQuiz(d);
      toast(`${r.score} / ${r.total} 맞혔습니다.`);
    } catch (err) { toast(err.message, 'error'); }
  });
}

/* ───────── 뷰: 내 서랍 ───────── */
async function viewMe(root) {
  root.innerHTML = skeleton();
  const { me } = await api('/api/me');
  state.me = me;
  paintIdentity();
  const mine = await api('/api/posts?sort=new');
  const myPosts = mine.posts.filter((p) => p.mine);

  root.dataset.tabcolor = 'today';
  root.innerHTML = `
    <div class="page-head">
      <span class="eyebrow">내 서랍</span>
      <h1>${esc(me.nickname)}</h1>
      <p>지금 ${esc(me.level)} 단계입니다. ${me.loggedIn ? '' : '가입하면 내 글 모아보기와 알림이 열립니다.'}</p>
    </div>

    <div class="stack-l">
      <section class="card stack">
        <h2>신원 단계</h2>
        <div class="stack-s">
          ${[
            ['L0', '손님', '가입 없이 읽고 쓰기. 익명 글만 가능', !me.loggedIn],
            ['L1', '아이디', '고정 닉네임 · 내 글 모아보기 · 가면(익명) 사용', me.loggedIn],
            ['L2', '직장인 인증', '회사 이메일 인증 배지 · 인증자 전용 글 열람', me.verified],
          ].map(([lv, nm, desc, on]) => `
            <div class="row" style="gap:var(--s3);padding:var(--s2) 0;border-bottom:1px solid var(--line)">
              <span class="badge ${on ? 'badge-verified' : 'badge-vis'}">${on ? icon('check') : ''}${lv}</span>
              <span style="flex:1 1 200px"><strong>${nm}</strong><br><span class="caption">${desc}</span></span>
            </div>`).join('')}
        </div>
        <div class="row">
          ${me.loggedIn
            ? `<button type="button" class="btn-quiet" id="logoutBtn">로그아웃</button>`
            : `<button type="button" class="btn" id="loginBtn">로그인 / 가입</button>`}
          ${me.canVerify ? `<button type="button" class="btn" id="verifyBtn">${icon('shield')}직장인 인증하기</button>` : ''}
          ${me.loggedIn && !me.verified && !me.canVerify
            ? `<span class="caption">개인 메일 도메인이라 인증 대상이 아닙니다. 회사 이메일 계정으로 가입하면 인증할 수 있어요.</span>` : ''}
        </div>
      </section>

      <section class="card stack">
        <h2>지금 쓸 수 있는 것</h2>
        <div class="stack-s">
          <div><strong>작성 방식</strong> — ${me.writeModes.map((m) =>
            `<span class="badge badge-vis">${({ guest: '손님', account: '아이디', mask: '가면(익명)', badge: '인증 배지' })[m]}</span>`).join(' ')}</div>
          <div><strong>공개 범위</strong> — ${me.visibilities.map((v) => visBadge(v)).join(' ')}</div>
        </div>
      </section>

      <section class="stack">
        <h2 class="num">내가 쓴 글 ${myPosts.length}</h2>
        ${myPosts.length
          ? `<div class="postlist">${myPosts.map(postCard).join('')}</div>`
          : emptyState('아직 쓴 글이 없어요',
              me.loggedIn ? '토크에서 첫 글을 남겨 보세요.' : '손님으로 쓴 글은 이 브라우저 세션에서만 내 글로 인식됩니다.')}
      </section>
    </div>`;

  const lb = $('#loginBtn'); if (lb) lb.addEventListener('click', openLoginSheet);
  const ob = $('#logoutBtn');
  if (ob) ob.addEventListener('click', async () => {
    const { me: m } = await api('/api/auth/logout', { method: 'POST' });
    state.me = m; paintIdentity(); toast('로그아웃했습니다.'); render();
  });
  const vb = $('#verifyBtn'); if (vb) vb.addEventListener('click', openVerifySheet);
}

/* ───────── 시트: 글쓰기 ───────── */
// 진단서 08장 권장 순서 — 본문 → 카테고리 → 누구로 → 누가 볼지 → (선택) 제목 → 비밀번호
const WRITE_MODE_LABEL = { guest: '손님(익명)', account: '내 아이디', mask: '가면(익명)', badge: '인증 배지' };
const VIS_LABEL = {
  public: '전체 공개', members: '회원 공개',
  verified: '인증 직장인만', private: '비공개(나만)',
};

// 못 쓰는 선택지를 회색으로 늘어놓으면 고장난 화면처럼 보인다.
// 쓸 수 있는 것만 보여주고, 잠긴 것은 한 줄로 이유와 함께 안내한다.
function lockedNote(lockedLabels, why) {
  if (!lockedLabels.length) return '';
  return `<p class="hint locked-note">
    ${esc(why)} — ${lockedLabels.map((l) => esc(l)).join(' · ')}
    <button type="button" class="btn-quiet btn-sm" data-open-login>로그인</button>
  </p>`;
}

function writeModeOptions(prefix) {
  const available = state.me.writeModes;
  const radios = available.map((m, i) => `
    <label class="radio-opt">
      <input type="radio" name="${prefix}-writeAs" value="${m}" ${i === 0 ? 'checked' : ''}>
      <span>${WRITE_MODE_LABEL[m]}</span></label>`).join('');
  const locked = ['account', 'mask', 'badge']
    .filter((m) => !available.includes(m))
    .map((m) => WRITE_MODE_LABEL[m]);
  return radios + lockedNote(locked, '로그인하면 이렇게도 쓸 수 있어요');
}

function visibilityOptions(prefix) {
  const available = state.me.visibilities;
  const radios = available.map((v) => `
    <label class="radio-opt">
      <input type="radio" name="${prefix}-vis" value="${v}" ${v === 'public' ? 'checked' : ''}>
      <span>${VIS_LABEL[v]}</span></label>`).join('');
  const locked = ['members', 'verified']
    .filter((v) => !available.includes(v))
    .map((v) => VIS_LABEL[v]);
  const why = state.me.loggedIn
    ? '회사 이메일로 인증하면 여기까지 열려요'
    : '로그인하면 여기까지 열려요';
  return radios + lockedNote(locked, why);
}

function openWriteSheet() {
  const html = `
    <form class="stack" id="writeForm">
      <div class="field">
        <label for="wBody">무슨 일이 있었나요?</label>
        <textarea id="wBody" required placeholder="편하게 적어 주세요. 제목은 비워두면 첫 줄이 제목이 됩니다."></textarea>
        <span class="hint">실명·부서·직급 등 특정 개인을 알아볼 수 있는 정보는 삼가주세요.</span>
        <div id="wWarn"></div>
      </div>

      <div class="field">
        <label>어떤 이야기인가요</label>
        <div class="radio-row" id="wCat">
          ${state.meta.categories.map((c, i) => `
            <label class="radio-opt">
              <input type="radio" name="w-cat" value="${esc(c.id)}" ${i === 0 ? 'checked' : ''}>
              <span>${esc(c.label)}</span></label>`).join('')}
        </div>
      </div>

      <div class="field">
        <label>누구로 쓸까요</label>
        <div class="radio-row" id="wAs">${writeModeOptions('w')}</div>
        ${state.me.loggedIn
          ? '<span class="hint">“가면”은 계정은 연결해 두되 화면에는 익명으로만 보입니다.</span>'
          : ''}
      </div>

      <div class="field">
        <label>누가 볼 수 있나요</label>
        <div class="radio-row" id="wVis">${visibilityOptions('w')}</div>
      </div>

      <div class="field">
        <label for="wTitle">제목 <span class="hint">(선택)</span></label>
        <input id="wTitle" type="text" maxlength="60" placeholder="비우면 본문 첫 줄이 제목이 됩니다">
      </div>

      <div class="field" id="wPwField">
        <label for="wPw">비밀번호</label>
        <input id="wPw" type="password" autocomplete="new-password" placeholder="4자 이상">
        <span class="hint">비공개 글을 나중에 다시 열 때 쓰는 비밀번호입니다.</span>
      </div>

      <div class="row">
        <button class="btn" type="submit">등록</button>
        <button class="btn-quiet" type="button" id="wCancel">취소</button>
      </div>
    </form>`;

  openSheet('글쓰기', html, (body) => {
    const pwField = body.querySelector('#wPwField');
    // 비밀번호는 비공개 글에만 필요하다. 공개 글을 쓸 땐 묻지 않는다.
    const syncPw = () => {
      const vis = body.querySelector('#wVis input:checked').value;
      const need = vis === 'private';
      pwField.hidden = !need;
      body.querySelector('#wPw').required = need;
      if (!need) body.querySelector('#wPw').value = '';
    };
    body.querySelector('#wVis').addEventListener('change', syncPw);
    syncPw();

    // 잠긴 선택지 안내 줄의 "로그인" 버튼
    body.querySelectorAll('[data-open-login]').forEach((btn) => {
      btn.addEventListener('click', () => { closeSheet(); openLoginSheet(); });
    });

    // 자동 필터 — 입력이 멈추면 서버에 검사 요청
    let debounce = null;
    body.querySelector('#wBody').addEventListener('input', (e) => {
      clearTimeout(debounce);
      debounce = setTimeout(async () => {
        const { warnings } = await api('/api/screen', { method: 'POST', body: { text: e.target.value } });
        body.querySelector('#wWarn').innerHTML = warnings.length
          ? `<div class="warnbox">${warnings.map((w) => `<span>${esc(w)}</span>`).join('')}</div>` : '';
      }, 400);
    });

    body.querySelector('#wCancel').addEventListener('click', closeSheet);
    body.querySelector('#writeForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const payload = {
        body: body.querySelector('#wBody').value,
        title: body.querySelector('#wTitle').value,
        category: body.querySelector('#wCat input:checked').value,
        writeAs: body.querySelector('#wAs input:checked').value,
        visibility: body.querySelector('#wVis input:checked').value,
        password: body.querySelector('#wPw').value,
      };
      try {
        const r = await api('/api/posts', { method: 'POST', body: payload });
        closeSheet();
        if (r.warnings?.length) r.warnings.forEach((w) => toast(w, 'error'));
        toast('글을 등록했습니다.');
        navigate(`/talk/${r.post.id}`);
      } catch (err) { toast(err.message, 'error'); }
    });
  });
}

/* ───────── 시트: 로그인 ───────── */
function openLoginSheet() {
  const html = `
    <div class="stack">
      <div class="chips">
        <button type="button" class="chip is-on" data-mode="login">로그인</button>
        <button type="button" class="chip" data-mode="signup">가입</button>
      </div>
      <form class="stack" id="authForm">
        <div class="field">
          <label for="aEmail">이메일</label>
          <input id="aEmail" type="email" autocomplete="email" required placeholder="you@company.co.kr">
          <span class="hint">회사 이메일로 가입하면 나중에 직장인 인증을 받을 수 있습니다.</span>
        </div>
        <div class="field" id="nickField" hidden>
          <label for="aNick">닉네임</label>
          <input id="aNick" type="text" maxlength="16" placeholder="2~16자">
        </div>
        <div class="field">
          <label for="aPw">비밀번호</label>
          <input id="aPw" type="password" autocomplete="current-password" required placeholder="8자 이상">
        </div>
        <div id="aErr"></div>
        <button class="btn btn-block" type="submit" id="aSubmit">로그인</button>
      </form>
      <div class="card card-tight">
        <p class="caption">
          <strong>회사 이메일로 가입하면</strong> 나중에 직장인 인증 배지를 받을 수 있습니다.
          개인 메일(gmail·naver 등)로 가입해도 글쓰기·댓글·가면(익명)은 전부 쓸 수 있어요.
        </p>
      </div>
    </div>`;

  openSheet('로그인 / 가입', html, (body) => {
    let mode = 'login';
    body.querySelectorAll('[data-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        mode = btn.dataset.mode;
        body.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('is-on', b === btn));
        body.querySelector('#nickField').hidden = mode !== 'signup';
        body.querySelector('#aNick').required = mode === 'signup';
        body.querySelector('#aSubmit').textContent = mode === 'signup' ? '가입하기' : '로그인';
      });
    });

    body.querySelector('#authForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const payload = {
        email: body.querySelector('#aEmail').value,
        password: body.querySelector('#aPw').value,
        nickname: body.querySelector('#aNick').value,
      };
      try {
        const { me } = await api(`/api/auth/${mode}`, { method: 'POST', body: payload });
        state.me = me;
        paintIdentity();
        closeSheet();
        toast(`${me.nickname}님, 반갑습니다.`);
        render();
      } catch (err) {
        body.querySelector('#aErr').innerHTML = `<div class="warnbox">${esc(err.message)}</div>`;
        body.querySelector('#aEmail').focus();
      }
    });
  });
}

/* ───────── 시트: 직장인 인증 ───────── */
function openVerifySheet() {
  const html = `
    <form class="stack" id="verifyForm">
      <p>가입하신 회사 이메일 도메인으로 인증합니다. <strong>회사명은 공개되지 않습니다.</strong></p>
      <div class="field">
        <label for="vInd">업종</label>
        <input id="vInd" type="text" maxlength="12" placeholder="제조 / IT / 금융 …" required>
      </div>
      <div class="field">
        <label for="vYear">연차</label>
        <input id="vYear" type="number" min="0" max="50" placeholder="5" required>
      </div>
      <span class="hint">글에는 “제조 5년차” 형태로만 표시됩니다.</span>
      <div id="vErr"></div>
      <button class="btn btn-block" type="submit">인증하기</button>
    </form>`;

  openSheet('직장인 인증', html, (body) => {
    body.querySelector('#verifyForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const { me } = await api('/api/auth/verify', {
          method: 'POST',
          body: { industry: body.querySelector('#vInd').value, years: body.querySelector('#vYear').value },
        });
        state.me = me; paintIdentity(); closeSheet();
        toast('인증되었습니다. 인증 배지로 글을 쓸 수 있어요.');
        render();
      } catch (err) {
        body.querySelector('#vErr').innerHTML = `<div class="warnbox">${esc(err.message)}</div>`;
      }
    });
  });
}

/* ───────── 라우터 ───────── */
function currentRoute() {
  const p = location.pathname;
  const m = p.match(/^\/talk\/([^/]+)$/);
  if (m) return { name: 'post', id: m[1], tab: 'talk' };
  return { name: { '/': 'today', '/lunch': 'lunch', '/talk': 'talk', '/break': 'break', '/grow': 'grow', '/me': 'me' }[p] || 'today', tab: { '/': 'today', '/lunch': 'lunch', '/talk': 'talk', '/break': 'break', '/grow': 'grow', '/me': 'today' }[p] || 'today' };
}

function paintNav(tab) {
  $$('[data-tab]').forEach((a) => {
    if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
}

async function render() {
  // 화면이 바뀌면 열려 있던 시트는 닫는다.
  // (뒤로가기로 popstate 가 오면 시트만 남을 수 있다)
  closeSheet();
  const route = currentRoute();
  const root = $('#view');
  paintNav(route.tab);
  try {
    if (route.name === 'today') await viewToday(root);
    else if (route.name === 'lunch') await viewLunch(root);
    else if (route.name === 'talk') await viewTalk(root);
    else if (route.name === 'post') await viewPost(root, route.id);
    else if (route.name === 'break') await viewBreak(root);
    else if (route.name === 'grow') await viewGrow(root);
    else if (route.name === 'me') await viewMe(root);
  } catch (err) {
    root.innerHTML = emptyState('화면을 불러오지 못했습니다', err.message,
      '<button type="button" class="btn" onclick="location.reload()">다시 시도</button>');
  }
}

function navigate(path) {
  if (path === location.pathname) { render(); return; }
  history.pushState({}, '', path);
  render();
  $('#view').focus();
  window.scrollTo({ top: 0, behavior: 'auto' });
}

document.addEventListener('click', (e) => {
  const link = e.target.closest('a[data-link]');
  if (!link) return;
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
  e.preventDefault();
  navigate(new URL(link.href).pathname);
});

window.addEventListener('popstate', render);

/* ───────── 테마 ───────── */
const savedTheme = localStorage.getItem('theme');
if (savedTheme) document.documentElement.dataset.theme = savedTheme;

$('#themeToggle').addEventListener('click', () => {
  const root = document.documentElement;
  const cur = root.dataset.theme;
  const isDark = cur
    ? cur === 'dark'
    : matchMedia('(prefers-color-scheme: dark)').matches;
  const next = isDark ? 'light' : 'dark';

  // 전환하는 동안만 트랜지션을 끈다.
  // color 에 트랜지션이 걸린 요소는 토큰이 바뀔 때 이전 값에 고정되는데,
  // 이 한 프레임 차단으로 모든 요소가 새 토큰 값으로 곧장 잡힌다.
  root.classList.add('theme-switching');
  root.dataset.theme = next;
  localStorage.setItem('theme', next);
  void root.offsetHeight; // 강제 리플로우로 차단 상태를 확정
  requestAnimationFrame(() => {
    requestAnimationFrame(() => root.classList.remove('theme-switching'));
  });
});

/* ───────── 시작 ───────── */
(async function boot() {
  $$('[data-icon]').forEach((el) => { el.innerHTML = icon(el.dataset.icon); });
  try {
    const meta = await api('/api/bootstrap');
    state.meta = meta;
    state.me = meta.me;
    paintIdentity();
    await render();
  } catch (err) {
    $('#view').innerHTML = emptyState('서버에 연결하지 못했습니다', err.message);
  }
}());
