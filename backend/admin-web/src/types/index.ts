// ============================================================
// AI 제안 시스템 타입
// ============================================================

export type DataSource = 'PUBLIC_API' | 'NAVER_API' | 'AI' | 'MANUAL' | 'CALCULATED' | 'UNKNOWN';

export interface FieldSuggestion {
  value: any;
  confidence: number; // 0-100
  source: DataSource;
  source_detail: string;
  warning?: string;
  extracted_at: string;
  // 근거 품질 필드
  evidence?: string;        // 네이버 검색 snippet
  url?: string;             // 네이버 검색 URL (resolveIndexes가 채운 값만)
  reason?: string;          // 추출 이유 설명
  // 제안 실패 시
  reasonCode?: string;      // SuggestionReasonCode
  reasonMessage?: string;   // 해요체 실패 안내 메시지
}

export interface EventSuggestions {
  [fieldName: string]: FieldSuggestion;
}

// ============================================================
// Phase 3: 카테고리별 Display 필드 타입
// ============================================================

// 전시 (Exhibition)
export interface ExhibitionDisplay {
  artists?: string[];
  genre?: string[];
  type?: string;  // "기획전", "특별전", "상설전"
  duration_minutes?: number | null;
  facilities?: {
    photo_zone?: boolean;
    audio_guide?: boolean;
    goods_shop?: boolean;
    cafe?: boolean;
  };
  docent_tour?: string | null;
  special_programs?: string[];
  age_recommendation?: string | null;
  photography_allowed?: boolean | 'partial' | null;
  discounts?: string[];
  last_admission?: string | null;
}

// 공연 (Performance)
export interface PerformanceDisplay {
  cast?: string[];
  genre?: string[];
  duration_minutes?: number | null;
  intermission?: boolean;
  age_limit?: string;
  showtimes?: {
    weekday?: string[];
    weekend?: string[];
    holiday?: string[];
    notes?: string;
  };
  runtime?: string | null;
  crew?: {
    director?: string | null;
    writer?: string | null;
    composer?: string | null;
  };
  discounts?: string[];
  last_admission?: string | null;
}

// 축제 (Festival)
export interface FestivalDisplay {
  [key: string]: any;
}

// 행사 (Event)
export interface EventDisplay {
  [key: string]: any;
}

// 팝업 (Popup)
export interface PopupDisplay {
  brand?: string;
  type?: string;
  goods?: string[];
  has_photo_zone?: boolean;
  photo_zone_description?: string | null;
  wait_time?: string | null;
  is_fnb?: boolean;
  best_items?: string[];
  [key: string]: any;
}

// metadata 구조
export interface EventMetadata {
  display?: {
    exhibition?: ExhibitionDisplay;
    performance?: PerformanceDisplay;
    festival?: FestivalDisplay;
    event?: EventDisplay;
    popup?: PopupDisplay;
  };
  internal?: {
    companions?: string[];
    time_availability?: string[];
    location_insights?: string[];
    // ... 기타 내부 필드
  };
}

// 이벤트 타입 (25개 Core Data 필드 + Phase 3 metadata)
export interface Event {
  id: string;
  content_key: string | null;
  title: string;
  display_title: string | null;
  start_at: string;
  end_at: string | null;
  venue: string;
  region: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  main_category: string;
  sub_category: string | null;
  image_url: string | null;
  is_free: boolean;
  price_info: string | null;
  price_min?: number | null;
  price_max?: number | null;
  overview: string | null;
  is_ending_soon: boolean;
  popularity_score: number;
  buzz_score: number;
  is_featured: boolean;
  featured_order: number | null;
  featured_at: string | null;
  featured_score: number | null;
  tags_context: any; // JSON
  metadata: EventMetadata; // 🆕 Phase 3: 구조화된 metadata
  source_priority_winner?: string;
  source_tags?: string[];
  derived_tags?: string[];
  opening_hours?: {
    weekday?: string;
    weekend?: string;
    holiday?: string;
    closed?: string;
    notes?: string;
  };
  external_links?: {
    official?: string;
    ticket?: string;
    reservation?: string;
    instagram?: string;
  };
  parking_available?: boolean | null;  // 🚗 주차 가능 여부
  parking_info?: string | null;        // 🅿️ 주차 상세 정보
  status?: string;
  quality_flags?: {
    has_real_image?: boolean;
    has_exact_address?: boolean;
    geo_ok?: boolean;
    has_overview?: boolean;
    has_price_info?: boolean;
  };
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
  // 🆕 AI 제안 시스템
  ai_suggestions?: EventSuggestions;
  field_sources?: { [fieldName: string]: any };
}

// 대시보드 통계
export interface DashboardStats {
  totalEvents: number;
  featuredCount: number;
  recentUpdatedCount: number;
  recentNewCount: number;
  recentLogs: CollectionLog[];
  currentlyRunning?: string[];
  // 데이터 품질 메트릭 (v1)
  missingImages?: number;
  missingCoords?: number;
  incompleteEvents?: number;
  collectedToday?: number;
  failedJobsRecent?: number;
  lastCollection?: {
    source: string;
    type: string;
    status: string;
    started_at: string;
    completed_at: string | null;
  } | null;
}

// 서버 헬스
export interface AdminHealth {
  status: 'ok' | 'warning' | 'error';
  uptimeSec: number;
  memoryRssMb: number;
  nodeEnv: string;
  db: { ok: boolean };
  currentlyRunning: string[];
  eventLoop: {
    lagDetected: boolean;
    lastLagMs: number | null;
    lastCheckedAt: string | null;
  };
  pool: {
    totalCount: number | null;
    idleCount: number | null;
    waitingCount: number | null;
  };
}

// 외부 API 상태
export interface ApiServiceStatus {
  name: string;
  status: 'ok' | 'fail' | 'not_configured';
  checkedAt: string;
  latencyMs: number | null;
  message: string | null;
}

export interface ApiHealth {
  services: ApiServiceStatus[];
  cached: boolean;
  refreshedAt: string | null;
}

// Collection Log
export interface CollectionLog {
  id: string;
  scheduler_job_name: string | null;
  source: string;
  type: string;
  status: string;
  started_at: string;
  completed_at: string | null;
  items_count: number;
  success_count: number;
  failed_count: number;
  skipped_count: number;
  error_message: string | null;
}

// API 응답 타입
export interface PaginatedResponse<T> {
  items: T[];
  totalCount: number;
  page: number;
  size: number;
}

// 팝업 생성 폼 (7개 핵심 필드 + Instagram URL + 이미지 + Phase 1 공통 필드)
export interface PopupFormData {
  instagramUrl: string;
  title: string;
  displayTitle: string;
  startAt: string;
  endAt: string;
  venue: string;
  address: string;
  imageUrl: string;
  overview: string;
  // 이미지 메타데이터
  imageStorage?: 'cdn' | 'external';
  imageOrigin?: 'naver' | 'official_site' | 'public_api' | 'user_upload' | 'instagram' | 'other';
  imageSourcePageUrl?: string;
  imageKey?: string;
  imageMetadata?: ImageMetadata;
  // Phase 1 공통 필드
  is_free?: boolean;
  price_info?: string | null;
  external_links?: {
    official?: string;
    ticket?: string;
    reservation?: string;
    instagram?: string;
  };
  price_min?: number | null;
  price_max?: number | null;
  source_tags?: string[];
  derived_tags?: string[];
  opening_hours?: {
    weekday?: string;
    weekend?: string;
    holiday?: string;
    closed?: string;
    notes?: string;
  };
  parking_available?: boolean | null;
  parking_info?: string | null;
  // Phase 3: 카테고리별 특화 필드
  metadata?: EventMetadata;
}

// 이미지 메타데이터
export interface ImageMetadata {
  width: number;
  height: number;
  sizeKB: number;
  format: string;
  fileHash?: string;
  uploadedAt: string;
  uploadedBy?: string;
}

// 이벤트 삭제 결과
export interface DeleteEventResult {
  success: boolean;
  message: string;
  eventId: string;
  deleteMode: 'soft';
  dbDeleted: boolean;
  r2Action: 'preserved' | 'not_applicable';
  r2ActionReason: 'soft_delete_retention' | 'external_url' | 'no_image';
  imageKey: string | null;
  imageStorage: string | null;
  scheduledCleanupAfter: string | null; // 'YYYY-MM-DD'
  item: Event;
}

// 이미지 업로드 응답
export interface UploadImageResponse {
  success: boolean;
  url: string;
  key: string;
  width: number;
  height: number;
  sizeKB: number;
  format: string;
  fileHash: string;
  uploadedAt: string;
  error?: string;
  code?: string;
}

