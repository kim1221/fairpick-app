/**
 * 배너(InlineAd) 배치별 광고 그룹 ID — 단일 소스.
 * 콘솔에서 만든 "라이브" ID만 사용한다(테스트 ID 절대 금지 — 검수 반려).
 * 빈 문자열이면 해당 슬롯은 아무것도 렌더하지 않는다(안전 기본값).
 *
 * 배치 원칙(2026-07-23 결정, 애드몹 정책 준수):
 * - 한 화면(뷰포트)에 배너가 2개 동시에 보이지 않게 간격 유지.
 * - CTA 버튼과는 넉넉한 여백(오클릭 유도 금지).
 * - 영수증·카드 공개 등 보상 순간에는 배치하지 않는다.
 *
 * 콘솔 광고 그룹(2026-07-23):
 * - 문구 강조 배너: ait.v2.live.6526c6e693454a28
 * - 이미지 강조 배너: ait.v2.live.b3363cb4c82643e9
 */
const BANNER_TEXT = 'ait.v2.live.6526c6e693454a28'; // 문구 강조
const BANNER_IMAGE = 'ait.v2.live.b3363cb4c82643e9'; // 이미지 강조

export const AD_PLACEMENTS = {
  /** 리워드 탭 — 잔액 카드와 포인트 뽑기 버튼 사이 (이미지 강조형) */
  rewardsTab: BANNER_IMAGE,
  /** 홈 — "광고 보고 카드 열기" CTA 아래 (문구 강조형) */
  homeBelowCta: BANNER_TEXT,
  /** 컬렉션 탭 — 테마 컬렉션 섹션 아래 (이미지 강조형) */
  collectionTop: BANNER_IMAGE,
  /** 컬렉션 탭 — 큐레이션과 내가 연 카드 사이 (문구 강조형) */
  collectionMid: BANNER_TEXT,
  /** 세트 상세 — 하단 고정 (문구 강조형) */
  setDetailBottom: BANNER_TEXT,
  /** 이벤트 상세 — 하단 고정 (문구 강조형) */
  eventDetailBottom: BANNER_TEXT,
} as const;
