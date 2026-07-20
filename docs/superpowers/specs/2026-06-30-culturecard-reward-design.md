# 컬처카드 — 리워드형 문화 카드 앱 구조 설계 (G1)

- 작성일: 2026-06-30
- 상태: 구조 승인됨 (G1). 다음 단계 = G2 디자인(toss-ui → Claude Design) → 구현(codex 위임)
- 전신: FairPick(문화 큐레이션 앱) → 컬처카드(리워드형 문화 카드 앱)로 전환

## 0. 한 줄 정의

매일 광고를 보고 "오늘의 문화 카드"를 열면 내 주변/취향의 문화행사(전시·공연·팝업·축제)가
드러나고, 티켓을 적립해 토스포인트로 교환한다. **핵심 재미 = 매일 문화 발견 + 적립.**

## 1. 핵심 결정 (확정)

| 항목 | 결정 |
|---|---|
| 핵심 재미 | 매일 문화 발견 + 적립 (수집/가챠 아님, 순수리워드 아님) |
| 하루 구조 | **오늘의 카드 고정 N장 + 더 뽑기**(하루 한도까지) |
| 저장 탭 | **가보고픈 문화행사 북마크** (발견→실제 방문 연결) |
| 차별화 레이어 | **문화 여권 + "다녀왔어요" 도장** — 포인트 옆 문화적 이점층 (수집 대상=돈이 아니라 문화 경험) |
| 포인트 방식 | **수집형 유지** — 입장권 10장 = 토스포인트 1회 교환 (즉시지급/상시교환은 제네릭 리워드앱 함정이라 기각) |
| 구현 접근 | **A안 — 얇은 재배선**: 검증된 서버 엔진 그대로 두고 프론트를 진짜 API에 다시 연결 |
| 경제 권위 | 서버 권위(기존 `backend/src/routes/tickets.ts`) — 신규 경제 엔진 없음 |

확정(G2 시안 반영): 오늘의 카드 **3장**, 3번째 탭 라벨 **"내 문화"**, 통화 표기 **"티켓"**,
방문 도장은 **보상 없는 추억 기록**으로 확정. 04 단독 "포인트" 화면은 폐기, 05 "내 문화"가 상위호환.

## 2. 경제 모델 — 기존 엔진 재사용 (서버 권위)

기존 `tickets.ts`가 컬처카드 메커니즘과 1:1로 맞물린다. 새로 만들지 않는다.

- **카드 1장 = 문화행사(canonical_event) 1개**
- **카드 오픈 = 광고 1회 시청** → `POST /api/tickets/earn { eventId, adAttemptId }`
  - 티켓 **1~3개 랜덤** (50% / 35% / 15%) — 카드 오픈의 "손맛"
  - **이벤트당 하루 1회** (unique(user_id, event_id, earn_date), KST) — 같은 카드 재적립 불가
  - **하루 30티켓 한도** (DAILY_LIMIT), KST 자정 리셋, 마지막 적립 ≥1 clamp
  - `EVENT_ALREADY_EARNED_TODAY`(409) / `DAILY_LIMIT_REACHED`(429) 구분
- **10티켓 = 토스포인트 1회 교환** (`TICKETS_PER_EXCHANGE`)
  - 2-step fail-closed: `POST /exchange`(pending, 미차감) → `grantPromotionReward` → `POST /exchange/confirm`(차감 확정)
  - grant 실패 시 confirm 미호출 → 차감 안 됨. confirm 멱등(이미 completed → 성공 반환). pending 24h 만료.
- **관측/정산**: `POST /ad-attempt-events` 로 모든 SDK 광고 이벤트 기록(`ad_reward_attempts`) — 정산 impression ↔ 실제 ticket grant 대조
- 부가 적립 훅 이미 존재: 출석(`user_attendance_log`), 주간 보너스(`user_weekly_bonus_log`)

### 통화 네이밍 정리 (필수)
현재 새 UI의 로컬 "포인트"는 **토스포인트와 혼동**되므로 폐기한다. 적립 통화(티켓 조각)는
컬처카드 컨셉에 맞는 단일 명칭으로 통일(예: 별/조각/도장) — G2에서 확정. 내부 코드/DB는
기존 `ticket` 유지, 사용자 표기만 통일.

## 2.5 차별화 레이어 — 문화 여권 + "다녀왔어요" 도장 (이 앱의 "이점" 정체성)

포인트 지급은 누구나 한다(테이블 스테이크). "단순히 포인트가 아니라 나한테 이점이 있다"는 느낌은
**별도의 문화 층**에서 만든다. 입장권/갤러리 모티프를 그대로 확장한다.

- **문화 여권 (Culture Passport)**: 카드를 열 때마다(=문화를 발견할 때마다) 여권에 입장권이 쌓인다.
  "올해 발견한 문화 N개", 카테고리·지역별 채움. **수집 대상이 '돈'이 아니라 '문화 경험'** → 제네릭 리워드앱과 결이 다름.
  - 데이터 출처: 대부분 기존 `user_ticket_earn_log`(오늘 연 event = 발견 기록)에서 파생. 신규 테이블 최소화.
- **"다녀왔어요" 도장**: 저장한 행사를 다녀온 뒤 자기신고로 여권에 도장을 남긴다. 위치 인증과 티켓 보상은 없다.
  디지털 발견 → 실제 문화생활로 잇되, 보상 어뷰즈 리스크 없이 추억 기록으로 유지한다.
- **월간 컬처 리포트** (후속, optional): "6월의 당신의 문화 — 발견 N · 다녀온 곳 M · 가장 끌린 카테고리".
  정체성 성장 + 공유 욕구. MVP 범위 밖, v1.1 후보.
- **오락성**: 카드 뽑기 reveal 손맛(이미 있음) + 여권 채우기 진행감. 즉시현금형 슬롯이 아니라 *수집 서사*.

3번째 탭은 단순 "포인트"가 아니라 **"내 문화 + 포인트"**로 진화한다(아래 화면 구조 참고).

## 3. 화면 구조 (하단 3탭)

### 홈 `/`
- **오늘의 카드 N장**(고정, 추천) + **더 뽑기**(하루 30티켓 한도까지 추가 오픈)
- 카드 오픈 플로우: 광고 `load → loaded → show` → `userEarnedReward` → **서버 earn** →
  카드 공개(문화행사 추천 + 적립 티켓 수 연출)
- **무표시 워치독/타임아웃 필수**: 외부 async 콜백(광고)으로만 풀리는 상태 전환에 failsafe
  (콜백 누락 시 영구 프리즈 방지 — ad-freeze 교훈)
- 진입 광고시트 금지(다크패턴)

### 저장 `/saved`
- 가보고픈 문화행사 북마크: 날짜·장소·길찾기·마감임박
- 발견 → 실제 방문 전환 실용 탭. 기존 북마크 인프라 재사용
- 각 행사에 **"다녀왔어요" 도장** → 여권에 추억 기록 저장 (보상 없음)

### 내 문화 `/points` (기존 포인트 탭 진화)
- **상단 = 문화 여권 히어로**: 발견한 문화 N · 다녀온 곳(도장) M · 내 취향 카테고리
- **중단 = 티켓 잔액권**: 진행(예: 7/10) + **토스포인트 교환 버튼**(실제 `exchangeTickets`) + "10티켓 = 토스포인트" 안내
- **하단 = 최근 내역**(history API): 카드 열기 +n · 출석 +1 · 토스포인트 교환 −10
- 현재의 가짜 alert(`handleClaim`) 제거 · 탭 라벨 **"내 문화"**로 확정 · 스크롤뷰(여권→잔액권→내역)

## 4. 데이터 흐름 (A안) — 프론트는 backend API만 (Supabase 직접 금지)

- **카드 공급(신규)**: `GET /api/cards/today` — 흡수한 추천 로직(`/api/home/feed`·추천)을 감싸
  "오늘의 카드 N장 + 더뽑기 풀" 반환. 오늘 이미 earn한 event는 '열림' 표시(earn-status 활용).
- **오픈**: `earnTickets(eventId, adAttemptId)` (기존)
- **광고 telemetry**: `logRewardAdEvent({ placement: 'culturecard_home_open', ... })` (기존)
- **저장**: 기존 북마크 엔드포인트 재사용
- **교환**: `exchangeTickets()` (기존, 2-step)
- 티켓 수 실시간 동기화: `subscribeTicketCount` 모듈 리스너 (기존)
- **다녀왔어요 도장(신규)**: `POST /api/visits { eventId }` — 행사당 1회 멱등, 여권 도장 기록.
  위치 인증·티켓 보상 없음. `DELETE /api/visits/:eventId`로 잘못 누른 도장을 취소할 수 있다.
- **문화 여권 통계(신규)**: `GET /api/passport` — 발견 수(earn_log distinct event), 도장 수(visits),
  취향 카테고리 분포. 대부분 기존 로그에서 집계 → 신규 테이블은 `user_visit_log` 최소 1개.

## 5. 정리 / 폐기 범위 (codex 위임)

- **폐기**: `src/services/cultureCard/{domain,service,storage}.ts`(로컬 전용 MVP)·로컬 포인트·
  `src/services/__tests__/cultureCardDomain.test.ts`
- **흡수**: `explore`/`hot`/`ending`/`nearby`/`search` **화면 제거** → 추천/데이터 로직만
  카드 공급 소스로 재활용 (라우트도 제거)
- **라우터 정합성**: `src/router.gen.ts` 재생성(제거 라우트 반영), `/admin` 등록 상태 정리
- **잡동사니 선별 정리**: `페어픽.html`(22MB), `src/pages/index.backup.*.tsx`,
  `explore.legacy.tsx`, `test-route.tsx`, `backend/count-*.js`, dangling 브랜딩 PNG 11장
- **events 라우트**: 실제 엔트리는 `pages/events/[id].tsx`, `src/pages/events/[id].tsx`는 deprecated stub (현행 유지)

## 6. 하드 규칙 (검수 통과 기준)

- 광고: **라이브 adGroupID만**(테스트ID·`__DEV__` 삼항 금지) · `load→loaded→show` 순서 ·
  실돈 보상 **fail-closed** · 무표시 워치독/타임아웃
- **금액 서버 권위** 계산 · 지급 **멱등**(earn_log unique, exchange 2-step) · 프론트는 **backend API만**
- RLS deny-all + service_role
- 비게임 **TDS 필수**(컴포넌트 변형·커스텀 앱바 금지) · **해요체** · 다크패턴 금지
  (진입광고시트·이탈방해팝업·전면광고·강제동의)
- `DAILY_LIMIT_REACHED`("오늘 다 모았어요") vs 광고없음("지금 광고를 불러올 수 없어요") 문구 분리
- AsyncStorage 금지 → `@apps-in-toss/framework` Storage · BlurView iOS 전용 · SVG는 `@granite-js/native`

## 7. 검증

- 백엔드: earn/exchange 멱등·daily limit·once-per-event 단위테스트 (기존 패턴)
- 프론트: 새 카드 화면 로직 테스트 (폐기되는 cultureCard 도메인 테스트는 정리)
- qa-verify: 프론트 typecheck/lint/build + 백엔드 build/test + 번들 stale 재빌드
- release-preflight: 출시 게이트 (.ait 용량·테스트광고ID·정책)

## 8. 작업 순서 (게이트)

1. **G1 구조 승인** — 이 문서 (완료)
2. **G2 디자인** — toss-ui로 TDS 방향 → Claude Design으로 홈/저장/포인트 목업 → 사용자 눈 확인
3. **구현(codex 위임 + 검수)**:
   - 백엔드: `GET /api/cards/today` + `POST /api/visits`(다녀왔어요 도장, 멱등) + `GET /api/passport`(여권 통계) 추가
   - 프론트: 홈/저장/포인트 재배선(real API), 로컬 MVP 폐기, 레거시 화면 제거, router.gen 재생성
   - 통화 명칭 통일, 잡동사니 정리
4. **G3 동작확인** — qa-verify·pitfall-audit·기기 스크린샷
5. **G4/G5** — 배포 승인·출시 (사용자)
