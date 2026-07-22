import { describe, expect, test } from '@jest/globals';
import { ddayLabel, formatStampDate, progressDots, setEyebrow, templateLabel } from '../themeCollectionData';

describe('themeCollectionData', () => {
  test('setEyebrow includes template label and region scope when present', () => {
    expect(setEyebrow({ template: 'neighborhood', regionScope: '서울' })).toBe('SET · 동네 · 서울');
    expect(setEyebrow({ template: 'season', regionScope: null })).toBe('SET · 시즌');
    expect(setEyebrow({ template: 'unknown-template', regionScope: null })).toBe('SET · 테마');
  });

  test('templateLabel maps the four batch templates', () => {
    expect(templateLabel('neighborhood')).toBe('동네');
    expect(templateLabel('season')).toBe('시즌');
    expect(templateLabel('deepdive')).toBe('딥다이브');
    expect(templateLabel('buzz')).toBe('지금 뜨는');
  });

  test('ddayLabel renders D-n and same-day deadline', () => {
    expect(ddayLabel(14)).toBe('D-14');
    expect(ddayLabel(0)).toBe('오늘 마감');
  });

  test('formatStampDate renders the red stamp date and tolerates bad input', () => {
    expect(formatStampDate('2026-07-16T09:00:00.000Z')).toMatch(/^JUL 1[67]$/);
    expect(formatStampDate(null)).toBeNull();
    expect(formatStampDate('not-a-date')).toBeNull();
  });

  test('progressDots marks filled slots first and clamps overflow', () => {
    expect(progressDots(3, 5)).toEqual([true, true, true, false, false]);
    expect(progressDots(9, 4)).toEqual([true, true, true, true]);
    expect(progressDots(0, 0)).toEqual([]);
  });
});
