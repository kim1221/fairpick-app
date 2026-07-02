# 컬처카드 전환 — 작업 핸드오프 (2026-07-02)

> 컨텍스트 클리어 후 이 문서부터 읽고 이어가면 됨. 브랜치 `feat/culturecard-rework`.

## 무엇을 하고 있나
FairPick(문화 큐레이션 앱) → **컬처카드**(리워드형 문화 카드 앱)로 전환.
핵심 루프: 광고 보고 "오늘의 문화 카드" 열기 → 티켓 1~3 랜덤 적립 → 10티켓 = 토스포인트 교환.
차별화: **문화 여권 + 가봤어요 GPS 도장**(실제 방문 시 도장+보너스).

- 스펙: `docs/superpowers/specs/2026-06-30-culturecard-reward-design.md`
- 계획: `docs/superpowers/plans/2026-07-01-culturecard-implementation.md`
- 디자인 목업: `docs/design/mockups/*.html`, 아이콘 SVG: `docs/design/icon-src/*`

## 작업 방식 (사용자 선호)
- **codex 플러그인으로 무거운 구현 위임** → Claude가 검수 → 커밋. 프롬프트는 파일로 빼서
  `codex exec --sandbox workspace-write --output-last-message OUT - < prompt.txt` (stdin heredoc은 백그라운드에서 멈춤).
- Claude 서브에이전트(frontend-engineer 등)도 병렬 사용하되, **Claude 세션 한도 걸리면 서브에이전트는 죽음. codex는 독립(ChatGPT 구독)이라 계속 감** → 한도 구간엔 프론트도 codex로.
- 디자인은 사용자가 **Claude Design(claude.ai/design)에 직접 프롬프트 넣어 시안 생성** → Claude는 넣을 프롬프트만 작성. (Claude가 목업 만드는 것도 가능하나 사용자는 Claude Design 선호)
- 커밋은 main 아닌 브랜치에서, 사용자 승인 후. 배포/머지/업로드는 사람 게이트.

## 완료된 것 (feat/culturecard-rework, 13 커밋)
- ✅ 프론트 서비스 3종: cardsService/visitService/passportService (계약 일치)
- ✅ 백엔드 엔드포인트: GET /api/cards/today, POST /api/visits, GET /api/passport
- ✅ 마이그레이션 2개 **라이브 적용 완료**: `user_visit_log`, checkin_lat/lng
- ✅ 4개 화면: 홈(광고 reveal+워치독 15/60s+fail-closed), 저장(북마크+가봤어요 도장),
  내 문화(여권+티켓 잔액/교환+내역). 탭 3개(홈/저장/내 문화).
- ✅ **A안 위치기반**: cards/today 내주변 우선(반경 3→10→50km→전국)+카테고리 다양성+walkMinutes 실계산.
  visits GPS **fail-closed**(400m+행사기간 검증돼야만 도장+3티켓 — 어뷰징 차단). 기존
  recommendationService/geo.ts(haversine)/useTodayBanner 위치패턴 재사용. currentLocation.ts 유틸 분리.
- ✅ 레거시 제거: explore/hot/ending/nearby/search 화면·라우트, 로컬 cultureCard MVP,
  잡동사니(페어픽.html·count-*.js), dead MagazineCard. router.gen 재생성.
- ✅ history에 visit(가봤어요 도장) union.
- ✅ 앱 아이콘/썸네일(입장권 컨셉, 한자 뺀 모던 버전 GPT로 재생성) — **사용자가 이미 콘솔에 넣고 앱정보 심사 중**.
- ✅ 검증: 번들 ait build 0/0, 백엔드 test 10/10, 앱 tsc 변경분 0.
- 브랜드: granite.config displayName '컬처카드'(icon URL은 콘솔에서 처리 중).

## 결정된 경제/제품 모델
- 수집형 유지(10티켓=1교환). 즉시지급/상시교환은 제네릭 리워드앱 함정이라 기각.
- 오늘의 카드 3장 고정 + 더뽑기(하루 30티켓 한도). 통화 표기 "티켓", 교환 "토스포인트".
- 가봤어요 도장: **GPS 검증(A안)** 이라 +3 보너스 정당. B안(무보상)은 기각됨.

## 지금 위치 / 다음 할 일
사용자 질문: "앱정보 심사 넣었고, 실제 배포해서 테스트하면 되나?" → 답변함:
1. **백엔드 먼저 배포 필요**(앱이 API 쳐야 테스트됨). 안전(추가형·마이그레이션 적용됨·새 env 없음).
   방법: feat/culturecard-rework → **main 머지 + push → Railway 자동배포**.
   ⚠️ 기존 페어픽 main을 컬처카드로 대체하는 것 인지.
2. **프론트는 전면출시(G5) 전에 테스트빌드로 기기 검증** — 특히 **GPS 체크인은 실기기 실제 위치로만 검증 가능**.
3. 사용자가 "배포/머지 해달라" 하면 G4로 진행(승인 영역).

### 남은 TODO
- [ ] G4: feat→main 머지+push(Railway 배포) — **사용자 승인 대기 중**
- [ ] G3: 기기 테스트(로그인→홈 위치카드→광고 열기→적립 / 저장 가봤어요 GPS→도장 / 내문화 교환)
- [ ] (선택) PR 생성 feat→main
- [ ] (선택) 스펙에 A안(위치/GPS) 동기화, database.types.ts 정식 재생성, dead code(sections/* 등) 스윕
- [ ] 콘솔 등록정보 컬처카드로 교체(값은 이미 제공: 이름 컬처카드/Culture Card, 부제 "오늘의 문화 카드 열고 포인트", appName은 fairpick-app 유지)

## 주의점
- appName `fairpick-app`은 내부 식별자 → 절대 변경 금지(scheme/서버/유저데이터 묶임).
- backend/certs/ 는 실제 인증서 → 커밋/삭제 금지.
- pitfall-audit 훅이 session.ts:6 주석을 AsyncStorage로 오탐 → 무시.
- 루트 tsconfig가 backend/admin-web까지 포함 → 전체 tsc는 기존 에러 다수. "변경분 0"로 판단.
