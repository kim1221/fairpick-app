/**
 * 테마 컬렉션 표시용 순수 헬퍼.
 * 시안 collection-sets-v1: 마닐라 폴더 카드 · 진행 도트 · D-n · 레드 날짜 스탬프.
 */

import type { ThemeCollectionSet } from '../../services/themeCollectionService';

const TEMPLATE_LABELS: Record<string, string> = {
  neighborhood: '동네',
  season: '시즌',
  deepdive: '딥다이브',
  buzz: '지금 뜨는',
};

const STAMP_MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

export function templateLabel(template: string): string {
  return TEMPLATE_LABELS[template] ?? '테마';
}

/** 폴더 카드 아이브로우: "SET · 동네 · 서울" (전국 세트는 지역 생략) */
export function setEyebrow(set: Pick<ThemeCollectionSet, 'template' | 'regionScope'>): string {
  const parts = ['SET', templateLabel(set.template)];
  if (set.regionScope) parts.push(set.regionScope);
  return parts.join(' · ');
}

export function ddayLabel(daysRemaining: number): string {
  if (daysRemaining <= 0) return '오늘 마감';
  return `D-${daysRemaining}`;
}

/** 채운 슬롯의 레드 날짜 스탬프: "JUL 16" (시안 ②). 파싱 실패 시 null. */
export function formatStampDate(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return `${STAMP_MONTHS[date.getMonth()]} ${date.getDate()}`;
}

/** 진행 도트(채움 여부 배열). 시안 ①: ●●●○○ 3/5 */
export function progressDots(filledCount: number, totalSlots: number): boolean[] {
  const total = Math.max(0, totalSlots);
  return Array.from({ length: total }, (_, index) => index < Math.min(filledCount, total));
}
