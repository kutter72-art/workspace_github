# 병렬 콘텐츠 검증 (Gemini + GPT) 설계

## 배경 / 목적

`pptx_code.js`로 생성한 주간보고 PPTX의 최종 내용을, Gemini와 GPT를 동시에(병렬) 호출해 교차 검증한다. 목적은 아래 세 가지 문제를 자동으로 잡아내는 것:

- 오탈자/문법 오류
- 내용 누락/불일치 (입력 대비)
- 형식/구조 일관성 (월, 주차, 팀명 등 필수 항목 누락 여부)

검증 대상은 **PPTX 생성 후 최종 파일 내용**이다 (생성 전 HTML 입력이 아님).

## 아키텍처

```
[브라우저: pptx_code.js]          [로컬 프록시 서버: Node.js/Express]
  "내용 검증" 버튼 클릭
        │
        ├─ PPTX 생성 로직 재사용 (buildSlideXml 등)으로
        │  각 슬라이드의 텍스트 추출
        │
        ▼
  POST http://localhost:PORT/verify
  { slides: [{ month, week, team, leftText, rightText }, ...] }
        │                                  │
        └─────────────────────────────────▶│
                                            ├─ Gemini 2.5 Flash 호출 (병렬)
                                            ├─ GPT-4o mini 호출 (병렬)
                                            │  (Promise.allSettled로 동시 실행)
                                            ▼
        ◀───────────────────────────────────
  { gemini: {...}, gpt: {...} }
        │
        ▼
  결과를 Gemini 열 | GPT 열로 나란히 표시
```

- 프록시 서버는 로컬에서 `node server/index.js`로 실행한다.
- API 키(`GEMINI_API_KEY`, `OPENAI_API_KEY`)는 `server/.env`에 저장하며 브라우저에는 절대 노출하지 않는다.
- 브라우저는 로컬 프록시(`http://localhost:3001`)에만 요청한다.

## 컴포넌트

### 서버 (`server/`)

- `server/index.js` — Express 앱, 단일 엔드포인트 `POST /verify`
  - 요청: `{ slides: [{ month, week, team, leftText, rightText }] }`
  - `Promise.allSettled`로 Gemini(2.5 Flash)와 GPT(4o mini)를 동시 호출 — 한쪽이 실패해도 다른 쪽 결과는 반환
  - 각 모델에 동일한 프롬프트 전송: "다음은 주간보고 슬라이드 내용입니다. 오탈자/문법 오류, 내용 누락/불일치, 형식 일관성(월/주차/팀명 등 필수 항목 누락) 문제를 슬라이드별로 지적해주세요." → JSON 응답 요청: `{ slideIndex, issues: [{ type, description }] }[]`
  - 응답: `{ gemini: { slideResults: [...] } | { error }, gpt: { slideResults: [...] } | { error } }`
- `server/.env` — `GEMINI_API_KEY`, `OPENAI_API_KEY`, `PORT`(기본 3001)
- `server/package.json` — 의존성: `express`, `cors`, `dotenv` (fetch는 Node 내장 사용)
- CORS는 페이지 origin만 허용

### 클라이언트 (`pptx_code.js` 확장)

- `extractPlainText(html)` — 기존 `htmlParas()`/`parasToOoxml()` 파이프라인에서 OOXML 변환 전 단계의 순수 텍스트만 뽑는 헬퍼로 신설
- `async function verifyContent()`:
  1. `savePptx()`와 동일한 슬라이드 순회 로직으로 각 슬라이드의 `leftHtml`/`rightHtml`을 `extractPlainText`로 텍스트화
  2. `{ slides: [...] }`를 `POST http://localhost:3001/verify`로 전송
  3. 응답을 받아 결과를 렌더링
- 호스트 HTML에 새 버튼 `btnVerify` 추가 (버튼 자체는 호스트 페이지, `pptx_code.js`는 기존 `btnPptx` 패턴과 동일하게 클릭 핸들러만 등록)
- 결과 표시용 패널을 동적으로 DOM에 생성: 슬라이드별로 행을 만들고 Gemini 열 | GPT 열로 나란히 비교
- `setStatus()`로 진행 상태 표시 ("검증 중...", "완료", 에러 메시지)

## 데이터 흐름 요약

1. 사용자가 "내용 검증" 클릭
2. 클라이언트가 `slides` 전역 배열을 텍스트로 변환
3. 로컬 프록시로 POST
4. 프록시가 Gemini/GPT를 병렬 호출
5. 결과를 합쳐 클라이언트로 반환
6. 클라이언트가 Gemini 열 | GPT 열로 나란히 렌더링

## 에러 처리 & 엣지 케이스

- **프록시 서버 미실행**: fetch 실패 시 `setStatus('검증 서버(localhost:3001)에 연결할 수 없습니다. server 폴더에서 서버를 먼저 실행하세요.')`
- **한쪽 모델만 실패**: `Promise.allSettled`로 다른 쪽 결과는 정상 표시, 실패한 열에는 에러 메시지만 표시
- **API 키 미설정**: 서버 시작 시 콘솔 경고, `/verify` 호출 시 해당 모델에 대해 `{ error: 'API 키가 설정되지 않았습니다' }` 반환
- **빈 슬라이드 배열**: 서버 호출 생략, 상태 메시지만 표시
- **모델 응답이 JSON이 아닌 경우**: 파싱 실패 시 `issues: [{ type: 'raw', description: <원문> }]`로 감싸서 표시

## 테스트 방법

자동화 테스트 프레임워크가 없는 프로젝트이므로 브라우저에서 수동 확인:

1. `server/` 실행 → 브라우저에서 슬라이드 입력 → "내용 검증" 클릭 → Gemini/GPT 두 열에 결과가 뜨는지 확인
2. 서버를 끈 상태로 버튼을 눌러 에러 메시지가 뜨는지 확인
3. 일부러 오탈자/누락된 팀명을 넣어 Gemini/GPT가 실제로 지적하는지 확인

## 범위 밖 (Out of scope)

- 배포용 서버리스 구성 (Vercel 등) — 현재는 로컬 Node.js/Express로만 구현
- PPTX 생성 전 HTML 입력 검증 — 최종 파일 내용만 검증
- 두 모델 결과의 자동 병합/중복 제거 — 나란히 비교 표시만 제공
