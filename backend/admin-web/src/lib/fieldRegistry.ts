/**
 * 필드 레지스트리 (단일 소스)
 *
 * 이 파일이 다음 4군데의 기반이 됩니다:
 *  1) 🎯 선택 필드 재생성 UI (FieldSelectorModal)
 *  2) 📋 배포 우선순위 체크리스트 (DeployChecklist)
 *  3) 완성도(completeness) 계산 기준
 *  4) 제안 실패 시 네이버 바로 검색 링크
 */

export type FieldRequiredLevel = 'essential' | 'important' | 'optional' | 'category';
export type FieldCategory = '공통' | '전시' | '공연' | '팝업' | '축제' | '행사';
export type FieldScope = 'MASTER' | 'VARIANT';

export interface FieldDef {
  /** dot-path key (forceFields로 전송되는 값) */
  fieldKey: string;
  /** 사용자에게 보이는 한글 레이블 */
  label: string;
  /** 어느 카테고리에 속하는지 */
  category: FieldCategory;
  /** 필수/추천/선택/카테고리별 */
  requiredLevel: FieldRequiredLevel;
  /** 가중치 (calculateDataCompleteness와 동일) */
  weight: number;
  /** 네이버 검색 힌트 (실패 시 검색어에 추가) */
  fieldHint: string;
  /**
   * 필드 스코프: MASTER vs VARIANT
   *
   * MASTER: 같은 이벤트 변형들(지역만 다른) 간 동일해야 하는 필드
   *   - overview, derived_tags, 카테고리 핵심 콘텐츠(artists, cast, genre 등)
   *   - title-first 검색 전략, 마스터 캐시 공유
   *
   * VARIANT: 지역/지점/회차/채널에 따라 달라질 수 있는 필드
   *   - address, region, lat, lng, opening_hours, parking, accessibility
   *   - external_links, 가격 전체, waiting_hint 전체, registration.url_index
   *   - venue-first 검색 전략, 이벤트별 독립 생성
   */
  scope: FieldScope;
  /** 이미지처럼 수동 업로드만 가능한 필드 */
  isManualOnly?: boolean;
  /** AI 제안 불가 (예: content_key 같은 내부 식별자) */
  isAiSkip?: boolean;
}

// ─── 공통 필수 필드 (essential, weight=2-3) ───────────────────────────────
const ESSENTIAL: FieldDef[] = [
  {
    fieldKey: 'title',
    label: '제목',
    category: '공통',
    requiredLevel: 'essential',
    weight: 3,
    fieldHint: '이벤트명',
    scope: 'MASTER', // 같은 이벤트의 변형들은 동일한 제목
  },
  {
    fieldKey: 'start_at',
    label: '시작일',
    category: '공통',
    requiredLevel: 'essential',
    weight: 3,
    fieldHint: '시작일 날짜',
    scope: 'VARIANT', // 지역별로 기간이 다를 수 있음
  },
  {
    fieldKey: 'end_at',
    label: '종료일',
    category: '공통',
    requiredLevel: 'essential',
    weight: 2,
    fieldHint: '종료일 날짜',
    scope: 'VARIANT', // 지역별로 기간이 다를 수 있음
  },
  {
    fieldKey: 'venue',
    label: '장소',
    category: '공통',
    requiredLevel: 'essential',
    weight: 3,
    fieldHint: '전시 공연 장소명',
    scope: 'VARIANT', // 지역별로 장소가 다름
  },
  {
    fieldKey: 'main_category',
    label: '카테고리',
    category: '공통',
    requiredLevel: 'essential',
    weight: 3,
    fieldHint: '카테고리',
    isAiSkip: true,
    scope: 'MASTER', // 카테고리는 같은 이벤트의 변형들 간 동일
  },
  {
    fieldKey: 'image_url',
    label: '이미지',
    category: '공통',
    requiredLevel: 'essential',
    weight: 3,
    fieldHint: '포스터 이미지',
    isManualOnly: true,
    scope: 'MASTER', // 대표 이미지는 마스터 레벨
  },
];

// ─── 공통 중요 필드 (important, weight=1-2) ────────────────────────────────
const IMPORTANT: FieldDef[] = [
  {
    fieldKey: 'sub_category',
    label: '서브 카테고리',
    category: '공통',
    requiredLevel: 'important',
    weight: 1,
    fieldHint: '세부 분류',
    scope: 'MASTER', // 카테고리 핵심 콘텐츠
  },
  {
    fieldKey: 'region',
    label: '지역',
    category: '공통',
    requiredLevel: 'important',
    weight: 2,
    fieldHint: '지역 위치',
    scope: 'VARIANT', // 위치 정보
  },
  {
    fieldKey: 'address',
    label: '주소',
    category: '공통',
    requiredLevel: 'important',
    weight: 2,
    fieldHint: '상세 주소',
    scope: 'VARIANT', // 위치 정보
  },
  {
    fieldKey: 'lat',
    label: '위도',
    category: '공통',
    requiredLevel: 'important',
    weight: 1,
    fieldHint: '장소 위도 좌표',
    scope: 'VARIANT', // 위치 정보
  },
  {
    fieldKey: 'lng',
    label: '경도',
    category: '공통',
    requiredLevel: 'important',
    weight: 1,
    fieldHint: '장소 경도 좌표',
    scope: 'VARIANT', // 위치 정보
  },
  {
    fieldKey: 'overview',
    label: '개요',
    category: '공통',
    requiredLevel: 'important',
    weight: 2,
    fieldHint: '소개 설명',
    scope: 'MASTER', // 일관성 우선
  },
  {
    fieldKey: 'price_info',
    label: '가격 상세',
    category: '공통',
    requiredLevel: 'important',
    weight: 1,
    fieldHint: '입장료 가격',
    scope: 'VARIANT', // 가격 전체
  },
  {
    fieldKey: 'price_min',
    label: '최소 가격',
    category: '공통',
    requiredLevel: 'important',
    weight: 0.5,
    fieldHint: '최소 입장료',
    scope: 'VARIANT', // 가격 전체
  },
  {
    fieldKey: 'price_max',
    label: '최대 가격',
    category: '공통',
    requiredLevel: 'important',
    weight: 0.5,
    fieldHint: '최대 입장료',
    scope: 'VARIANT', // 가격 전체
  },
  {
    fieldKey: 'opening_hours',
    label: '운영시간',
    category: '공통',
    requiredLevel: 'important',
    weight: 1,
    fieldHint: '관람 운영 시간',
    scope: 'VARIANT', // 운영 정보
  },
  {
    fieldKey: 'public_transport_info',
    label: '대중교통',
    category: '공통',
    requiredLevel: 'important',
    weight: 1,
    fieldHint: '지하철 버스 교통 안내',
    scope: 'VARIANT', // 접근 정보
  },
  {
    fieldKey: 'external_links.official',
    label: '공식 홈페이지',
    category: '공통',
    requiredLevel: 'important',
    weight: 1,
    fieldHint: '공식 홈페이지',
    scope: 'VARIANT', // 링크 전체
  },
  {
    fieldKey: 'external_links.ticket',
    label: '티켓 링크',
    category: '공통',
    requiredLevel: 'important',
    weight: 0.5,
    fieldHint: '티켓 예매 링크',
    scope: 'VARIANT', // 링크 전체
  },
  {
    fieldKey: 'external_links.reservation',
    label: '예약 링크',
    category: '공통',
    requiredLevel: 'important',
    weight: 0.5,
    fieldHint: '사전 예약 링크',
    scope: 'VARIANT', // 링크 전체
  },
  {
    fieldKey: 'parking_available',
    label: '주차 가능 여부',
    category: '공통',
    requiredLevel: 'important',
    weight: 0.5,
    fieldHint: '주차 가능 여부',
    scope: 'VARIANT', // 접근 정보
  },
  {
    fieldKey: 'parking_info',
    label: '주차 상세',
    category: '공통',
    requiredLevel: 'important',
    weight: 0.5,
    fieldHint: '주차 정보 안내',
    scope: 'VARIANT', // 접근 정보
  },
];

// ─── 공통 선택 필드 (optional, weight=0.5-1) ──────────────────────────────
const OPTIONAL: FieldDef[] = [
  {
    fieldKey: 'display_title',
    label: '표시 제목',
    category: '공통',
    requiredLevel: 'optional',
    weight: 0.5,
    fieldHint: '표시 제목',
    scope: 'MASTER', // title과 함께 마스터 레벨
  },
  {
    fieldKey: 'derived_tags',
    label: '태그',
    category: '공통',
    requiredLevel: 'optional',
    weight: 0.5,
    fieldHint: '태그 키워드',
    scope: 'MASTER', // 일관성 우선
  },
  {
    fieldKey: 'is_free',
    label: '무료 여부',
    category: '공통',
    requiredLevel: 'optional',
    weight: 0.5,
    fieldHint: '무료 입장 여부',
    scope: 'VARIANT', // 가격 전체
  },
  {
    fieldKey: 'age_restriction',
    label: '연령 제한',
    category: '공통',
    requiredLevel: 'optional',
    weight: 0.5,
    fieldHint: '연령 제한 조건',
    scope: 'VARIANT', // 접근 정보
  },
  {
    fieldKey: 'accessibility_info',
    label: '접근성 정보',
    category: '공통',
    requiredLevel: 'optional',
    weight: 0.5,
    fieldHint: '휠체어 장애인 접근성 정보',
    scope: 'VARIANT', // 접근 정보
  },
  {
    fieldKey: 'external_links.instagram',
    label: '인스타그램',
    category: '공통',
    requiredLevel: 'optional',
    weight: 0.5,
    fieldHint: '인스타그램 계정',
    scope: 'VARIANT', // 링크 전체
  },
];

// ─── 전시 특화 필드 ────────────────────────────────────────────────────────
const EXHIBITION: FieldDef[] = [
  {
    fieldKey: 'metadata.display.exhibition.artists',
    label: '작가/아티스트',
    category: '전시',
    requiredLevel: 'category',
    weight: 1,
    fieldHint: '참여 작가 아티스트',
    scope: 'MASTER', // 카테고리 핵심 콘텐츠
  },
  {
    fieldKey: 'metadata.display.exhibition.genre',
    label: '전시 장르',
    category: '전시',
    requiredLevel: 'category',
    weight: 1,
    fieldHint: '전시 장르 유형',
    scope: 'MASTER', // 카테고리 핵심 콘텐츠
  },
  {
    fieldKey: 'metadata.display.exhibition.type',
    label: '전시 유형',
    category: '전시',
    requiredLevel: 'category',
    weight: 0.5,
    fieldHint: '기획전 특별전 상설전',
    scope: 'MASTER', // 카테고리 핵심 콘텐츠
  },
  {
    fieldKey: 'metadata.display.exhibition.duration_minutes',
    label: '관람 소요시간',
    category: '전시',
    requiredLevel: 'category',
    weight: 0.5,
    fieldHint: '평균 관람 소요시간',
    scope: 'VARIANT', // 기타 (duration_minutes)
  },
  {
    fieldKey: 'metadata.display.exhibition.last_admission',
    label: '마지막 입장 시간',
    category: '전시',
    requiredLevel: 'category',
    weight: 0.5,
    fieldHint: '마지막 입장 가능 시간',
    scope: 'VARIANT', // 운영 (last_admission)
  },
  {
    fieldKey: 'metadata.display.exhibition.facilities.photo_zone',
    label: '포토존',
    category: '전시',
    requiredLevel: 'category',
    weight: 0.5,
    fieldHint: '포토존 설치 여부',
    scope: 'VARIANT', // 기타 (photo_zone)
  },
  {
    fieldKey: 'metadata.display.exhibition.facilities.audio_guide',
    label: '오디오 가이드',
    category: '전시',
    requiredLevel: 'category',
    weight: 0.5,
    fieldHint: '오디오 가이드 제공 여부',
    scope: 'VARIANT', // 지역별로 다를 수 있음
  },
  {
    fieldKey: 'metadata.display.exhibition.facilities.goods_shop',
    label: '굿즈샵',
    category: '전시',
    requiredLevel: 'category',
    weight: 0.5,
    fieldHint: '굿즈샵 운영 여부',
    scope: 'VARIANT', // 지역별로 다를 수 있음
  },
  {
    fieldKey: 'metadata.display.exhibition.facilities.cafe',
    label: '카페',
    category: '전시',
    requiredLevel: 'category',
    weight: 0.5,
    fieldHint: '카페 운영 여부',
    scope: 'VARIANT', // 지역별로 다를 수 있음
  },
  {
    fieldKey: 'metadata.display.exhibition.docent_tour',
    label: '도슨트 투어',
    category: '전시',
    requiredLevel: 'category',
    weight: 0.5,
    fieldHint: '도슨트 투어 안내',
    scope: 'VARIANT', // 지역별로 다를 수 있음
  },
  {
    fieldKey: 'metadata.display.exhibition.special_programs',
    label: '특별 프로그램',
    category: '전시',
    requiredLevel: 'category',
    weight: 0.5,
    fieldHint: '체험 교육 특별 프로그램',
    scope: 'VARIANT', // 지역별로 다를 수 있음
  },
  {
    fieldKey: 'metadata.display.exhibition.photography_allowed',
    label: '사진 촬영 허용',
    category: '전시',
    requiredLevel: 'category',
    weight: 0.5,
    fieldHint: '전시 내 촬영 허용 여부',
    scope: 'VARIANT', // 지역별로 다를 수 있음
  },
];

// ─── 공연 특화 필드 ────────────────────────────────────────────────────────
const PERFORMANCE: FieldDef[] = [
  {
    fieldKey: 'metadata.display.performance.cast',
    label: '출연진',
    category: '공연',
    requiredLevel: 'category',
    weight: 1,
    fieldHint: '출연진 배우 가수',
    scope: 'MASTER', // 카테고리 핵심 콘텐츠
  },
  {
    fieldKey: 'metadata.display.performance.genre',
    label: '공연 장르',
    category: '공연',
    requiredLevel: 'category',
    weight: 1,
    fieldHint: '뮤지컬 연극 콘서트 장르',
    scope: 'MASTER', // 카테고리 핵심 콘텐츠
  },
  {
    fieldKey: 'metadata.display.performance.duration_minutes',
    label: '공연 시간',
    category: '공연',
    requiredLevel: 'category',
    weight: 1,
    fieldHint: '총 공연 시간 분',
    scope: 'VARIANT', // 기타 (duration_minutes)
  },
  {
    fieldKey: 'metadata.display.performance.last_admission',
    label: '마지막 입장 시간',
    category: '공연',
    requiredLevel: 'category',
    weight: 0.5,
    fieldHint: '공연 마지막 입장 시간',
    scope: 'VARIANT', // 운영 (last_admission)
  },
  {
    fieldKey: 'metadata.display.performance.crew.director',
    label: '연출/감독',
    category: '공연',
    requiredLevel: 'category',
    weight: 0.5,
    fieldHint: '연출 감독 이름',
    scope: 'VARIANT', // 기타 (crew)
  },
  {
    fieldKey: 'metadata.display.performance.crew.writer',
    label: '작가/작사',
    category: '공연',
    requiredLevel: 'category',
    weight: 0.5,
    fieldHint: '극본 작가 작사가',
    scope: 'VARIANT', // 기타 (crew)
  },
  {
    fieldKey: 'metadata.display.performance.crew.composer',
    label: '작곡가',
    category: '공연',
    requiredLevel: 'category',
    weight: 0.5,
    fieldHint: '작곡가 음악감독',
    scope: 'VARIANT', // 기타 (crew)
  },
  {
    fieldKey: 'metadata.display.performance.intermission',
    label: '인터미션',
    category: '공연',
    requiredLevel: 'category',
    weight: 0.5,
    fieldHint: '인터미션 휴식 여부',
    scope: 'VARIANT', // 지역별로 다를 수 있음
  },
  {
    fieldKey: 'metadata.display.performance.age_limit',
    label: '연령 제한',
    category: '공연',
    requiredLevel: 'category',
    weight: 0.5,
    fieldHint: '관람 연령 제한',
    scope: 'VARIANT', // 기타 (age_limit)
  },
  {
    fieldKey: 'metadata.display.performance.discounts',
    label: '할인 정보',
    category: '공연',
    requiredLevel: 'category',
    weight: 0.5,
    fieldHint: '할인 혜택 정보',
    scope: 'VARIANT', // 기타 (discounts)
  },
];

// ─── 팝업 특화 필드 ────────────────────────────────────────────────────────
const POPUP: FieldDef[] = [
  {
    fieldKey: 'metadata.display.popup.type',
    label: '팝업 타입',
    category: '팝업',
    requiredLevel: 'category',
    weight: 1,
    fieldHint: '팝업스토어 타입',
    scope: 'VARIANT', // 기타 (type) - 공연의 type과 다름
  },
  {
    fieldKey: 'metadata.display.popup.brands',
    label: '브랜드',
    category: '팝업',
    requiredLevel: 'category',
    weight: 1,
    fieldHint: '팝업 브랜드명',
    scope: 'MASTER', // 카테고리 핵심 콘텐츠
  },
  {
    fieldKey: 'metadata.display.popup.collab_description',
    label: '콜라보 설명',
    category: '팝업',
    requiredLevel: 'category',
    weight: 0.5,
    fieldHint: '브랜드 콜라보 협업 설명',
    scope: 'MASTER', // 카테고리 핵심 콘텐츠
  },
  {
    fieldKey: 'metadata.display.popup.is_fnb',
    label: 'F&B 팝업 여부',
    category: '팝업',
    requiredLevel: 'category',
    weight: 0.5,
    fieldHint: '음식 음료 F&B 팝업 여부',
    scope: 'MASTER', // 카테고리 핵심 콘텐츠
  },
  {
    fieldKey: 'metadata.display.popup.fnb_items.signature_menu',
    label: '시그니처 메뉴',
    category: '팝업',
    requiredLevel: 'category',
    weight: 0.5,
    fieldHint: '시그니처 메뉴 음식',
    scope: 'VARIANT', // 기타 (fnb_items.*)
  },
  {
    fieldKey: 'metadata.display.popup.fnb_items.menu_categories',
    label: '메뉴 카테고리',
    category: '팝업',
    requiredLevel: 'category',
    weight: 0.5,
    fieldHint: '메뉴 카테고리 종류',
    scope: 'VARIANT', // 기타 (fnb_items.*)
  },
  {
    fieldKey: 'metadata.display.popup.fnb_items.price_range',
    label: 'F&B 가격대',
    category: '팝업',
    requiredLevel: 'category',
    weight: 0.5,
    fieldHint: '음식 음료 가격대',
    scope: 'VARIANT', // 기타 (fnb_items.*)
  },
  {
    fieldKey: 'metadata.display.popup.fnb_items.best_items',
    label: 'F&B 인기 메뉴',
    category: '팝업',
    requiredLevel: 'category',
    weight: 0.5,
    fieldHint: '인기 베스트 메뉴',
    scope: 'MASTER', // 카테고리 핵심 콘텐츠 (best_items)
  },
  {
    fieldKey: 'metadata.display.popup.fnb_items.soldout_time_avg',
    label: '평균 품절 시간',
    category: '팝업',
    requiredLevel: 'category',
    weight: 0.5,
    fieldHint: '메뉴 품절 평균 시간',
    scope: 'VARIANT', // 기타 (fnb_items.*)
  },
  {
    fieldKey: 'metadata.display.popup.fnb_items.purchase_limit',
    label: '구매 수량 제한',
    category: '팝업',
    requiredLevel: 'category',
    weight: 0.5,
    fieldHint: '1인 구매 수량 제한',
    scope: 'VARIANT', // 기타 (fnb_items.*)
  },
  {
    fieldKey: 'metadata.display.popup.goods_items',
    label: '굿즈',
    category: '팝업',
    requiredLevel: 'category',
    weight: 0.5,
    fieldHint: '굿즈 상품 정보',
    scope: 'VARIANT', // 기타 (goods_items)
  },
  {
    fieldKey: 'metadata.display.popup.limited_edition',
    label: '한정판 여부',
    category: '팝업',
    requiredLevel: 'category',
    weight: 0.5,
    fieldHint: '한정판 리미티드 에디션 여부',
    scope: 'VARIANT', // 지역별로 다를 수 있음
  },
  {
    fieldKey: 'metadata.display.popup.photo_zone',
    label: '포토존 여부',
    category: '팝업',
    requiredLevel: 'category',
    weight: 0.5,
    fieldHint: '포토존 설치 여부',
    scope: 'VARIANT', // 기타 (photo_zone)
  },
  {
    fieldKey: 'metadata.display.popup.photo_zone_desc',
    label: '포토존 설명',
    category: '팝업',
    requiredLevel: 'category',
    weight: 0.5,
    fieldHint: '포토존 위치 설명',
    scope: 'VARIANT', // 기타 (photo_zone_desc)
  },
  {
    fieldKey: 'metadata.display.popup.waiting_hint.level',
    label: '대기 수준',
    category: '팝업',
    requiredLevel: 'category',
    weight: 0.5,
    fieldHint: '줄서기 대기 수준 낮음 보통 높음',
    scope: 'VARIANT', // 웨이팅 전체
  },
  {
    fieldKey: 'metadata.display.popup.waiting_hint.text',
    label: '대기 설명',
    category: '팝업',
    requiredLevel: 'category',
    weight: 0.5,
    fieldHint: '대기 시간 줄서기 상세 정보',
    scope: 'VARIANT', // 웨이팅 전체
  },
];

// ─── 축제 특화 필드 ────────────────────────────────────────────────────────
const FESTIVAL: FieldDef[] = [
  {
    fieldKey: 'metadata.display.festival.organizer',
    label: '주최/주관',
    category: '축제',
    requiredLevel: 'category',
    weight: 1,
    fieldHint: '주최 주관 기관',
    scope: 'VARIANT', // 지역별로 다를 수 있음
  },
  {
    fieldKey: 'metadata.display.festival.program_highlights',
    label: '주요 프로그램',
    category: '축제',
    requiredLevel: 'category',
    weight: 1,
    fieldHint: '주요 행사 프로그램',
    scope: 'VARIANT', // 지역별로 다를 수 있음
  },
  {
    fieldKey: 'metadata.display.festival.food_and_booths',
    label: '먹거리/부스',
    category: '축제',
    requiredLevel: 'category',
    weight: 0.5,
    fieldHint: '먹거리 부스 정보',
    scope: 'VARIANT', // 지역별로 다를 수 있음
  },
  {
    fieldKey: 'metadata.display.festival.scale_text',
    label: '규모',
    category: '축제',
    requiredLevel: 'category',
    weight: 0.5,
    fieldHint: '행사 규모 예상 인원',
    scope: 'VARIANT', // 지역별로 다를 수 있음
  },
  {
    fieldKey: 'metadata.display.festival.parking_tips',
    label: '주차 정보',
    category: '축제',
    requiredLevel: 'category',
    weight: 0.5,
    fieldHint: '주차장 주차 안내',
    scope: 'VARIANT', // 접근 정보
  },
];

// ─── 행사 특화 필드 ────────────────────────────────────────────────────────
const EVENT_CATEGORY: FieldDef[] = [
  {
    fieldKey: 'metadata.display.event.target_audience',
    label: '참가 대상',
    category: '행사',
    requiredLevel: 'category',
    weight: 1,
    fieldHint: '참가 대상 자격',
    scope: 'VARIANT', // 지역별로 다를 수 있음
  },
  {
    fieldKey: 'metadata.display.event.capacity',
    label: '정원',
    category: '행사',
    requiredLevel: 'category',
    weight: 1,
    fieldHint: '최대 참가 정원 인원',
    scope: 'VARIANT', // 지역별로 다를 수 있음
  },
  {
    fieldKey: 'metadata.display.event.registration.required',
    label: '사전 등록 필요',
    category: '행사',
    requiredLevel: 'category',
    weight: 1,
    fieldHint: '사전 등록 필수 여부',
    scope: 'VARIANT', // 등록 전체 (registration.required)
  },
  {
    fieldKey: 'metadata.display.event.registration.url',
    label: '등록 URL',
    category: '행사',
    requiredLevel: 'category',
    weight: 0.5,
    fieldHint: '사전 등록 신청 URL',
    scope: 'VARIANT', // 등록 전체 (registration.url_index)
  },
  {
    fieldKey: 'metadata.display.event.registration.deadline',
    label: '등록 마감일',
    category: '행사',
    requiredLevel: 'category',
    weight: 0.5,
    fieldHint: '사전 등록 마감 날짜',
    scope: 'VARIANT', // 등록 전체 (registration.deadline)
  },
];

// ─── 전체 레지스트리 ────────────────────────────────────────────────────────
export const ALL_FIELDS: FieldDef[] = [
  ...ESSENTIAL,
  ...IMPORTANT,
  ...OPTIONAL,
  ...EXHIBITION,
  ...PERFORMANCE,
  ...POPUP,
  ...FESTIVAL,
  ...EVENT_CATEGORY,
];

// DEV: 레지스트리 통계 로그 (개발 환경에서만)
if (import.meta.env.DEV) {
  const commonCount = ALL_FIELDS.filter((f) => f.category === '공통').length;
  const categoryGroups: Record<string, number> = {};
  for (const f of ALL_FIELDS.filter((f) => f.category !== '공통')) {
    categoryGroups[f.category] = (categoryGroups[f.category] ?? 0) + 1;
  }
  console.debug(
    `[FieldRegistry] total=${ALL_FIELDS.length} common=${commonCount}`,
    categoryGroups
  );
}

/**
 * 카테고리에 해당하는 필드만 반환
 * (공통 + 해당 카테고리 특화)
 */
export function getFieldsForCategory(mainCategory: string): FieldDef[] {
  return ALL_FIELDS.filter(
    (f) => f.category === '공통' || f.category === mainCategory
  );
}

/**
 * fieldKey로 FieldDef 조회
 */
export function getFieldDef(fieldKey: string): FieldDef | undefined {
  return ALL_FIELDS.find((f) => f.fieldKey === fieldKey);
}

/**
 * 네이버 바로 검색 URL 생성
 * query = `${title} ${venue ?? ''} ${fieldHint}`
 */
export function makeNaverSearchUrl(
  title: string,
  venue: string | undefined,
  fieldKey: string,
  address?: string,
  region?: string
): string {
  const def = getFieldDef(fieldKey);
  const hint = def?.fieldHint ?? fieldKey;

  // venue-first 필드 목록
  const venueFirstFields = [
    'address',
    'parking_available',
    'parking_info',
    'public_transport_info',
    'accessibility_info',
  ];

  const isVenueFirst = venueFirstFields.some(
    (f) => fieldKey === f || fieldKey.startsWith(f + '.')
  );

  let query: string;

  if (isVenueFirst && venue) {
    // venue-first: 장소 중심 검색
    if (fieldKey === 'address') {
      query = region ? `${venue} ${region} ${hint}` : `${venue} ${hint}`;
    } else if (fieldKey === 'parking_available' || fieldKey === 'parking_info') {
      // 주차: venue만 사용 (주소 없이 - 검색 결과가 더 잘 나옴)
      query = `${venue} ${hint}`;
    } else if (fieldKey === 'public_transport_info') {
      query = `${venue} 오시는길`;
    } else {
      query = `${venue} ${hint}`;
    }
  } else {
    // title-first: 콘텐츠 중심 검색
    query = `${title} ${hint}`;
  }

  const q = encodeURIComponent(query.trim());
  return `https://search.naver.com/search.naver?query=${q}`;
}

/**
 * reasonCode 표준 목록
 */
export type SuggestionReasonCode =
  | 'NAVER_NO_EVIDENCE'   // 검색 결과에 근거 없음
  | 'NO_MATCH'            // 이벤트 관련 결과 없음
  | 'AMBIGUOUS'           // 결과가 모호하거나 여러 후보
  | 'PARSE_FAILED'        // AI 응답 파싱 실패
  | 'INDEX_OUT_OF_RANGE'  // searchResults index 범위 초과
  | 'AI_SKIP'             // 해당 필드는 AI가 제안하지 않음
  | 'MANUAL_ONLY';        // 수동 업로드가 필요한 필드

export const REASON_MESSAGES: Record<SuggestionReasonCode, string> = {
  NAVER_NO_EVIDENCE: '네이버 검색 결과에서 근거를 찾지 못했어요. 직접 검색해 확인해 보세요.',
  NO_MATCH: '이벤트와 관련된 검색 결과를 찾지 못했어요.',
  AMBIGUOUS: '검색 결과가 모호해서 확신할 수 없어요. 직접 확인이 필요해요.',
  PARSE_FAILED: 'AI 응답을 파싱하는 데 실패했어요. 다시 시도해 보세요.',
  INDEX_OUT_OF_RANGE: '검색 결과 인덱스가 범위를 벗어났어요.',
  AI_SKIP: 'AI가 자동으로 채울 수 없는 필드예요.',
  MANUAL_ONLY: '수동 업로드가 필요한 필드예요.',
};
