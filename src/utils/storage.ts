/**
 * 로컬 스토리지 유틸리티 V2
 * 찜(likes)과 최근 본(recent) 이벤트 데이터를 기기에 저장/조회
 *
 * @apps-in-toss/framework의 Storage API 사용 (영구 저장 보장)
 *
 * [V2 변경사항]
 * - ID 배열 → 객체 배열 (snapshot 포함)
 * - API 실패 시에도 placeholder로 표시 가능
 * - 최근본: 최대 50개 LRU + 누적 totalCount 관리
 *
 * [Storage 이벤트 시스템]
 * - 찜/최근본 변경 시 구독자에게 알림을 보내 즉시 UI 갱신 가능
 */

import { Storage as TossStorage } from '@apps-in-toss/framework';

// ============================================================
// V2 타입 정의
// ============================================================

/**
 * 저장된 이벤트 아이템 (V2)
 */
export interface StoredEventItemV2 {
  id: string;
  timestamp: string; // ISO string (likedAt 또는 viewedAt)
  lastKnownStatus: 'active' | 'ended' | 'deleted';
  snapshot?: {
    title?: string;
    startAt?: string;
    endAt?: string;
    venue?: string;
    region?: string;
    imageUrl?: string;
    mainCategory?: string;
    subCategory?: string;
  };
}

/**
 * 찜 데이터 구조 (V2)
 */
export interface LikesDataV2 {
  version: 2;
  items: StoredEventItemV2[];
}

/**
 * 최근본 데이터 구조 (V2)
 */
export interface RecentDataV2 {
  version: 2;
  items: StoredEventItemV2[]; // 최대 50개
  totalCount: number; // 누적 카운트
}

// Storage 변경 이벤트 타입
export type StorageChangeEvent = {
  type: 'likes' | 'recent';
  action: 'add' | 'remove' | 'update';
  id?: string;
  count: number;
};

// Storage 변경 리스너 타입
type StorageChangeListener = (event: StorageChangeEvent) => void;

// 리스너 목록 (in-memory pub/sub)
const storageListeners: StorageChangeListener[] = [];

/**
 * Storage 변경 이벤트 구독
 * @returns 구독 해제 함수
 */
export function subscribeStorageChange(listener: StorageChangeListener): () => void {
  console.log('[Storage][Subscribe] New listener registered', {
    totalListeners: storageListeners.length + 1,
    timestamp: new Date().toISOString()
  });

  storageListeners.push(listener);

  // 구독 해제 함수 반환
  return () => {
    const index = storageListeners.indexOf(listener);
    if (index > -1) {
      storageListeners.splice(index, 1);
      console.log('[Storage][Unsubscribe] Listener removed', {
        totalListeners: storageListeners.length,
        timestamp: new Date().toISOString()
      });
    }
  };
}

/**
 * Storage 변경 이벤트 발행
 */
function emitStorageChange(event: StorageChangeEvent): void {
  console.log('[Storage][Emit] Broadcasting change event', {
    event,
    listenerCount: storageListeners.length,
    timestamp: new Date().toISOString()
  });

  storageListeners.forEach(listener => {
    try {
      listener(event);
    } catch (error) {
      console.error('[Storage][Emit] Listener error', {
        error,
        errorMessage: error instanceof Error ? error.message : String(error)
      });
    }
  });
}

/**
 * Storage 변경 이벤트 수동 발행 (외부에서 사용)
 */
export function emitStorageChangeEvent(event: StorageChangeEvent): void {
  emitStorageChange(event);
}

const STORAGE_KEYS = {
  LIKES: 'fairpick_likes',
  RECENT: 'fairpick_recent',
  RECENT_TOTAL_COUNT: 'fairpick_recent_total_count',
  PREFERENCES: 'fairpick_preferences',
  BANNER_HISTORY: 'fairpick_today_banner_history_v1',
  BANNER_DEBUG: 'fairpick_today_banner_debug_enabled_v1',
  GEMINI_CACHE: 'fairpick_banner_gemini_cache_v1',
  TODAY_BANNER: 'fairpick_today_banner_v1',
  AI_CACHE_BYPASS: 'fairpick_ai_cache_bypass_dev', // 개발용 캐시 바이패스 플래그
  AI_NOTICE_SHOWN: 'fairpick_ai_notice_shown', // 생성형 AI 사전 고지 표시 여부
} as const;

// DEV: Storage 객체 존재 확인 (한 번만)
if (__DEV__) {
  console.log('[Storage][Env] Storage methods:', {
    getItem: typeof TossStorage?.getItem,
    setItem: typeof TossStorage?.setItem,
    available: typeof TossStorage !== 'undefined'
  });
}

/**
 * JSON 배열 데이터 읽기 (안전장치 포함)
 */
export async function readJsonArray(key: string): Promise<string[]> {
  try {
    console.log(`[Storage][readJsonArray][START] key=${key}, timestamp=${new Date().toISOString()}`);

    if (!TossStorage || typeof TossStorage.getItem !== 'function') {
      console.error('[Storage][readJsonArray][CRITICAL] TossStorage.getItem is not available!', {
        TossStorageType: typeof TossStorage,
        getItemType: typeof TossStorage?.getItem,
        TossStorageKeys: TossStorage ? Object.keys(TossStorage) : []
      });
      return [];
    }

    const raw = await TossStorage.getItem(key);
    console.log(`[Storage][readJsonArray][RAW_RESULT] key=${key}, hasValue=${!!raw}, rawLength=${raw?.length}, raw=${raw?.substring(0, 200)}`);

    if (!raw) {
      console.log(`[Storage][readJsonArray][EMPTY] key=${key} returned null/undefined`);
      return [];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      console.warn(`[Storage][readJsonArray][NOT_ARRAY] ${key} is not an array, resetting to []`, { parsed });
      return [];
    }

    console.log(`[Storage][readJsonArray][SUCCESS] key=${key}, arrayLength=${parsed.length}`);
    return parsed;
  } catch (error) {
    console.error(`[Storage][readJsonArray][EXCEPTION] key=${key}`, {
      error,
      errorMessage: error instanceof Error ? error.message : String(error),
      errorStack: error instanceof Error ? error.stack : undefined
    });
    return [];
  }
}

/**
 * V2 데이터 읽기 (Likes)
 */
async function readLikesV2(): Promise<LikesDataV2> {
  try {
    const raw = await TossStorage.getItem(STORAGE_KEYS.LIKES);
    if (!raw) {
      console.log('[Storage][readLikesV2] No data, returning empty v2');
      return { version: 2, items: [] };
    }

    const parsed = JSON.parse(raw);

    // V1 마이그레이션 (string[] → V2)
    if (Array.isArray(parsed)) {
      console.log('[Storage][readLikesV2] Migrating v1 to v2', { v1Count: parsed.length });
      const items: StoredEventItemV2[] = parsed.map((id) => ({
        id,
        timestamp: new Date().toISOString(),
        lastKnownStatus: 'active' as const,
      }));
      return { version: 2, items };
    }

    // V2 구조 확인
    if (parsed.version === 2 && Array.isArray(parsed.items)) {
      console.log('[Storage][readLikesV2] V2 data loaded', { itemCount: parsed.items.length });
      return parsed as LikesDataV2;
    }

    // 알 수 없는 구조
    console.warn('[Storage][readLikesV2] Unknown structure, resetting', { parsed });
    return { version: 2, items: [] };
  } catch (error) {
    console.error('[Storage][readLikesV2] Exception', { error });
    return { version: 2, items: [] };
  }
}

/**
 * V2 데이터 쓰기 (Likes)
 */
export async function writeLikesV2(data: LikesDataV2): Promise<void> {
  try {
    const jsonStr = JSON.stringify(data);
    await TossStorage.setItem(STORAGE_KEYS.LIKES, jsonStr);
    console.log('[Storage][writeLikesV2] Saved', { itemCount: data.items.length });
  } catch (error) {
    console.error('[Storage][writeLikesV2] Exception', { error });
    throw error;
  }
}

/**
 * V2 데이터 읽기 (Recent)
 */
async function readRecentV2(): Promise<RecentDataV2> {
  try {
    const raw = await TossStorage.getItem(STORAGE_KEYS.RECENT);
    if (!raw) {
      console.log('[Storage][readRecentV2] No data, returning empty v2');
      return { version: 2, items: [], totalCount: 0 };
    }

    const parsed = JSON.parse(raw);

    // V1 마이그레이션 (string[] → V2)
    if (Array.isArray(parsed)) {
      console.log('[Storage][readRecentV2] Migrating v1 to v2', { v1Count: parsed.length });
      const items: StoredEventItemV2[] = parsed.map((id) => ({
        id,
        timestamp: new Date().toISOString(),
        lastKnownStatus: 'active' as const,
      }));
      return { version: 2, items, totalCount: parsed.length };
    }

    // V2 구조 확인
    if (parsed.version === 2 && Array.isArray(parsed.items)) {
      console.log('[Storage][readRecentV2] V2 data loaded', {
        itemCount: parsed.items.length,
        totalCount: parsed.totalCount,
      });
      return parsed as RecentDataV2;
    }

    // 알 수 없는 구조
    console.warn('[Storage][readRecentV2] Unknown structure, resetting', { parsed });
    return { version: 2, items: [], totalCount: 0 };
  } catch (error) {
    console.error('[Storage][readRecentV2] Exception', { error });
    return { version: 2, items: [], totalCount: 0 };
  }
}

/**
 * V2 데이터 쓰기 (Recent)
 */
export async function writeRecentV2(data: RecentDataV2): Promise<void> {
  try {
    const jsonStr = JSON.stringify(data);
    await TossStorage.setItem(STORAGE_KEYS.RECENT, jsonStr);
    console.log('[Storage][writeRecentV2] Saved', {
      itemCount: data.items.length,
      totalCount: data.totalCount,
    });
  } catch (error) {
    console.error('[Storage][writeRecentV2] Exception', { error });
    throw error;
  }
}

/**
 * JSON 배열 데이터 쓰기
 */
export async function writeJsonArray(key: string, arr: string[]): Promise<void> {
  try {
    console.log(`[Storage][writeJsonArray][START] key=${key}, arrayLen=${arr.length}, first5=${arr.slice(0, 5).join(',')}, timestamp=${new Date().toISOString()}`);

    if (!TossStorage || typeof TossStorage.setItem !== 'function') {
      console.error('[Storage][writeJsonArray][CRITICAL] TossStorage.setItem is not available!', {
        TossStorageType: typeof TossStorage,
        setItemType: typeof TossStorage?.setItem,
        TossStorageKeys: TossStorage ? Object.keys(TossStorage) : []
      });
      throw new Error('TossStorage.setItem is not available');
    }

    const jsonStr = JSON.stringify(arr);
    console.log(`[Storage][writeJsonArray][BEFORE_SETITEM] key=${key}, jsonLength=${jsonStr.length}, jsonPreview=${jsonStr.substring(0, 100)}`);

    await TossStorage.setItem(key, jsonStr);
    console.log(`[Storage][writeJsonArray][AFTER_SETITEM] key=${key}, wrote ${jsonStr.length} chars`);

    // 저장 검증: 즉시 재조회
    const persisted = await TossStorage.getItem(key);
    const persistedMatch = persisted === jsonStr;

    console.log('[Storage][writeJsonArray][VERIFY]', {
      key,
      persistedMatch,
      persistedLen: persisted?.length,
      expectedLen: jsonStr.length,
      persisted: persisted?.substring(0, 100) + '...',
      expected: jsonStr.substring(0, 100) + '...',
      timestamp: new Date().toISOString()
    });

    if (!persistedMatch) {
      console.error('[Storage][writeJsonArray][MISMATCH] Storage verification failed!', {
        key,
        persisted,
        expected: jsonStr,
        persistedIsNull: persisted === null,
        persistedIsUndefined: persisted === undefined
      });
      throw new Error(`Storage verification failed for key=${key}`);
    }

    console.log(`[Storage][writeJsonArray][SUCCESS] key=${key}`);
  } catch (error) {
    console.error(`[Storage][writeJsonArray][EXCEPTION] Failed to write ${key}`, {
      error,
      errorMessage: error instanceof Error ? error.message : String(error),
      errorStack: error instanceof Error ? error.stack : undefined,
      arrayLength: arr.length
    });
    throw error; // 에러를 위로 전파
  }
}

/**
 * 찜한 이벤트 목록 가져오기 (V2)
 * @returns V2 데이터 구조 (items 배열 포함)
 */
export async function getLikesV2(): Promise<LikesDataV2> {
  return await readLikesV2();
}

/**
 * 찜한 이벤트 ID 목록 가져오기 (V1 호환용)
 * @deprecated V2로 마이그레이션 권장
 */
export async function getLikes(): Promise<string[]> {
  const data = await readLikesV2();
  return data.items.map((item) => item.id);
}

/**
 * 찜 토글 (찜하기/찜 해제) - V2
 * @param id 이벤트 ID
 * @param snapshot 이벤트 스냅샷 (찜 추가 시 저장)
 * @returns { liked: 결과 상태, likes: V2 데이터 }
 */
export async function toggleLike(
  id: string,
  snapshot?: StoredEventItemV2['snapshot']
): Promise<{ liked: boolean; likes: LikesDataV2 }> {
  console.log(`[Storage][toggleLike][START] id=${id}`);

  const data = await readLikesV2();
  const index = data.items.findIndex((item) => item.id === id);

  let liked: boolean;
  let action: 'add' | 'remove';

  if (index > -1) {
    // 이미 찜한 경우 -> 제거
    data.items.splice(index, 1);
    liked = false;
    action = 'remove';
    console.log(`[Storage][toggleLike][REMOVED] id=${id}, remaining=${data.items.length}`);
  } else {
    // 찜하지 않은 경우 -> 추가 (최신 항목이 앞)
    const newItem: StoredEventItemV2 = {
      id,
      timestamp: new Date().toISOString(),
      lastKnownStatus: 'active',
      snapshot,
    };
    data.items.unshift(newItem);
    liked = true;
    action = 'add';
    console.log(`[Storage][toggleLike][ADDED] id=${id}, total=${data.items.length}`);
  }

  await writeLikesV2(data);

  // Storage 변경 이벤트 발행
  emitStorageChange({
    type: 'likes',
    action,
    id,
    count: data.items.length,
  });

  return { liked, likes: data };
}

/**
 * 최근 본 이벤트 데이터 가져오기 (V2)
 * @returns V2 데이터 구조 (items, totalCount 포함)
 */
export async function getRecentV2(): Promise<RecentDataV2> {
  return await readRecentV2();
}

/**
 * 최근 본 이벤트 ID 목록 가져오기 (V1 호환용)
 * @deprecated V2로 마이그레이션 권장
 */
export async function getRecent(): Promise<string[]> {
  const data = await readRecentV2();
  return data.items.map((item) => item.id);
}

/**
 * 최근 본 이벤트 누적 카운트 가져오기
 */
export async function getRecentTotalCount(): Promise<number> {
  const data = await readRecentV2();
  return data.totalCount;
}

/**
 * 최근 본 이벤트 목록에 추가 (V2)
 * - 중복 제거 후 앞에 추가 (LRU)
 * - 최대 50개 유지
 * - totalCount는 무한 증가
 * @param id 이벤트 ID
 * @param snapshot 이벤트 스냅샷
 * @returns 업데이트된 V2 데이터
 */
export async function pushRecent(
  id: string,
  snapshot?: StoredEventItemV2['snapshot']
): Promise<RecentDataV2> {
  console.log(`[Storage][pushRecent][START] id=${id}`);

  const data = await readRecentV2();
  console.log(`[Storage][pushRecent][CURRENT] items=${data.items.length}, totalCount=${data.totalCount}`);

  // 중복 제거
  const withoutDuplicate = data.items.filter((item) => item.id !== id);
  const wasDuplicate = withoutDuplicate.length < data.items.length;

  // 최신 항목을 앞에 추가
  const newItem: StoredEventItemV2 = {
    id,
    timestamp: new Date().toISOString(),
    lastKnownStatus: 'active',
    snapshot,
  };
  const updatedItems = [newItem, ...withoutDuplicate];

  // 최대 50개로 제한 (LRU)
  const trimmed = updatedItems.slice(0, 50);

  // totalCount 증가 (중복이 아닐 때만)
  const newTotalCount = wasDuplicate ? data.totalCount : data.totalCount + 1;

  const updatedData: RecentDataV2 = {
    version: 2,
    items: trimmed,
    totalCount: newTotalCount,
  };

  console.log(`[Storage][pushRecent][UPDATED]`, {
    items: trimmed.length,
    totalCount: newTotalCount,
    wasDuplicate,
    trimmedCount: updatedItems.length - trimmed.length,
  });

  await writeRecentV2(updatedData);

  // Storage 변경 이벤트 발행
  emitStorageChange({
    type: 'recent',
    action: 'add',
    id,
    count: trimmed.length,
  });

  return updatedData;
}

/**
 * 찜 목록 초기화 (개발/디버깅용)
 */
export async function clearLikes(): Promise<void> {
  await writeLikesV2({ version: 2, items: [] });
  console.log('[Storage][clearLikes] cleared');
}

/**
 * 최근 본 목록 초기화
 */
export async function clearRecent(): Promise<void> {
  await writeRecentV2({ version: 2, items: [], totalCount: 0 });
  emitStorageChange({ type: 'recent', action: 'update', count: 0 });
  if (__DEV__) console.log('[Storage][clearRecent] cleared');
}

/**
 * 최근 본 이벤트 개별 삭제
 * @param id 삭제할 이벤트 ID
 */
export async function removeRecentItem(id: string): Promise<void> {
  const data = await readRecentV2();
  const updated: RecentDataV2 = {
    ...data,
    items: data.items.filter((item) => item.id !== id),
  };
  await writeRecentV2(updated);
  emitStorageChange({ type: 'recent', action: 'remove', id, count: updated.items.length });
  if (__DEV__) console.log('[Storage][removeRecentItem] removed', id);
}

// ============================================================
// 사용자 선호도 (Preferences) 관리
// ============================================================

/**
 * 사용자 선호도 데이터 구조
 */
export interface UserPreferencesData {
  version: 1;
  recentCategories: string[]; // 최근 본 카테고리 (최대 3개, LRU)
}

/**
 * 사용자 선호도 읽기
 */
async function readPreferences(): Promise<UserPreferencesData> {
  try {
    const raw = await TossStorage.getItem(STORAGE_KEYS.PREFERENCES);
    if (!raw) {
      console.log('[Storage][readPreferences] No data, returning empty');
      return { version: 1, recentCategories: [] };
    }

    const parsed = JSON.parse(raw);

    // 구조 검증
    if (parsed.version === 1 && Array.isArray(parsed.recentCategories)) {
      console.log('[Storage][readPreferences] Data loaded', {
        categoriesCount: parsed.recentCategories.length,
        categories: parsed.recentCategories,
      });
      return parsed as UserPreferencesData;
    }

    // 알 수 없는 구조
    console.warn('[Storage][readPreferences] Unknown structure, resetting', { parsed });
    return { version: 1, recentCategories: [] };
  } catch (error) {
    console.error('[Storage][readPreferences] Exception', { error });
    return { version: 1, recentCategories: [] };
  }
}

/**
 * 사용자 선호도 쓰기
 */
async function writePreferences(data: UserPreferencesData): Promise<void> {
  try {
    const jsonStr = JSON.stringify(data);
    await TossStorage.setItem(STORAGE_KEYS.PREFERENCES, jsonStr);
    console.log('[Storage][writePreferences] Saved', {
      categoriesCount: data.recentCategories.length,
      categories: data.recentCategories,
    });
  } catch (error) {
    console.error('[Storage][writePreferences] Exception', { error });
    throw error;
  }
}

/**
 * 사용자 선호도 가져오기
 */
export async function getPreferences(): Promise<UserPreferencesData> {
  return await readPreferences();
}

/**
 * 최근 본 카테고리 추가
 * - 중복 제거 후 앞에 추가 (LRU)
 * - 최대 3개 유지
 * @param category 카테고리 (mainCategory 또는 category)
 */
export async function pushRecentCategory(category: string | undefined): Promise<UserPreferencesData> {
  if (!category || category === '전체') {
    console.log('[Storage][pushRecentCategory] Skipping invalid category:', category);
    const current = await readPreferences();
    return current;
  }

  console.log('[Storage][pushRecentCategory] Adding category:', category);

  const data = await readPreferences();

  // 중복 제거
  const withoutDuplicate = data.recentCategories.filter((c) => c !== category);

  // 최신 항목을 앞에 추가
  const updated = [category, ...withoutDuplicate];

  // 최대 3개로 제한
  const trimmed = updated.slice(0, 3);

  const updatedData: UserPreferencesData = {
    version: 1,
    recentCategories: trimmed,
  };

  await writePreferences(updatedData);

  console.log('[Storage][pushRecentCategory] Updated preferences:', {
    categories: trimmed,
  });

  return updatedData;
}

// ============================================================
// 투데이 배너 추천 히스토리 (24시간 dedup 용)
// ============================================================

/**
 * 배너 추천 히스토리 데이터 구조
 */
export interface BannerHistoryData {
  version: 1;
  lastRecommendedEventId: string;
  lastRecommendedAt: string; // ISO string
}

/**
 * 배너 추천 히스토리 읽기
 */
async function readBannerHistory(): Promise<BannerHistoryData | null> {
  try {
    const raw = await TossStorage.getItem(STORAGE_KEYS.BANNER_HISTORY);
    if (!raw) {
      console.log('[Storage][readBannerHistory] No history found');
      return null;
    }

    const parsed = JSON.parse(raw);

    // 구조 검증
    if (parsed.version === 1 && parsed.lastRecommendedEventId && parsed.lastRecommendedAt) {
      console.log('[Storage][readBannerHistory] History loaded', {
        lastRecommendedEventId: parsed.lastRecommendedEventId,
        lastRecommendedAt: parsed.lastRecommendedAt,
      });
      return parsed as BannerHistoryData;
    }

    // 알 수 없는 구조
    console.warn('[Storage][readBannerHistory] Unknown structure, resetting', { parsed });
    return null;
  } catch (error) {
    console.error('[Storage][readBannerHistory] Exception', { error });
    return null;
  }
}

/**
 * 배너 추천 히스토리 쓰기
 */
async function writeBannerHistory(data: BannerHistoryData): Promise<void> {
  try {
    const jsonStr = JSON.stringify(data);
    await TossStorage.setItem(STORAGE_KEYS.BANNER_HISTORY, jsonStr);
    console.log('[Storage][writeBannerHistory] Saved', {
      lastRecommendedEventId: data.lastRecommendedEventId,
      lastRecommendedAt: data.lastRecommendedAt,
    });
  } catch (error) {
    console.error('[Storage][writeBannerHistory] Exception', { error });
    throw error;
  }
}

/**
 * 배너 추천 히스토리 가져오기
 */
export async function getBannerHistory(): Promise<BannerHistoryData | null> {
  return await readBannerHistory();
}

/**
 * 배너 추천 히스토리 저장
 * @param eventId 추천된 이벤트 ID
 */
export async function saveBannerHistory(eventId: string): Promise<void> {
  const data: BannerHistoryData = {
    version: 1,
    lastRecommendedEventId: eventId,
    lastRecommendedAt: new Date().toISOString(),
  };
  await writeBannerHistory(data);
}

/**
 * 24시간 이내 추천된 이벤트인지 확인
 * @param eventId 확인할 이벤트 ID
 * @returns 24시간 이내 추천됨 여부
 */
export async function isRecentlyRecommended(eventId: string): Promise<boolean> {
  const history = await readBannerHistory();
  if (!history) {
    return false;
  }

  if (history.lastRecommendedEventId !== eventId) {
    return false;
  }

  const now = new Date();
  const lastRecommendedAt = new Date(history.lastRecommendedAt);
  const ageHours = (now.getTime() - lastRecommendedAt.getTime()) / (1000 * 60 * 60);

  return ageHours < 24;
}

// ============================================================
// 투데이 배너 디버그 모드 토글 (DEV 전용)
// ============================================================

/**
 * 배너 디버그 모드 활성화 여부 읽기
 */
export async function getBannerDebugEnabled(): Promise<boolean> {
  if (!__DEV__) {
    return false; // PROD에서는 항상 false
  }

  try {
    const raw = await TossStorage.getItem(STORAGE_KEYS.BANNER_DEBUG);
    if (!raw) {
      console.log('[Storage][getBannerDebugEnabled] No data, returning false');
      return false;
    }

    const enabled = raw === 'true';
    console.log('[Storage][getBannerDebugEnabled] Loaded:', enabled);
    return enabled;
  } catch (error) {
    console.error('[Storage][getBannerDebugEnabled] Exception', { error });
    return false;
  }
}

/**
 * 배너 디버그 모드 활성화 여부 저장
 */
export async function setBannerDebugEnabled(enabled: boolean): Promise<void> {
  if (!__DEV__) {
    console.warn('[Storage][setBannerDebugEnabled] Ignored in PROD');
    return; // PROD에서는 무시
  }

  try {
    await TossStorage.setItem(STORAGE_KEYS.BANNER_DEBUG, enabled ? 'true' : 'false');
    console.log('[Storage][setBannerDebugEnabled] Saved:', enabled);
  } catch (error) {
    console.error('[Storage][setBannerDebugEnabled] Exception', { error });
    throw error;
  }
}

/**
 * 배너 디버그 모드 토글
 */
export async function toggleBannerDebug(): Promise<boolean> {
  if (!__DEV__) {
    console.warn('[Storage][toggleBannerDebug] Ignored in PROD');
    return false;
  }

  const current = await getBannerDebugEnabled();
  const newValue = !current;
  await setBannerDebugEnabled(newValue);
  console.log('[Storage][toggleBannerDebug] Toggled:', { from: current, to: newValue });
  return newValue;
}

// ============================================================
// Gemini 캐시 관리
// ============================================================

/**
 * Gemini 생성 캐시 엔트리
 */
export interface BannerGeminiCacheEntry {
  eventId: string;
  reasonTags: string[]; // 정렬된 배열
  generatedCopy: string;
  generatedAt: string;
  expiresAt: string; // 24시간 TTL
  model: string; // 'gpt-4o-mini' | 'template-fallback'
  traitsHash?: string; // traits 변경 감지용 해시
  promptVersion?: string; // 프롬프트 버전
}

// 프롬프트 버전 (프롬프트 변경 시 증가시켜 캐시 무효화)
const AI_PROMPT_VERSION = 'v2.1'; // reasonTags 최대 2개, traits 포함

/**
 * Traits를 해시 문자열로 변환 (캐시 키 생성용)
 */
function hashTraits(traits: any): string {
  if (!traits) return 'no-traits';
  const sortedKeys = Object.keys(traits).sort();
  const str = sortedKeys.map(k => `${k}:${traits[k]}`).join('|');
  // 간단한 해시
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash.toString(36);
}

/**
 * 개발용 AI 캐시 바이패스 플래그 확인
 */
export async function isAiCacheBypassEnabled(): Promise<boolean> {
  try {
    const value = await TossStorage.getItem(STORAGE_KEYS.AI_CACHE_BYPASS);
    return value === 'true';
  } catch {
    return false;
  }
}

/**
 * 개발용 AI 캐시 바이패스 플래그 설정
 */
export async function setAiCacheBypass(enabled: boolean): Promise<void> {
  try {
    await TossStorage.setItem(STORAGE_KEYS.AI_CACHE_BYPASS, enabled ? 'true' : 'false');
    console.log('[Storage] AI cache bypass set to:', enabled);
  } catch (error) {
    console.error('[Storage] Failed to set AI cache bypass:', error);
  }
}

/**
 * AI 생성 문구 캐시에서 조회 (promptVersion, traits hash 검증 포함)
 */
export async function getGeminiCachedCopy(
  eventId: string,
  reasonTags: string[],
  traits?: any
): Promise<{ generatedCopy: string; model: string } | null> {
  try {
    // 개발용 캐시 바이패스 체크
    if (__DEV__ && await isAiCacheBypassEnabled()) {
      console.log('[Storage][CACHE_BYPASS] AI cache bypass enabled, skipping cache');
      return null;
    }

    const raw = await TossStorage.getItem(STORAGE_KEYS.GEMINI_CACHE);
    if (!raw) return null;
    
    const cache: BannerGeminiCacheEntry[] = JSON.parse(raw);
    const sortedTags = [...reasonTags].sort();
    const traitsHash = hashTraits(traits);
    const now = new Date();
    
    const entry = cache.find(e => {
      if (e.eventId !== eventId) return false;
      if (JSON.stringify(e.reasonTags) !== JSON.stringify(sortedTags)) return false;
      
      // 프롬프트 버전 체크
      if (e.promptVersion && e.promptVersion !== AI_PROMPT_VERSION) {
        return false;
      }
      
      // traits hash 체크
      if (traits && e.traitsHash && e.traitsHash !== traitsHash) {
        return false;
      }
      
      return new Date(e.expiresAt) > now;
    });
    
    if (entry) {
      const ageHours = ((now.getTime() - new Date(entry.generatedAt).getTime()) / (1000 * 60 * 60)).toFixed(1);
      console.log('[Storage][CACHE_HIT]', {
        eventId,
        model: entry.model,
        ageHours,
        copy: entry.generatedCopy?.substring(0, 50),
      });
      return { generatedCopy: entry.generatedCopy, model: entry.model };
    }
    
    return null;
  } catch (error) {
    console.error('[Storage] AI cache read failed:', error);
    return null;
  }
}

/**
 * Gemini 생성 문구 캐시 저장 (promptVersion, traitsHash 포함)
 */
export async function saveGeminiCachedCopy(
  eventId: string,
  reasonTags: string[],
  generatedCopy: string,
  model: string,
  traits?: any
): Promise<void> {
  try {
    const raw = await TossStorage.getItem(STORAGE_KEYS.GEMINI_CACHE);
    let cache: BannerGeminiCacheEntry[] = raw ? JSON.parse(raw) : [];
    
    // 최대 20개 유지
    cache = cache
      .filter(e => new Date(e.expiresAt) > new Date())
      .slice(-19);
    
    const now = new Date();
    const entry: BannerGeminiCacheEntry = {
      eventId,
      reasonTags: [...reasonTags].sort(),
      generatedCopy,
      generatedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
      model,
      promptVersion: AI_PROMPT_VERSION,
      traitsHash: hashTraits(traits),
    };
    
    cache.push(entry);
    
    await TossStorage.setItem(STORAGE_KEYS.GEMINI_CACHE, JSON.stringify(cache));
    console.log('[Storage] AI cache saved:', {
      eventId,
      model,
      totalEntries: cache.length,
    });
  } catch (error) {
    console.error('[Storage] AI cache save failed:', error);
  }
}

/**
 * [STEP 3] Storage 주입 상태 스모크 테스트
 * MyPage 최초 진입 시 1회 호출하여 Storage API 동작 확인
 */
export async function __debugStorageSmokeTest(): Promise<void> {
  console.log('[Storage][SmokeTest][START] Testing Storage API injection...');

  // 1. typeof 확인
  console.log('[Storage][SmokeTest][TYPE_CHECK]', {
    TossStorageType: typeof TossStorage,
    getItemType: typeof TossStorage?.getItem,
    setItemType: typeof TossStorage?.setItem,
    TossStorageKeys: TossStorage ? Object.keys(TossStorage) : [],
    timestamp: new Date().toISOString()
  });

  // 2. setItem 후 getItem으로 read back
  const testKey = '__smoke_test_key__';
  const testValue = 'smoke_test_value_' + Date.now();

  try {
    console.log('[Storage][SmokeTest][WRITE] Writing test value...', { testKey, testValue });
    await TossStorage.setItem(testKey, testValue);
    console.log('[Storage][SmokeTest][WRITE_SUCCESS]');

    console.log('[Storage][SmokeTest][READ] Reading back test value...');
    const readBack = await TossStorage.getItem(testKey);
    console.log('[Storage][SmokeTest][READ_SUCCESS]', {
      readBack,
      readBackType: typeof readBack,
      readBackIsNull: readBack === null,
      readBackIsUndefined: readBack === undefined,
      matchesWritten: readBack === testValue
    });

    if (readBack === testValue) {
      console.log('[Storage][SmokeTest][RESULT] ✅ Storage API working correctly');
    } else {
      console.error('[Storage][SmokeTest][RESULT] ❌ Storage read back mismatch!', {
        expected: testValue,
        actual: readBack
      });
    }
  } catch (error) {
    console.error('[Storage][SmokeTest][EXCEPTION] Storage API test failed!', {
      error,
      errorMessage: error instanceof Error ? error.message : String(error),
      errorStack: error instanceof Error ? error.stack : undefined
    });
  }
}

// ============================================================
// 생성형 AI 사전 고지
// ============================================================

/**
 * AI 고지 표시 여부 확인
 */
export async function getAiNoticeShown(): Promise<boolean> {
  try {
    const raw = await TossStorage.getItem(STORAGE_KEYS.AI_NOTICE_SHOWN);
    return raw === 'true';
  } catch {
    return false;
  }
}

/**
 * AI 고지 표시 완료 저장
 */
export async function setAiNoticeShown(): Promise<void> {
  try {
    await TossStorage.setItem(STORAGE_KEYS.AI_NOTICE_SHOWN, 'true');
  } catch (error) {
    console.error('[Storage][setAiNoticeShown] Exception', { error });
  }
}

/**
 * AI 생성 문구 캐시만 클리어 (개발용)
 */
export async function clearAiCopyCache(): Promise<void> {
  try {
    await TossStorage.setItem(STORAGE_KEYS.GEMINI_CACHE, '[]');
    console.log('[Storage][AI_CACHE_CLEAR] AI copy cache cleared');
  } catch (error) {
    console.warn('[Storage] Failed to clear AI cache (non-critical):', error);
  }
}

/**
 * 모든 Today Banner 캐시 클리어 (AI 생성 문구 캐시 포함)
 * 잘못된 캐시 데이터를 제거할 때 사용
 */
export async function clearAllTodayBannerCache(): Promise<void> {
  try {
    // removeItem 대신 null로 덮어쓰기 (더 안전함)
    await TossStorage.setItem(STORAGE_KEYS.TODAY_BANNER, '');
    console.log('[Storage] Today Banner cache cleared');
  } catch (error) {
    console.warn('[Storage] Failed to clear TODAY_BANNER cache (non-critical):', error);
  }

  await clearAiCopyCache();
}
