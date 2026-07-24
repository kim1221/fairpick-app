import { describe, expect, test } from '@jest/globals';
import { distanceRowLabel, formatWalkOrDistance } from '../distanceLabel';

describe('formatWalkOrDistance', () => {
  test('shows walk minutes within 40 min', () => {
    expect(formatWalkOrDistance(1)).toBe('도보 1분');
    expect(formatWalkOrDistance(14)).toBe('도보 14분');
    expect(formatWalkOrDistance(40)).toBe('도보 40분');
  });

  test('switches to km beyond 40 min (no absurd walk hours)', () => {
    // 41분(약 3.3km) → km. 625분(50km) → "약 50km".
    expect(formatWalkOrDistance(41)).toBe('약 3km');
    expect(formatWalkOrDistance(625)).toBe('약 50km');
  });

  test('returns null for missing/invalid input', () => {
    expect(formatWalkOrDistance(null)).toBeNull();
    expect(formatWalkOrDistance(undefined)).toBeNull();
    expect(formatWalkOrDistance(0)).toBeNull();
  });
});

describe('distanceRowLabel', () => {
  test('WALK for walk labels, DIST otherwise', () => {
    expect(distanceRowLabel('도보 14분')).toBe('WALK');
    expect(distanceRowLabel('약 50km')).toBe('DIST');
    expect(distanceRowLabel(null)).toBe('DIST');
  });
});
