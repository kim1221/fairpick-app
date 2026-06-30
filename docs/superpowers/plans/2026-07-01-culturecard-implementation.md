# 컬처카드 구현 계획 (Implementation Plan)

> **For agentic workers (codex/서브에이전트):** 이 계획을 task 단위로 구현한다. 각 task는 독립적으로 테스트·검수 가능해야 한다. 빌드는 codex, 검수는 Claude(오케스트레이터) + `reviewer`/`pitfall-audit`/`qa-verify`. 단계는 `- [ ]` 체크박스로 추적.

**Goal:** FairPick(큐레이션) → 컬처카드(리워드형 문화 카드)로, 검증된 서버 티켓 엔진 위에 "광고→카드 오픈→티켓 적립→토스포인트 교환 + 문화 여권/가봤어요 도장" 루프를 재배선한다.

**Architecture:** A안(얇은 재배선). 기존 `backend/src/routes/tickets.ts` 경제 엔진은 그대로 두고, ① 카드 공급/방문/여권 3개 신규 엔드포인트를 추가하고 ② 프론트 홈/저장/내 문화 화면을 진짜 API에 다시 연결한다. 로컬 전용 MVP·레거시 큐레이션 화면은 폐기.

**Tech Stack:** Frontend = Granite RN(`@apps-in-toss/framework` 2.4.6, `@toss/tds-react-native` 2.0.2, 파일 라우팅 `pages/`→`src/pages/`). Backend = Express + pg(Pool), Supabase Postgres, Railway 자동배포. 광고 = 앱브릿지 rewarded ad SDK.

## Global Constraints (스펙에서 그대로)

- 프론트는 **backend API만** 호출 (Supabase 직접 금지). 금액 **서버 권위**. 지급 **멱등**(idempotency).
- 광고: **라이브 adGroupID만**(`__DEV__` 삼항·테스트ID 금지) · `load→loaded→show` 순서 · 실돈 보상 **fail-closed** · 외부 콜백 전환엔 **워치독/타임아웃**(ad-freeze 교훈).
- 비게임 **TDS 필수**(컴포넌트 변형·커스텀 앱바 금지) · **해요체** · 다크패턴 금지(진입광고/이탈방해/전면광고/강제동의).
- 통화 표기 **"티켓"**, 교환 대상 **"토스포인트"**. 오늘의 카드 **3장**. 도장 보너스 **+3 티켓**. 3번째 탭 **"내 문화"**.
- 디자인 토큰: 종이 `#F5F1E8`·브론즈 `#B8924A`/`#9C7635`·잉크 `#16161A`·토스블루 `#3182F6`·전시 `#3182F6`·공연 `#A8324A`·팝업 `#D08A2C`·축제 `#3E8E5A`. 세리프 **Noto Serif KR**(제목), 산세 **Pretendard**(UI). 반경 카드 22/16·버튼 14·pill 999.
- Storage는 `@apps-in-toss/framework` Storage(AsyncStorage 금지). SVG는 `@granite-js/native`. BlurView iOS 전용.
- DB: 메인 테이블 `canonical_events`(컬럼 `start_at`/`end_at`, `WHERE is_deleted=false`). 마이그레이션 후 `database.types.ts` 재생성 + 미러 + `BACKEND_CONTRACT.md` 동기화.

---

## 잠긴 API 계약 (신규 — 백엔드↔프론트 동시작업 기준선)

### `GET /api/cards/today` (requireAuth)
```ts
type Card = {
  eventId: string;
  title: string;
  category: string;          // 전시 | 공연 | 팝업 | 축제 | 기타
  venue: string | null;
  region: string | null;
  startAt: string | null;    // ISO
  endAt: string | null;      // ISO
  dday: number | null;       // end_at 기준 남은 일수
  imageUrl: string | null;
  walkMinutes: number | null;
  blurb: string | null;      // 짧은 소개(overview 1줄)
  opened: boolean;           // 오늘 이 event에서 이미 earn했는지
};
type CardsTodayResponse = {
  today: Card[];             // 고정 3장
  morePool: Card[];          // 더 뽑기 풀(이미 연 카드 제외)
  ticketCount: number;
  dailyEarned: number;
  dailyLimit: number;        // 30
};
```
- 추천 소스: 기존 `/api/home/feed`/추천 로직 재사용(흡수). `canonical_events` `is_deleted=false`, 진행중/임박 우선.
- `opened`: 기존 `user_ticket_earn_log`(user,event,today)로 판정.

### `POST /api/visits` (requireAuth)  body `{ eventId: string }`
```ts
type VisitResponse = {
  ok: true;
  alreadyVisited: boolean;   // 재호출 시 true, 보너스 중복지급 없음
  bonusTickets: number;      // 신규 방문 시 +3, 재방문 시 0
  ticketCount: number;
  stampCount: number;        // 누적 도장 수
};
```
- **event당 평생 1회 멱등**: `UNIQUE(user_id, event_id)`. 신규일 때만 +3 티켓을 `user_tickets`에 가산하고 `user_visit_log` 기록. 단일 트랜잭션.
- 광고 daily limit(30)과 **별개**. 어뷰즈 가드: 하루 visit 보너스 최대 10건(초과 시 도장은 찍되 bonusTickets=0).

### `GET /api/passport` (requireAuth)
```ts
type PassportStamp = { eventId: string; title: string; category: string; visitedAt: string };
type PassportResponse = {
  passportNo: string;        // 유저 시퀀스/해시 → 4자리 zero-pad "0432"
  discoveredCount: number;   // earn_log distinct event (평생)
  visitedCount: number;      // user_visit_log distinct
  monthDiscovered: number;   // 이번달(KST) 발견 수
  tasteCategories: string[]; // 상위 2~3 카테고리
  stamps: PassportStamp[];   // 최근 방문(도장 그리드용, 최대 12)
};
```

### 프론트 서비스 시그니처 (신규/기존)
- 신규 `src/services/cardsService.ts`: `getTodayCards(): Promise<CardsTodayResponse>`
- 신규 `src/services/visitService.ts`: `markVisited(eventId: string): Promise<VisitResponse>`
- 신규 `src/services/passportService.ts`: `getPassport(): Promise<PassportResponse>`
- 기존 재사용 `ticketService.ts`: `earnTickets`, `exchangeTickets`, `getTickets`, `getTicketConfig`, `logRewardAdEvent`, `createRewardAdAttemptId`, `subscribeTicketCount`
- 기존 재사용: 북마크(저장) 서비스

---

## File Structure

**Backend**
- Create: `backend/migrations/20260701_culturecard_visit_log.sql` — `user_visit_log` 테이블
- Create: `backend/src/routes/cards.ts` — `GET /today`
- Create: `backend/src/routes/visits.ts` — `POST /` (+ 여권은 visits 또는 별도 passport.ts)
- Create: `backend/src/routes/passport.ts` — `GET /`
- Modify: `backend/src/index.ts` — 라우터 mount (`/api/cards`, `/api/visits`, `/api/passport`)
- Modify: `backend/src/database.types.ts` (재생성), `BACKEND_CONTRACT.md`

**Frontend**
- Create: `src/services/cardsService.ts`, `src/services/visitService.ts`, `src/services/passportService.ts`
- Create: `src/components/culture-card/*` (재작성: TicketCard/RevealCard/PassportHero/StampGrid 등 — 기존 로컬 3개는 폐기 후 재구성)
- Modify: `src/pages/index.tsx`(홈), `src/pages/saved.tsx`(저장), `src/pages/points.tsx`(→내 문화), `src/components/BottomTabBar.tsx`(라벨 "내 문화")
- Delete: `src/services/cultureCard/{domain,service,storage}.ts`, `src/services/__tests__/cultureCardDomain.test.ts`
- Delete(화면+라우트): `src/pages/{explore,hot,ending,nearby}.tsx`, `pages/{explore,hot,ending,nearby,search}.tsx`(+search), 관련 stub. router.gen 재생성.
- Cleanup: `페어픽.html`, `src/pages/index.backup.*.tsx`, `src/pages/explore.legacy.tsx`, `src/pages/test-route.tsx`, `backend/count-*.js`

---

## Tasks

### Task 0: 브랜치 + 스펙/계획 커밋 (계약 고정)
**Files:** (git)
- [ ] 새 브랜치 `feat/culturecard-rework` 생성 (main 보호)
- [ ] `docs/superpowers/specs/2026-06-30-culturecard-reward-design.md` + 이 계획 커밋
- [ ] **검수(Claude)**: 브랜치/커밋 확인. (사용자 커밋 규칙: 실행 직전 승인)

### Task A1: visit_log 마이그레이션 + 타입 재생성  [codex: backend]
**Files:** Create `backend/migrations/20260701_culturecard_visit_log.sql`; Modify `database.types.ts`, `BACKEND_CONTRACT.md`
**Produces:** 테이블 `user_visit_log(id uuid pk, user_id text, event_id text, bonus_tickets int, visited_at timestamptz default now(), created_at timestamptz default now(), UNIQUE(user_id,event_id))` + 인덱스 `(user_id, visited_at desc)`.
- [ ] SQL 작성 → `db-migrate` 스킬 흐름대로 apply → `database.types.ts` 재생성 → 미러/CONTRACT 갱신
- [ ] **검수**: 스키마 적용 확인, RLS deny-all 유지(service_role 경유) 확인

### Task A2: `GET /api/cards/today`  [codex: backend]
**Files:** Create `backend/src/routes/cards.ts`; Modify `index.ts`(mount `/api/cards`)
**Interfaces:** Produces `CardsTodayResponse`(위 계약). Consumes 기존 추천/`home/feed` 로직 + `user_ticket_earn_log`.
- [ ] **TDD**: 테스트 — 3장 today 반환 / opened 플래그 정확 / morePool에 opened 제외 / dailyLimit=30
- [ ] 구현: 추천 쿼리 재사용해 3장 + 풀 구성, Card 매핑(dday=end_at 기준), earn-status 조인
- [ ] `qa-verify`(backend build/test) 통과
- [ ] **검수**: 계약 일치(필드/타입), `is_deleted=false`·서버권위 확인

### Task A3: `POST /api/visits` (가봤어요/도장+보너스)  [codex: backend]
**Files:** Create `backend/src/routes/visits.ts`; Modify `index.ts`
**Interfaces:** Produces `VisitResponse`. 단일 트랜잭션, `user_visit_log` UNIQUE 게이트.
- [ ] **TDD**: 신규 방문 → +3·alreadyVisited=false / 재방문 → +0·alreadyVisited=true(멱등) / 하루 보너스 10건 초과 → 도장은 찍히되 bonus=0 / 동시요청 race → 1회만 보너스
- [ ] 구현: INSERT ON CONFLICT DO NOTHING 게이트 → 신규일 때만 user_tickets 가산 → COMMIT
- [ ] **검수(+pitfall-audit)**: 멱등·중복지급 방지·트랜잭션 경계

### Task A4: `GET /api/passport`  [codex: backend]
**Files:** Create `backend/src/routes/passport.ts`; Modify `index.ts`
**Interfaces:** Produces `PassportResponse`.
- [ ] **TDD**: discovered=earn_log distinct event / visited=visit_log distinct / monthDiscovered KST 경계 / tasteCategories 상위 / stamps 최신순 ≤12
- [ ] 구현: 집계 쿼리, passportNo 파생(유저 시퀀스 4자리 zero-pad)
- [ ] **검수**: 집계 정확성, 빈 유저(0건) 안전

### Task B1: 프론트 서비스 레이어 + 로컬 MVP 폐기  [codex: frontend]
**Files:** Create `cardsService.ts`/`visitService.ts`/`passportService.ts`; Delete `cultureCard/{domain,service,storage}.ts` + 그 테스트
**Interfaces:** 위 서비스 시그니처. `http` 클라이언트(기존 `src/lib/http`) 사용.
- [ ] 3개 서비스 작성(타입 = 계약과 일치), 기존 `ticketService` 재사용 확인
- [ ] 로컬 cultureCard 도메인/스토리지/테스트 삭제, 참조 끊기
- [ ] `qa-verify`(typecheck) 통과 — dangling import 0
- [ ] **검수**: 계약 타입 일치, Supabase 직접접근 없음

### Task B2: 홈 화면 재배선 (오늘의 카드 + 더뽑기 + 광고 + reveal)  [codex: frontend]
**Files:** Modify `src/pages/index.tsx`; Create/rework `src/components/culture-card/*`
**Interfaces:** Consumes `getTodayCards`, `earnTickets`, `logRewardAdEvent`, ad SDK. 디자인 = 시안 01/02(갤러리 티켓).
- [ ] 카드 스택(봉인 입장권) + "광고 보고 열기" → `load→loaded→show` → `userEarnedReward` → `earnTickets(eventId, attemptId)` → reveal(행사+적립 연출)
- [ ] **워치독/타임아웃**: 광고 콜백 누락 시 상태 복구(영구 프리즈 방지), `failedToShow`/`error`/`dismissed` 분기
- [ ] 더 뽑기: 하루 30 한도까지. `DAILY_LIMIT_REACHED` vs 광고없음 문구 분리
- [ ] **검수(+pitfall-audit)**: 광고 생명주기·fail-closed·워치독·테스트ID 잔존 0

### Task B3: 저장 화면 (북마크 + 가봤어요 도장)  [codex/frontend-engineer]
**Files:** Modify `src/pages/saved.tsx`
**Interfaces:** Consumes 기존 북마크 서비스 + `markVisited`. 디자인 = 시안 03/06.
- [ ] 가보고픈 행사 리스트(입장권 row, 카테고리색, D-day, 길찾기)
- [ ] "가봤어요" → `markVisited(eventId)` → 도장 연출 + "+3 티켓" 토스트(alreadyVisited면 안내만)
- [ ] **검수**: 멱등 UI(중복 도장 방지), 해요체

### Task B4: 내 문화 화면 (여권 + 잔액권 + 교환 + 내역)  [codex: frontend]
**Files:** Modify `src/pages/points.tsx`; `BottomTabBar.tsx`(라벨 "내 문화")
**Interfaces:** Consumes `getPassport`, `getTickets`, `exchangeTickets`, history. 디자인 = 시안 05.
- [ ] 여권 히어로(발견/도장/이번달 + 취향칩 + 도장 그리드) + 티켓 잔액권(7/10 핍) + 교환 CTA(`exchangeTickets` 2-step) + 최근 내역
- [ ] 가짜 `handleClaim` alert 제거. 교환 fail-closed 확인. 스크롤뷰
- [ ] **검수**: 교환 2-step·멱등, 잔액 서버권위

### Task B5: 레거시 화면 제거 + 라우터 재생성 + 잡동사니 정리  [codex: frontend]
**Files:** Delete explore/hot/ending/nearby/search 화면·라우트; regen `src/router.gen.ts`; remove 백업/junk
- [ ] 화면+라우트 삭제, 추천 로직만 백엔드 카드공급으로 흡수됐는지 확인(프론트 잔재 0)
- [ ] `granite` 라우터 재생성 → `/`,`/saved`,`/points`,`/events/:id`,`/about`,`/mypage*` 만 남김(또는 합의된 최소셋)
- [ ] `페어픽.html`·`index.backup.*`·`explore.legacy`·`test-route`·`count-*.js` 정리
- [ ] **검수**: `qa-verify` 풀세트(typecheck/lint/build) + 라우트 정합

### Task C1: 통합 검증 + 번들 재빌드  [Claude + qa-verify/pitfall-audit]
- [ ] `qa-verify`: 프론트 typecheck/lint/build + 백엔드 build/test
- [ ] `pitfall-audit`: 광고/보상/멱등/정책 함정 스캔
- [ ] 번들 stale 재빌드(`ait build`) — 콘솔 업로드는 사용자(G5)
- [ ] **검수**: 하드규칙 체크리스트, release-preflight 예비

---

## Self-Review (스펙 커버리지)
- 경제(수집형 10→교환) = 기존 엔진 재사용(변경 없음) ✓ / 카드공급 A2 ✓ / 가봤어요·도장 A3·B3 ✓ /
  여권 A4·B4 ✓ / 홈 광고 reveal B2 ✓ / 레거시 흡수·정리 B5 ✓ / 통화·탭·토큰 Global Constraints ✓ /
  검증 C1 ✓. 월간 리포트는 v1.1(범위 밖, 스펙 명시).

## 실행 모델 (codex + 서브에이전트)
- 의존: A1→(A2,A3,A4 병렬 가능) ; B1→(B2,B3,B4) ; B5는 B2~B4 후 ; C1 마지막.
- **병렬 트랙**: 백엔드(A1~A4)=codex / 프론트(B1~B4)=codex 또는 `frontend-engineer` — 단 **계약 잠금(이 문서)** 기준.
- 각 task: codex 빌드 → Claude 검수(+필요시 `reviewer`/`pitfall-audit`) → 다음.
