export type SavedTicketCategory = '전시' | '공연' | '팝업' | '축제' | '기타';

export type DdayBadge = {
  label: string;
  urgent: boolean;
};

export const SAVED_CATEGORY_COLORS: Record<SavedTicketCategory, string> = {
  전시: '#3182F6',
  공연: '#A8324A',
  팝업: '#D08A2C',
  축제: '#3E8E5A',
  기타: '#9C7635',
};

export const SAVED_CATEGORY_DARK_COLORS: Record<SavedTicketCategory, string> = {
  전시: '#16223F',
  공연: '#2A1018',
  팝업: '#5A3410',
  축제: '#193626',
  기타: '#332613',
};

const DAY_MS = 24 * 60 * 60 * 1000;

function parseLocalDate(value: string): Date | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;

  const [, year, month, day] = match;
  if (!year || !month || !day) return null;

  return new Date(Number(year), Number(month) - 1, Number(day));
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function getDdayBadge(endAt?: string | null, referenceDate = new Date()): DdayBadge {
  if (!endAt) {
    return { label: '일정 확인', urgent: false };
  }

  const endDate = parseLocalDate(endAt);
  if (!endDate) {
    return { label: '일정 확인', urgent: false };
  }

  const diffDays = Math.ceil((endDate.getTime() - startOfLocalDay(referenceDate).getTime()) / DAY_MS);
  if (diffDays < 0) {
    return { label: '종료', urgent: false };
  }
  if (diffDays === 0) {
    return { label: 'D-DAY 마감임박', urgent: true };
  }
  if (diffDays <= 3) {
    return { label: `D-${diffDays} 마감임박`, urgent: true };
  }
  return { label: `D-${diffDays}`, urgent: false };
}

export function normalizeSavedCategory(mainCategory?: string | null, subCategory?: string | null): SavedTicketCategory {
  const combined = `${mainCategory ?? ''} ${subCategory ?? ''}`;
  if (combined.includes('팝업')) return '팝업';
  if (combined.includes('전시')) return '전시';
  if (combined.includes('공연') || combined.includes('연극') || combined.includes('콘서트')) return '공연';
  if (combined.includes('축제') || combined.includes('페스티벌')) return '축제';
  return '기타';
}

export function formatSavedTicketMeta({
  venue,
  region,
  walkMinutes,
}: {
  venue?: string | null;
  region?: string | null;
  walkMinutes?: number | null;
}): string {
  const parts = [venue, region]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part));

  if (typeof walkMinutes === 'number' && Number.isFinite(walkMinutes) && walkMinutes > 0) {
    parts.push(`도보 ${Math.round(walkMinutes)}분`);
  }

  return parts.length > 0 ? parts.join(' · ') : '장소 확인 중';
}
