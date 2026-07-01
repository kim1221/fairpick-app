import { describe, expect, test } from '@jest/globals';
import {
  formatSavedTicketMeta,
  getDdayBadge,
  normalizeSavedCategory,
} from './savedTicketUtils';

describe('saved ticket utilities', () => {
  test('marks events ending within three days as urgent D-day badges', () => {
    expect(getDdayBadge('2026-07-04T14:00:00.000Z', new Date('2026-07-01T09:00:00+09:00'))).toEqual({
      label: 'D-3 마감임박',
      urgent: true,
    });
  });

  test('formats normal D-day badges without urgency copy', () => {
    expect(getDdayBadge('2026-07-15', new Date('2026-07-01T09:00:00+09:00'))).toEqual({
      label: 'D-14',
      urgent: false,
    });
  });

  test('normalizes popup category from main or sub category', () => {
    expect(normalizeSavedCategory('행사', '브랜드 팝업')).toBe('팝업');
    expect(normalizeSavedCategory('공연', '')).toBe('공연');
    expect(normalizeSavedCategory(undefined, undefined)).toBe('기타');
  });

  test('formats venue, region, and walk minutes for ticket rows', () => {
    expect(formatSavedTicketMeta({ venue: '디뮤지엄', region: '서울', walkMinutes: 12 })).toBe('디뮤지엄 · 서울 · 도보 12분');
    expect(formatSavedTicketMeta({ venue: '예술의전당', region: '서초' })).toBe('예술의전당 · 서초');
  });
});
