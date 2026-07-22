/**
 * 포인트 뽑기 금액 분포 요약(정직 표기용) — 프레임워크 의존 없는 순수 모듈.
 * UI 컴포넌트가 http 체인(@apps-in-toss/framework) 없이 import할 수 있게 분리했다(jest 로드 이슈).
 */
export type ExchangeAmountRange = {
  min: number;
  max: number;
  average: number;
};

/** 서버 추첨 테이블과 동기화되는 표시용 폴백(스펙 §2.4). 서버 config가 오면 그 값을 쓴다. */
export const EXCHANGE_AMOUNT_RANGE_FALLBACK: ExchangeAmountRange = { min: 10, max: 500, average: 20 };
