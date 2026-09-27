// 카탈로그 = 운영자가 정하는 설정값. 사용자 데이터가 아니다.
//
// 이 파일에는 "만들어낸 숫자"가 없다.
// 참여자 수·표 수·조회수·순위는 전부 실제 기록에서 계산한다.

export const REGIONS = [
  { id: 'yeoksam', label: '역삼동', city: '서울 강남구' },
  { id: 'yeouido', label: '여의도동', city: '서울 영등포구' },
  { id: 'pangyo', label: '판교동', city: '경기 성남시' },
  { id: 'samseong', label: '삼성동', city: '서울 강남구' },
  { id: 'jongno', label: '종로1가', city: '서울 종로구' },
  { id: 'guro', label: '구로동', city: '서울 구로구' },
];

export const MENU_GROUPS = [
  { id: 'korean', label: '한식', items: ['제육볶음', '김치찌개', '비빔밥', '순두부찌개', '백반'] },
  { id: 'chinese', label: '중식', items: ['짜장면', '짬뽕', '마라탕', '탕수육'] },
  { id: 'japanese', label: '일식', items: ['돈까스', '초밥', '규동', '우동'] },
  { id: 'western', label: '양식', items: ['파스타', '샐러드파스타', '리조또'] },
  { id: 'noodle', label: '면요리', items: ['물냉면', '비빔냉면', '칼국수', '국수'] },
  { id: 'light', label: '가벼운', items: ['포케', '샐러드', '샌드위치', '김밥'] },
];

export const ALL_MENUS = MENU_GROUPS.flatMap((g) => g.items.map((m) => ({ menu: m, group: g.id })));

// ── 퇴근 후 성장 ─────────────────────────────────────────────
// 기존 kutter72.co.kr 의 '퇴근 후 성장' 화면에 있던 내용을 그대로 옮겼다.
// 문제와 책 목록은 운영자가 정한 콘텐츠이므로 여기 둔다.
// 점수·진도·목표 달성은 사용자마다 실제 기록으로 쌓인다.

// 정답(answer)과 해설은 서버에만 둔다. 클라이언트로 내려보내지 않는다.
export const QUIZ = [
  {
    id: 'q-circuit',
    topic: '회로이론',
    question: '저항 6Ω과 3Ω을 병렬로 연결했을 때 합성저항은?',
    options: ['1Ω', '2Ω', '3Ω', '9Ω'],
    answer: 1,
    explain: '병렬 합성저항은 곱을 합으로 나눕니다. (6 × 3) ÷ (6 + 3) = 2Ω.',
  },
  {
    id: 'q-machine',
    topic: '전기기기',
    question: '변압기의 기본 원리와 가장 가까운 것은?',
    options: ['전자유도', '정전유도', '열전효과', '압전효과'],
    answer: 0,
    explain: '1차 코일의 교번 자속이 2차 코일에 기전력을 만드는 전자유도 현상을 이용합니다.',
  },
  {
    id: 'q-power',
    topic: '전력공학',
    question: '송전 전압을 높였을 때 같은 전력을 보낼 경우 기대되는 효과는?',
    options: ['전류 증가', '전선 손실 감소', '주파수 증가', '역률 고정'],
    answer: 1,
    explain: 'P = VI 이므로 전압을 올리면 전류가 줄고, 손실 P = I²R 은 전류의 제곱에 비례하므로 크게 줄어듭니다.',
  },
];

// 기존 '독서 서재'의 책 목록.
// '보스의 탄생'은 원본에 총 쪽수가 없어 진도가 NaN% 로 표시되고 있었다.
// 없는 숫자를 지어내지 않고 pages: null 로 두고, 화면에서 쪽수 입력을 받는다.
export const BOOKS = [
  { id: 'b-fish', title: '물고기는 존재하지 않는다', author: '룰루 밀러', pages: 300 },
  { id: 'b-habit', title: '아주 작은 습관의 힘', author: '제임스 클리어', pages: 359 },
  { id: 'b-hail', title: '프로젝트 헤일메리', author: '앤디 위어', pages: 692 },
  { id: 'b-boss', title: '보스의 탄생', author: '린다 A. 힐 · 켄트 라인백', pages: null },
];

// 문제를 클라이언트로 보낼 때는 정답·해설을 뺀다.
export function quizForClient() {
  return QUIZ.map(({ id, topic, question, options }) => ({ id, topic, question, options }));
}
