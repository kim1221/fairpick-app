/**
 * 서버 동기화 계약 타입 (로그인 도입 시 마이그레이션 기준)
 *
 * 현재 로컬 스토리지 스키마(StoredEventItemV2)를 기반으로,
 * 서버 API가 구현해야 할 요청/응답 타입을 미리 정의합니다.
 *
 * 로컬 vs 서버 필드 구분:
 * - 서버 저장 대상: id, timestamp (likedAt / viewedAt)
 * - 서버 미저장 (파생/캐시): lastKnownStatus (이벤트 API에서 실시간 계산)
 * - 서버 미저장 (로컬 캐시): snapshot (오프라인 표시용 덴오말라이즈 캐시)
 */

// ============================================================
// 서버 저장 타입
// ============================================================

/** 서버에 저장되는 찜 아이템 (최소 필드) */
export interface ServerLikeItem {
  eventId: string;   // = StoredEventItemV2.id
  likedAt: string;   // = StoredEventItemV2.timestamp (ISO 8601)
}

/** 서버에 저장되는 최근 본 아이템 (최소 필드) */
export interface ServerRecentItem {
  eventId: string;   // = StoredEventItemV2.id
  viewedAt: string;  // = StoredEventItemV2.timestamp (ISO 8601)
}

// ============================================================
// 서버 API 요청/응답 타입 (예상 인터페이스)
// ============================================================

/** GET /users/me/likes 응답 */
export interface GetLikesResponse {
  items: ServerLikeItem[];
}

/** GET /users/me/recent 응답 */
export interface GetRecentResponse {
  items: ServerRecentItem[];
}

/** POST /users/me/likes/batch (마이그레이션용 일괄 업로드) */
export interface BatchUploadLikesRequest {
  items: ServerLikeItem[];
}

/** POST /users/me/recent/batch (마이그레이션용 일괄 업로드) */
export interface BatchUploadRecentRequest {
  items: ServerRecentItem[];
}

// ============================================================
// 로컬 → 서버 마이그레이션 헬퍼 타입
// ============================================================

import type { StoredEventItemV2 } from '../utils/storage';

/** StoredEventItemV2 → ServerLikeItem 변환 */
export function toServerLikeItem(item: StoredEventItemV2): ServerLikeItem {
  return {
    eventId: item.id,
    likedAt: item.timestamp,
  };
}

/** StoredEventItemV2 → ServerRecentItem 변환 */
export function toServerRecentItem(item: StoredEventItemV2): ServerRecentItem {
  return {
    eventId: item.id,
    viewedAt: item.timestamp,
  };
}

/** ServerLikeItem → StoredEventItemV2 역변환 (서버 데이터를 로컬 캐시로 내려쓸 때) */
export function fromServerLikeItem(item: ServerLikeItem): StoredEventItemV2 {
  return {
    id: item.eventId,
    timestamp: item.likedAt,
    lastKnownStatus: 'active', // 서버에서 내려받은 직후 상태 — 다음 loadLikes에서 갱신됨
  };
}

/** ServerRecentItem → StoredEventItemV2 역변환 */
export function fromServerRecentItem(item: ServerRecentItem): StoredEventItemV2 {
  return {
    id: item.eventId,
    timestamp: item.viewedAt,
    lastKnownStatus: 'active', // 서버에서 내려받은 직후 상태 — 다음 loadRecent에서 갱신됨
  };
}
