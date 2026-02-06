/**
 * Phase 3: Display Fields 타입 정의
 * 
 * metadata.display에 저장될 카테고리별 데이터 구조
 */

// ============================================================
// 전시 (Exhibition)
// ============================================================

export interface ExhibitionDisplay {
  // 작가/아티스트
  artists: string[];
  
  // 장르
  genre: string[];
  
  // 전시 유형
  type: string;  // "기획전", "특별전", "상설전", "순회전"
  
  // 권장 관람 시간 (분)
  duration_minutes: number | null;
  
  // 편의시설
  facilities: {
    photo_zone: boolean;
    audio_guide: boolean;
    goods_shop: boolean;
    cafe: boolean;
  };
  
  // 도슨트 투어
  docent_tour: string | null;
  
  // 특별 프로그램
  special_programs: string[];
  
  // 연령 추천
  age_recommendation: string | null;
  
  // ========== 추가 필드 (피드백 반영) ==========
  
  // 촬영 가능 여부
  photography_allowed: boolean | 'partial' | null;  // true: 전체 가능, false: 불가, 'partial': 일부만
  
  // 입장 마감 시간
  last_admission: string | null;  // "17:30"
}

// ============================================================
// 공연 (Performance)
// ============================================================

export interface PerformanceDisplay {
  // 출연진
  cast: string[];
  
  // 장르
  genre: string[];
  
  // 공연 시간 (분)
  duration_minutes: number | null;
  
  // 인터미션 (중간 휴식)
  intermission: boolean;
  
  // 연령 제한
  age_limit: string;
  
  // 공연 시간대 (구조화)
  showtimes: {
    weekday?: string[];   // ["19:30"]
    weekend?: string[];   // ["14:00", "18:00"]
    holiday?: string[];   // ["15:00"]
    notes?: string;       // 파싱 실패 시 원본
  };
  
  // 런타임 설명
  runtime: string | null;
  
  // 제작진
  crew: {
    director: string | null;
    writer: string | null;
    composer: string | null;
  };
  
  // 할인 정보
  discounts: string[];
  
  // ========== 추가 필드 (피드백 반영) ==========
  
  // 입장 마감 시간
  last_admission: string | null;  // "17:30"
}

// ============================================================
// 팝업 (Popup) - F&B 강화 버전
// ============================================================

export interface PopupDisplay {
  // 브랜드 정보
  brands?: string[];            // ["노티드", "케이스티파이"]
  is_collab?: boolean;          // 콜라보 여부

  // ⭐ F&B 여부 판별
  is_fnb: boolean;              // F&B(디저트/카페) 팝업 여부

  // F&B 팝업 전용 정보
  fnb_items?: {
    signature_menu?: string[];  // ⭐ 시그니처 메뉴 ["두쫀쿠", "쪽파 베이글"]
    menu_categories?: string[]; // 메뉴 카테고리 ["디저트", "음료", "브런치"]
    price_range?: string;       // 가격대 ("1만원-2만원대")
    best_items?: string[];      // 인기 아이템 (블로그에서 가장 많이 언급)
  };

  // 일반 굿즈 정보
  goods_items?: string[];       // 판매 굿즈 목록 ["키링", "에코백", "포토카드"]
  limited_edition?: boolean;    // 한정판 여부

  // 현장 정보
  photo_zone?: boolean;         // 포토존 유무
  photo_zone_desc?: string;     // 포토존 설명

  waiting_hint?: {              // 대기 시간 힌트
    level: 'low' | 'medium' | 'high';
    text?: string;              // "주말 낮 혼잡"
    source_url?: string;
  };

  // 안전 장치
  source_urls?: string[];
}

// ============================================================
// 축제 (Festival) - 상세 정보 강화
// ============================================================

export interface FestivalDisplay {
  organizer?: string;           // 주최/주관 기관
  program_highlights?: string;  // 주요 프로그램 (AI 3-5줄 요약)
  food_and_booths?: string;     // 먹거리/체험 부스 정보
  scale_text?: string;          // 규모 ("작년 50만 명 방문")
  parking_tips?: string;        // 주차 정보
  source_urls?: string[];       // 근거 링크
}

// ============================================================
// 행사 (Event) - 상세 정보 강화
// ============================================================

export interface EventDisplay {
  target_audience?: string;     // 참가 대상
  capacity?: string;            // 정원 제한
  registration?: {              // 사전 등록 정보
    required: boolean;
    url?: string;
    deadline?: string;
  };
  source_urls?: string[];
}

// ============================================================
// 통합 타입
// ============================================================

export type DisplayFields = 
  | { exhibition: ExhibitionDisplay }
  | { performance: PerformanceDisplay }
  | { popup: PopupDisplay }
  | { festival: FestivalDisplay }
  | { event: EventDisplay };

// ============================================================
// Job 입력 데이터
// ============================================================

export interface EventForDisplay {
  id: string;
  title: string;
  main_category: string;
  sub_category: string | null;
  sources: Array<{
    source: string;
    rawTable: string;
    rawId: string;
  }>;
}

// ============================================================
// Payload 타입 (raw_kopis_events.payload)
// ============================================================

export interface KopisPayload {
  prfcast?: string;       // 출연진/작가
  genrenm?: string;       // 장르명
  prfruntime?: string;    // 공연시간 ("120분")
  prfage?: string;        // 연령제한
  dtguidance?: string;    // 공연시간 안내
  // ... 기타 필드
}

export interface CulturePayload {
  ORG_NAME?: string;      // 주최기관
  TITLE?: string;         // 제목
  // ... 기타 필드
}

export interface TourPayload {
  eventstartdate?: string;
  eventenddate?: string;
  // ... 기타 필드
}

