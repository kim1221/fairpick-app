import { Storage } from '@apps-in-toss/framework';

const STORAGE_KEY = 'fairpick.searchHistory.v2';
const STORAGE_KEY_V1 = 'fairpick.searchHistory.v1';
const MAX_HISTORY = 10;
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30일

// ─────────────────────────────────────────────────
// v2 데이터 구조: 검색어별 개별 저장 시각
// ─────────────────────────────────────────────────
interface SearchTermEntry {
  term: string;
  savedAt: string; // ISO 8601
}

interface SearchHistoryV2 {
  terms: SearchTermEntry[];
  version: 'v2';
}

// ─────────────────────────────────────────────────
// v1 → v2 마이그레이션 (한 번만 실행)
// v1: { terms: string[], version: 'v1', updatedAt: string }
// v2: { terms: { term, savedAt }[], version: 'v2' }
// ─────────────────────────────────────────────────
async function migrateV1(): Promise<SearchTermEntry[]> {
  try {
    const raw = await Storage.getItem(STORAGE_KEY_V1);
    if (!raw) return [];

    const v1 = JSON.parse(raw);
    if (!Array.isArray(v1.terms)) return [];

    // v1에는 개별 시각이 없으므로 updatedAt을 모든 항목의 savedAt으로 사용
    const fallbackDate = v1.updatedAt ?? new Date().toISOString();
    const migrated: SearchTermEntry[] = v1.terms.map((term: string) => ({
      term,
      savedAt: fallbackDate,
    }));

    if (__DEV__) console.log('[SearchStorage] v1 마이그레이션:', migrated.length, '개');

    // v1 키 삭제
    await Storage.removeItem(STORAGE_KEY_V1);
    return migrated;
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────────
// 최근 검색어 불러오기 (TTL 적용)
// ─────────────────────────────────────────────────
export async function getSearchHistory(): Promise<string[]> {
  try {
    let raw = await Storage.getItem(STORAGE_KEY);

    // v2 데이터 없으면 v1 마이그레이션 시도
    if (!raw) {
      const migrated = await migrateV1();
      if (migrated.length > 0) {
        await _saveEntries(migrated);
        raw = await Storage.getItem(STORAGE_KEY);
      }
    }

    if (!raw) return [];

    const data: SearchHistoryV2 = JSON.parse(raw);
    if (!Array.isArray(data.terms)) return [];

    // TTL 필터: 30일 이내 항목만 반환 (삭제는 하지 않음 — 읽기 시 걸러냄)
    const now = Date.now();
    const valid = data.terms.filter(entry => {
      const age = now - new Date(entry.savedAt).getTime();
      return age <= TTL_MS;
    });

    return valid.map(entry => entry.term);
  } catch (error) {
    console.error('[SearchStorage] Read error:', error);
    return [];
  }
}

// ─────────────────────────────────────────────────
// 내부 헬퍼: entries 저장
// ─────────────────────────────────────────────────
async function _saveEntries(entries: SearchTermEntry[]): Promise<void> {
  const data: SearchHistoryV2 = { terms: entries, version: 'v2' };
  await Storage.setItem(STORAGE_KEY, JSON.stringify(data));
}

// ─────────────────────────────────────────────────
// 검색어 저장 — 명확한 의도(submit / 결과 클릭)시만 호출
// ─────────────────────────────────────────────────
export async function saveSearchTerm(term: string): Promise<void> {
  try {
    const raw = await Storage.getItem(STORAGE_KEY);
    let entries: SearchTermEntry[] = [];

    if (raw) {
      const data: SearchHistoryV2 = JSON.parse(raw);
      if (Array.isArray(data.terms)) {
        entries = data.terms;
      }
    }

    // 저장 전 만료 항목 제거 — 슬롯 점령 버그 방지
    const now = Date.now();
    const fresh = entries.filter(e => now - new Date(e.savedAt).getTime() <= TTL_MS);

    // 중복 제거 + 최신이 맨 앞 + 최대 10개
    const updated: SearchTermEntry[] = [
      { term, savedAt: new Date().toISOString() },
      ...fresh.filter(e => e.term !== term),
    ].slice(0, MAX_HISTORY);

    await _saveEntries(updated);
    if (__DEV__) console.log('[SearchStorage] Saved:', term);
  } catch (error) {
    console.error('[SearchStorage] Save error:', error);
  }
}

// ─────────────────────────────────────────────────
// 검색어 개별 삭제
// ─────────────────────────────────────────────────
export async function removeSearchTerm(term: string): Promise<void> {
  try {
    const raw = await Storage.getItem(STORAGE_KEY);
    if (!raw) return;

    const data: SearchHistoryV2 = JSON.parse(raw);
    const updated = (data.terms ?? []).filter(e => e.term !== term);
    await _saveEntries(updated);
  } catch (error) {
    console.error('[SearchStorage] Remove error:', error);
  }
}

// ─────────────────────────────────────────────────
// 전체 삭제
// ─────────────────────────────────────────────────
export async function clearSearchHistory(): Promise<void> {
  try {
    await Storage.removeItem(STORAGE_KEY);
    if (__DEV__) console.log('[SearchStorage] Cleared');
  } catch (error) {
    console.error('[SearchStorage] Clear error:', error);
  }
}
