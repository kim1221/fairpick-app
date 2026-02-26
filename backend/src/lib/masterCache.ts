/**
 * MASTER 필드 캐시
 *
 * 같은 이벤트 변형들(지역만 다름) 간 MASTER 필드 제안을 공유하기 위한 메모리 캐시.
 *
 * 캐시 키: `${masterKey}:${fieldKey}`
 * 예: "a1b2c3d4e5f6g7h8:overview", "a1b2c3d4e5f6g7h8:derived_tags"
 */

import type { DataSource } from './confidenceCalculator';

export interface MasterCacheEntry {
  /** 제안 값 */
  value: any;
  /** 신뢰도 점수 */
  confidence: number;
  /** 출처 (AI, NAVER_API 등) */
  source: DataSource;
  /** 상세 출처 */
  source_detail?: string;
  /** 근거 (네이버 검색 snippet 등) */
  evidence?: string;
  /** 추론 이유 */
  reason?: string;
  /** URL (D안: 네이버 검색 결과 URL) */
  url?: string;
  /** 제안 실패 이유 코드 */
  reasonCode?: string;
  /** 제안 실패 메시지 */
  reasonMessage?: string;
  /** 네이버 바로 검색 URL */
  naverSearchUrl?: string;
  /** 캐시 생성 시각 */
  cachedAt: number;
}

/**
 * 인메모리 MASTER 필드 캐시
 *
 * TTL: 1시간 (서버 재시작 시 초기화됨)
 */
class MasterFieldCache {
  private cache: Map<string, MasterCacheEntry> = new Map();
  private readonly TTL_MS = 60 * 60 * 1000; // 1시간

  /**
   * 캐시 키 생성
   */
  private getCacheKey(masterKey: string, fieldKey: string): string {
    return `${masterKey}:${fieldKey}`;
  }

  /**
   * 캐시에서 MASTER 필드 제안 조회
   *
   * @param masterKey - 이벤트 마스터 키
   * @param fieldKey - 필드 키 (예: "overview", "derived_tags")
   * @returns 캐시된 제안 또는 null
   */
  get(masterKey: string, fieldKey: string): MasterCacheEntry | null {
    const key = this.getCacheKey(masterKey, fieldKey);
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    // TTL 체크
    const now = Date.now();
    if (now - entry.cachedAt > this.TTL_MS) {
      // 만료됨
      this.cache.delete(key);
      return null;
    }

    return entry;
  }

  /**
   * 캐시에 MASTER 필드 제안 저장
   *
   * @param masterKey - 이벤트 마스터 키
   * @param fieldKey - 필드 키
   * @param entry - 제안 데이터
   */
  set(masterKey: string, fieldKey: string, entry: Omit<MasterCacheEntry, 'cachedAt'>): void {
    const key = this.getCacheKey(masterKey, fieldKey);
    this.cache.set(key, {
      ...entry,
      cachedAt: Date.now(),
    });
  }

  /**
   * 특정 masterKey의 모든 캐시 삭제
   */
  clearForMaster(masterKey: string): void {
    const keysToDelete: string[] = [];
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${masterKey}:`)) {
        keysToDelete.push(key);
      }
    }
    keysToDelete.forEach((k) => this.cache.delete(k));
  }

  /**
   * 전체 캐시 삭제
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * 현재 캐시 크기
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * DEV 전용: 캐시 상태 출력
   */
  debug(): void {
    console.log(`[MASTER_CACHE][DEBUG] size=${this.cache.size}`);
    for (const [key, entry] of this.cache.entries()) {
      const age = Math.floor((Date.now() - entry.cachedAt) / 1000);
      console.log(
        `[MASTER_CACHE][DEBUG] ${key} value=${JSON.stringify(entry.value).substring(0, 50)}... age=${age}s`
      );
    }
  }
}

/**
 * 싱글톤 인스턴스
 */
export const masterCache = new MasterFieldCache();
