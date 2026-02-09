/**
 * AI 기반 정보 추출기
 * 
 * Google Gemini API를 사용하여 비정형 텍스트에서 구조화된 정보 추출
 */

import { GoogleGenerativeAI } from '@google/generative-ai';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-pro'; // 안정적인 모델

let genAI: GoogleGenerativeAI | null = null;
let model: any = null;

if (GEMINI_API_KEY) {
  genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  model = genAI.getGenerativeModel({ 
    model: GEMINI_MODEL,
    generationConfig: {
      temperature: 0.05, // 최소화: 0.1 → 0.05 (최대한 일관된 결과)
      maxOutputTokens: 8192, // 증가: 4096 → 8192 (응답 잘림 방지)
      topP: 0.8, // 다양성 제한
      topK: 10, // 선택지 제한
    },
  });
  console.log(`[AI] Gemini initialized (model: ${GEMINI_MODEL})`);
} else {
  console.warn('[AI] GEMINI_API_KEY not set. AI extraction will be skipped.');
}

/**
 * AI 추출 결과 인터페이스
 */
export interface AIExtractedInfo {
  // 기본 정보 (CreateEventPage 자동 채우기용)
  start_date?: string; // YYYY-MM-DD
  end_date?: string;   // YYYY-MM-DD
  venue?: string;
  address?: string;
  overview?: string; // 사용자용 개요 (매력적이고 자연스러운 설명)
  overview_raw?: string; // 내부용 개요 (상세하고 정확한 정보, AI 특화 필드 추출용)

  // 운영 시간
  opening_hours?: {
    weekday?: string;
    weekend?: string;
    holiday?: string;
    closed?: string;
    notes?: string;
  };

  // 가격 정보
  price_min?: number;
  price_max?: number;
  price_notes?: string;

  // 예약 정보
  reservation_required?: boolean;
  reservation_link?: string;

  // 외부 링크
  external_links?: {
    official?: string;
    ticket?: string;
    reservation?: string;
  };

  // 연령 제한
  age_restriction?: string;

  // 추천 태그
  derived_tags?: string[];

  // 기타 유용한 정보
  parking_info?: string;
  public_transport_info?: string;
  accessibility_info?: string;

  // 카테고리 (옵션)
  main_category?: string;

  // ============================================================
  // Phase 3: Category-Specific Display Fields
  // ============================================================

  // 전시 전용 필드
  exhibition_display?: {
    artists?: string[];              // 작가/아티스트
    genre?: string[];                // 장르
    facilities?: {
      photo_zone: boolean;           // 포토존
      audio_guide: boolean;          // 오디오 가이드
      goods_shop: boolean;           // 굿즈샵
      cafe: boolean;                 // 카페
    };
    docent_tour?: string | null;     // 도슨트 투어 시간
    special_programs?: string[];     // 특별 프로그램
    photography_allowed?: boolean | 'partial' | null;  // 촬영 가능 여부
    last_admission?: string | null;  // 입장 마감 시간
  };

  // 공연 전용 필드
  performance_display?: {
    cast?: string[];                 // 출연진
    genre?: string[];                // 장르
    crew?: {
      director?: string | null;      // 연출
      writer?: string | null;        // 작가
      composer?: string | null;      // 작곡
    };
    intermission?: boolean;          // 인터미션
    discounts?: string[];            // 할인 정보
    last_admission?: string | null;  // 입장 마감 시간 (공연 시작 전 입장 마감)
  };

  // ============================================================
  // 팝업 전용 필드 (F&B 강화)
  // ============================================================
  popup_display?: {
    type?: 'fnb' | 'collab' | 'general' | null;  // ⭐ 팝업 타입
    brands?: string[];               // 브랜드명 (콜라보인 경우 협업 브랜드)
    collab_description?: string;     // 콜라보 설명 (콜라보인 경우)
    fnb_items?: {
      signature_menu?: string[];     // ⭐ 시그니처 메뉴
      menu_categories?: string[];    // 메뉴 카테고리
      price_range?: string;          // 가격대
      best_items?: string[];         // 인기 아이템
      soldout_time_avg?: string;     // ⭐ 평균 품절 시간
      purchase_limit?: string;       // ⭐ 구매 제한
    };
    goods_items?: string[];          // 판매 굿즈
    limited_edition?: boolean;       // 한정판 여부
    photo_zone?: boolean;            // 포토존
    photo_zone_desc?: string;        // 포토존 설명 (위치 포함)
    waiting_hint?: {
      level: 'low' | 'medium' | 'high';
      text?: string;
      source_url?: string;
    };
    source_urls?: string[];
  };

  // ============================================================
  // 축제 전용 필드
  // ============================================================
  festival_display?: {
    organizer?: string;              // 주최/주관
    program_highlights?: string;     // 주요 프로그램
    food_and_booths?: string;        // 먹거리/체험 부스
    scale_text?: string;             // 규모
    parking_tips?: string;           // 주차 정보
    source_urls?: string[];
  };

  // ============================================================
  // 행사 전용 필드
  // ============================================================
  event_display?: {
    target_audience?: string;        // 참가 대상
    capacity?: string;               // 정원
    registration?: {
      required: boolean;
      url?: string;
      deadline?: string;
    };
    source_urls?: string[];
  };
}

/**
 * 이벤트 정보 추출 프롬프트 생성
 */
function buildExtractionPrompt(
  eventTitle: string,
  category: string,
  overview: string | null,
  searchResults: string
): string {
  return `당신은 이벤트 정보 추출 전문가입니다. 주어진 정보에서 구조화된 데이터를 추출해주세요.

# 이벤트 정보
- 제목: ${eventTitle}
- 카테고리: ${category}
- 기존 개요: ${overview || '없음'}

# 검색 결과 (네이버 플레이스/블로그/웹)
${searchResults}

---

위 정보를 바탕으로 다음 항목들을 추출해주세요. **정보가 없으면 null을 반환**하세요.

**🎫 최우선 원칙**: 
1. **"공식 예매/예약 사이트" 섹션의 정보를 최우선으로 참고하세요!**
   - 인터파크, 예스24, 멜론티켓, 티켓링크, NOL 티켓 등
   - 이 사이트들의 가격, 날짜, 장소 정보가 가장 정확합니다
2. 네이버 플레이스 정보도 높은 우선순위로 활용하세요
3. 블로그는 참고용으로만 사용하세요 (정확도가 낮을 수 있음)
4. 팝업스토어/전시의 경우, 건물(예: 롯데월드몰, 백화점) 영업시간을 참고하세요

1. **start_date / end_date**: 시작일과 종료일 (YYYY-MM-DD 형식)
   - 검색 결과에서 "~까지", "기간", "일정" 등의 키워드로 날짜 추출
   - 예: "2026.01.23~2026.02.22" → start_date: "2026-01-23", end_date: "2026-02-22"
   - 종료일이 없으면 start_date만 반환

2. **venue**: 장소명 ⭐ **매우 중요! 정확하고 공식적인 이름 사용**
   
   **🏛️ 추출 원칙**:
   - **네이버 플레이스의 공식 명칭**을 최우선으로 사용
   - 장소 정보 섹션에서 가장 **정확하고 자세한** 이름 선택
   - 건물명이 있으면 포함 (예: "용인포은아트홀 (용인포은아트홀)")
   - 줄임말이나 약칭보다는 **정식 명칭** 사용
   
   **✅ 좋은 예시**:
   - "용인포은아트홀 (용인포은아트홀)"
   - "서울랜드 (피크닉광장)"
   - "롯데월드몰"
   - "국립중앙박물관"
   
   **❌ 나쁜 예시**:
   - "서울랜드" (괄호 안 세부 장소 누락)
   - "롯데월드" (정확한 건물명이 아님)

3. **address**: 주소 ⭐ **매우 중요! 완전한 도로명 주소 필수**
   
   **📍 추출 원칙**:
   - **도로명 주소 전체**를 정확히 추출 (시/도 → 구 → 동/로 → 번지)
   - 네이버 플레이스의 roadAddress를 최우선으로 사용
   - **상세 주소**(동/층/호)가 있으면 반드시 포함
   
   **✅ 좋은 예시**:
   - "경기도 용인시 수지구 포은대로 499 (죽전동)"
   - "서울특별시 송파구 올림픽로 300 (잠실동)"
   - "경기도 과천시 막계동 108 서울랜드"
   
   **❌ 나쁜 예시**:
   - "과천시 막계동 108" (시/도 누락)
   - "서울 송파구" (구체적 주소 없음)
   - "롯데월드몰" (주소가 아닌 장소명)

4. **overview_raw**: 내부용 개요 (상세 정보) ⭐⭐⭐ **AI 특화 필드 추출용!**
   
   **📝 작성 원칙**:
   - 검색 결과의 정보를 **모두 종합**하여 상세하게 작성
   - **5-7문장**으로 구성 (정보가 많을수록 좋음!)
   - 날짜, 시간, 장소, 출연진, 작가, 할인 정보 등 **모든 세부 정보 포함**
   
   **✅ 좋은 예시**:
   - "2026년 2월 18일 롯데콘서트홀에서 제13회 실내악스케치 공연이 개최됩니다. 리움챔버오케스트라와 한국피아노협회가 주최하는 이번 공연은 섬세한 실내악 선율을 통해 관객들에게 깊은 감동을 선사할 예정입니다. 초등학생 이상 관람 가능하며, 약 100분간의 러닝타임 동안 인터미션 10분이 포함되어 있습니다. 2026년 1월 28일 티켓이 오픈될 예정이니, 아름다운 실내악의 세계로 초대하는 이번 곳곳을 놓치지 마세요."

5. **overview**: 사용자용 개요 (매력적인 설명) ⭐⭐⭐ **사용자에게 노출!**
   
   **📝 작성 원칙**:
   - **절대 딱딱한 형식 금지!** 사용자의 관심을 끌어야 함
   - **2-3문장**으로 간결하게 (너무 길면 안됨!)
   - 흥미, 감성, 기대감을 자극하는 표현 사용
   - 날짜/시간 같은 세부 정보는 최소화
   
   **포함해야 할 내용**:
   1. 이벤트의 **핵심 매력 포인트** (왜 가야 하는가?)
   2. **감성적인 표현** (기대감, 설렘, 특별함)
   3. **대상/분위기** (누구에게 추천하는가?)
   
   **❌ 나쁜 예시 (딱딱함)**:
   - "2026년 2월 18일 롯데콘서트홀에서 제13회 실내악스케치 공연이 개최됩니다. 리움챔버오케스트라와 한국피아노협회가 주최하는 이번 공연은..." (→ 너무 형식적!)
   
   **✅ 좋은 예시 (매력적)**:
   - **공연**: "피아노와 첼로가 만들어내는 섬세한 실내악의 세계로 초대합니다. 아름다운 선율 속에서 일상의 소음을 잊고 깊이 있는 감동을 경험해보세요."
   
   - **전시**: "디지털 아트의 선구자 팀랩이 선보이는 빛과 소리의 향연. 작품 속으로 들어가 직접 일부가 되는 특별한 경험을 만나보세요."
   
   - **팝업**: "쿠키런 캐릭터들이 살아 움직이는 인터랙티브 아트 콜라보! SNS 인증샷 필수 포토존과 한정판 굿즈도 놓치지 마세요."
   
   **🎯 작성 가이드**:
   - 검색 결과의 **키워드들을 조합**하되, 문장 구조는 완전히 새롭게
   - "~입니다", "~합니다" 같은 명확한 서술어 사용
   - 추상적 표현(다양한, 풍부한) 대신 **구체적 표현** 사용
   - 이벤트의 **감성/분위기**를 전달하는 형용사 활용

5. **opening_hours**: 운영/공연 시간 ⭐ **가장 중요! 반드시 추출하세요!**
   
   **🎭 카테고리별 구분이 매우 중요합니다!**
   
   **A. 공연/뮤지컬/연극 → 공연 시작 시간을 추출하세요!**
   - weekday: 공연 시작 시간 (예: "19:30", "14:00, 19:00")
   - weekend: 주말 공연 시작 시간 (예: "14:00, 18:00")
   - notes: 공연 관련 추가 정보 (예: "목, 금 19:30 / 토, 일 14:00, 18:00")
   - 검색 결과에서 "공연시간", "시간", "목, 금 19:30" 같은 표현 찾기
   - 예: "공연시간: 목, 금 19:30" → weekday: "19:30", notes: "목, 금 19:30"
   - 예: "토, 일 14:00, 18:00" → weekend: "14:00, 18:00"
   
   **B. 전시/팝업/박물관 → 장소 운영 시간을 추출하세요!**
   - weekday: 평일 운영 시간 (예: "10:00-18:00", "11:00-20:00")
   - weekend: 주말 운영 시간 (예: "10:00-20:00", "11:00-21:00")
   - holiday: 공휴일 운영 시간
   - closed: 휴무일 (예: "월요일", "연중무휴")
   - notes: 추가 설명 (예: "입장 마감 30분 전")
   
   **🔥 추출 전략**:
   1. **공식 예매/예약 사이트에서 "공연시간" 또는 "운영시간" 키워드 찾기**
   2. **블로그에서 "시간", "평일", "주말", "공연시간", "오픈" 키워드 주변 확인**
   3. 네이버 플레이스에서 영업시간 정보 확인
   4. **반드시 구체적인 시간을 추출하세요! "회차별 상이"는 최후의 수단입니다**

6. **price_min / price_max**: 가격 (숫자만, 원 단위)
   - **최우선**: 🎫 공식 예매/예약 사이트의 가격 정보를 사용하세요!
   - 블로그나 기타 사이트의 가격은 부정확할 수 있으니 참고만 하세요
   - "무료" → min: 0, max: 0
   - "성인 15,000원" → min: 15000, max: 15000
   - "5,000원~20,000원" → min: 5000, max: 20000
   - "성인 15,000원, 아동 10,000원" → min: 10000, max: 15000
   - **할인가가 있는 경우**: 
     * "50,000원 → 10,000원 (할인)" → min: 10000, max: 50000
     * min은 최저가 (할인가 포함), max는 최고가 (정상가)
   - price_notes: 가격 상세 설명 (할인 정보, 조건 포함)

7. **reservation_required**: 예약 필수 여부 (true/false)
   - reservation_link: 예약 링크 URL

8. **external_links**: 외부 링크 ⭐⭐⭐ **매우 중요! 정확한 URL 추출이 핵심입니다!**
   
   **⚠️ URL 추출 형식 - 절대 지킬 것!**
   - ✅ **순수 URL만 추출**: https://www.example.com/view.do?id=123
   - ❌ **HTML 태그 금지**: <a href="https://..."> 또는 href="https://..." (절대 안됨!)
   - ❌ **마크다운 금지**: [링크](https://...) (절대 안됨!)
   
   **🔗 URL 추출 우선순위**:
   
   A. **official (이벤트 상세 페이지)**:
      - ✅ **최우선**: URL에 /view, /detail, /performanceView, ?code=, ?id= 등이 포함된 상세 페이지
      - 예: https://www.daejeon.go.kr/djac/performanceView.do?menuSeq=6709&code=5398 ✅
      - 예: https://www.snart.or.kr/main/prex/prefer/view.do?prfr_exhb_sn=38441 ✅
      - ❌ **절대 안됨**: http://www.daejeon.go.kr/djac (메인 페이지만)
      - ❌ **절대 안됨**: http://www.snart.or.kr (메인 페이지만)
      - 검색 결과의 **모든 링크**를 꼼꼼히 확인하여 이벤트 제목이 포함된 상세 URL 찾기
      - 웹 검색 결과에서 "공식 사이트", "홈페이지" 키워드 주변의 링크 확인
   
   B. **ticket (예매 링크)**:
      - 인터파크, 예스24, 멜론티켓, 티켓링크, NOL티켓, KOPIS 등
      - "✅ 예매 링크:" 표시된 링크를 반드시 포함
      - 예: https://tickets.interpark.com/goods/...
   
   C. **reservation (예약 링크)**:
      - 네이버 예약(booking.naver.com), 테이블링, 캐치테이블 등
   
   **⚠️ 주의사항**:
   - 메인 페이지 URL(예: www.example.com)은 official로 사용하지 마세요
   - 반드시 이벤트를 직접 볼 수 있는 상세 페이지 URL을 찾으세요
   - 검색 결과의 모든 URL을 확인하세요!
   - **HTML 태그나 마크다운 형식이 아닌 순수 URL만 반환하세요!**

9. **age_restriction**: 연령 제한
   - 예: "전체관람가", "만 7세 이상", "19세 이상"

10. **derived_tags**: 추천 태그 ⭐⭐⭐ **매우 중요! 반드시 5개 선정**
    
    **🏷️ 태그 선정 원칙**:
    - **정확히 5개**를 선정하세요 (3개 미만은 절대 안됨!)
    - 사용자가 **"나에게 맞는 이벤트인가?"** 판단할 수 있는 태그
    - 이벤트의 **분위기, 대상, 특징**을 다각도로 표현
    
    **🎯 태그 카테고리별 가이드**:
    
    **A. 동행 대상** (필수 1개):
    - 데이트, 가족, 친구, 혼자, 아이와함께, 커플, 단체
    
    **B. 분위기/스타일** (필수 1개):
    - 힙한, 조용한, 활기찬, 감성적인, 전통적인, 모던한, 아늑한, 고급스러운
    
    **C. 경험/특징** (필수 1-2개):
    - 사진맛집, 체험형, 교육적인, 힐링, 인터랙티브, 기념품, 공연, 전시
    
    **D. 추가 특성** (선택 1-2개):
    - 실내, 야외, 무료, 주말추천, 연말맞이, 봄나들이, 여름휴가, 가을감성, 겨울감성
    
    **❌ 나쁜 예시**:
    - ["공연", "전시", "뮤지컬"] ← 카테고리만 나열, 분위기/대상 정보 없음
    - ["재미있는", "좋은"] ← 너무 추상적
    - ["데이트", "가족"] ← 2개만, 너무 적음
    
    **✅ 좋은 예시**:
    - **뮤지컬**: ["가족", "아이와함께", "유쾌한", "주말추천", "체험형"]
    - **전시**: ["데이트", "힙한", "사진맛집", "인터랙티브", "실내"]
    - **공연**: ["혼자", "감성적인", "조용한", "힐링", "클래식"]
    - **팝업**: ["친구", "힙한", "사진맛집", "기념품", "한정기간"]
    - **페스티벌**: ["가족", "활기찬", "야외", "체험형", "주말추천"]
    
    **🎯 선정 프로세스**:
    1. 이벤트 제목/개요에서 **핵심 키워드** 3개 추출
    2. 카테고리(공연/전시/팝업 등)의 **일반적 특성** 반영
    3. 검색 결과의 **블로그 후기 문구**에서 힌트 얻기
    4. A, B, C, D 카테고리에서 **균형있게** 선정

11. **parking_info**: 주차 정보
12. **public_transport_info**: 대중교통 정보
13. **accessibility_info**: 장애인 편의시설

---

## 🎨 Phase 3: 카테고리 특화 필드 (전시/공연만 해당)

### ⭐ 전시 카테고리일 경우만 추출 ("${category}" === "전시")

14. **exhibition_display**: 전시 전용 필드 객체
   - **artists**: 작가/아티스트 이름 배열
     * 검색 결과에서 "작가", "아티스트", "전시 작가" 키워드 주변 확인
     * 예: ["팀랩", "구사마 야요이"]
   
   - **genre**: 장르 배열
     * "미디어아트", "현대미술", "사진전", "조각전" 등
     * 예: ["미디어아트", "현대미술"]
   
   - **facilities**: 편의시설 객체 ⭐ **블로그 리뷰에서 반드시 확인!**
     * **photo_zone**: 포토존 유무 (키워드: "포토존", "인증샷", "사진 찍기 좋은")
     * **audio_guide**: 오디오 가이드 (키워드: "오디오가이드", "음성 해설")
     * **goods_shop**: 굿즈샵 (키워드: "굿즈", "기념품샵", "굿즈샵")
     * **cafe**: 카페 (키워드: "카페", "커피", "휴게공간")
     * **중요**: 블로그 리뷰에서 명확히 언급된 경우만 true, 불확실하면 false
   
   - **docent_tour**: 도슨트 투어 시간
     * 예: "매일 14:00", "평일 11:00, 15:00"
     * 키워드: "도슨트", "큐레이터 투어", "전시 해설"
   
   - **special_programs**: 특별 프로그램 배열
     * 예: ["작가와의 대화", "워크샵", "키즈 프로그램"]
   
   - **photography_allowed**: 촬영 가능 여부
     * true: 전체 촬영 가능
     * "partial": 일부만 가능 ("일부 작품만", "플래시 금지")
     * false: 촬영 불가
     * null: 정보 없음
   
   - **last_admission**: 입장 마감 시간
     * 예: "17:30" (운영 종료 30분 전 등)
     * 키워드: "입장 마감", "매표 마감"

### 🎭 공연 카테고리일 경우만 추출 ("${category}" === "공연")

15. **performance_display**: 공연 전용 필드 객체
   - **cast**: 출연진 배열 ⭐ **이미 KOPIS payload에서 추출 가능하지만 추가 확인**
     * 예: ["조승우", "홍광호", "김소현"]
     * 검색 결과에서 "출연", "캐스팅" 키워드 확인
   
   - **genre**: 장르 배열 ⭐ **이미 KOPIS payload에서 추출 가능하지만 추가 확인**
     * 예: ["뮤지컬", "콘서트", "발라드"]
   
   - **crew**: 제작진 객체 ⭐ **블로그/공식 사이트에서 확인**
     * **director**: 연출자 (키워드: "연출", "디렉터")
     * **writer**: 작가 (키워드: "작가", "극본")
     * **composer**: 작곡가 (키워드: "작곡", "음악감독")
   
   - **intermission**: 인터미션 (중간 휴식) 유무
     * true/false
     * 키워드: "인터미션", "중간 휴식", "휴식 시간"
   
   - **discounts**: 할인 정보 배열 ⭐ **예매 사이트/블로그에서 반드시 확인**
     * 예: ["조기예매 30%", "학생 50%", "단체 20%"]
     * 키워드: "할인", "조기예매", "얼리버드", "학생할인", "단체할인"
   
   - **last_admission**: 입장 마감 시간 (공연 시작 전)
     * 예: "공연 시작 10분 전"
     * 키워드: "입장 마감", "지각 입장 불가"

### 🎪 축제 카테고리일 경우만 추출 ("${category}" === "축제")

16. **festival_display**: 축제 전용 필드 객체
   - **organizer**: 주최/주관 기관
     * 예: "서울시 관광재단", "문화체육관광부", "평창군청"
     * 검색 결과에서 "주최", "주관", "주관기관" 키워드 확인
   
   - **program_highlights**: 주요 프로그램 요약
     * 축제의 핵심 이벤트들을 간략히 설명
     * 예: "개막식 불꽃놀이, K-POP 공연, LED 등불 전시, 푸드마켓"
     * 검색 결과에서 "프로그램", "이벤트", "공연", "체험" 키워드 확인
   
   - **food_and_booths**: 먹거리/체험 부스 정보
     * 예: "푸드트럭 20개, 지역 특산물 판매, 체험 부스 10개"
     * 검색 결과에서 "먹거리", "푸드트럭", "부스", "체험" 키워드 확인
   
   - **scale_text**: 규모 (방문객 수, 부스 수 등)
     * 예: "작년 50만 명 방문", "전국 최대 규모", "100개 부스 운영"
     * 검색 결과에서 "규모", "방문객", "명 예상" 키워드 확인
   
   - **parking_tips**: 주차 정보
     * 예: "행사장 주차 불가, 인근 공영주차장 이용 권장", "셔틀버스 운영"
     * 검색 결과에서 "주차", "셔틀", "대중교통" 키워드 확인

### 📅 행사 카테고리일 경우만 추출 ("${category}" === "행사")

17. **event_display**: 행사 전용 필드 객체
   - **target_audience**: 참가 대상
     * 예: "대학생, 취준생", "초등학생 이상", "일반인 누구나"
     * 검색 결과에서 "대상", "참가자", "자격" 키워드 확인
   
   - **capacity**: 정원
     * 예: "선착순 50명", "정원 100명", "제한 없음"
     * 검색 결과에서 "정원", "선착순", "인원" 키워드 확인
   
   - **registration**: 사전 등록 정보 객체
     * **required**: 사전 등록 필요 여부 (true/false)
     * **url**: 등록 링크 (구글폼, 네이버폼 등)
     * **deadline**: 등록 마감일 (YYYY-MM-DD)
     * 검색 결과에서 "사전등록", "신청", "폼", "마감" 키워드 확인

### 🏪 팝업 카테고리일 경우만 추출 ("${category}" === "팝업")

18. **popup_display**: 팝업 전용 필드 객체 (F&B 강화!)
   - **type**: ⭐⭐⭐ 팝업 타입 ("fnb" | "collab" | "general")
     * **"fnb"**: 음식/디저트/카페 팝업 (예: 노티드, 두쫀쿠, 베이글 팝업)
     * **"collab"**: 브랜드 간 협업 팝업 (예: 노티드x산리오, 카카오x디즈니)
     * **"general"**: 일반 팝업 (단독 브랜드 굿즈/제품 판매)
     * 검색 결과에서 "디저트", "카페", "메뉴", "콜라보", "협업" 키워드 확인
   
   - **brands**: 브랜드명 배열
     * 예: ["노티드", "산리오"], ["카카오프렌즈"]
     * 콜라보인 경우 협업 브랜드 모두 포함
   
   - **collab_description**: ⭐ 콜라보 설명 (type이 "collab"일 때만!)
     * **중요**: 단순한 행사 설명이 아닌 **"어떤 브랜드와 어떤 브랜드가 협업했는지"를 명확히 강조**
     * **포함해야 할 내용**:
       1. 협업 브랜드 명시 (예: "A와 B의 콜라보", "A x B 협업")
       2. 콜라보의 특별한 점 (첫 협업, 리미티드 에디션 등)
       3. 콜라보 한정 아이템/메뉴가 있다면 간단히 언급
     * **좋은 예시**:
       - "노티드와 산리오 캐릭터즈의 첫 공식 콜라보레이션으로, 시나모롤과 쿠로미 캐릭터가 적용된 한정판 디저트를 선보입니다."
       - "무신사 스탠다드와 뉴발란스가 손잡은 특별 협업 팝업으로, 한정판 스니커즈와 익스클루시브 의류를 만나볼 수 있습니다."
     * **나쁜 예시** (너무 일반적):
       - "다양한 브랜드의 제품을 만나볼 수 있는 팝업입니다." ❌
       - "특별한 아이템들이 준비되어 있습니다." ❌
     * 검색 결과에서 "콜라보", "협업", "X", "×" 키워드와 브랜드명 확인
   
   - **fnb_items**: ⭐⭐⭐ F&B 정보 객체 (type이 "fnb"일 때만!)
     * **signature_menu**: 시그니처 메뉴 배열
       - 예: ["쪽파 크림치즈 베이글", "두쫀쿠"], ["시그니처 도넛"]
       - 검색 결과에서 "시그니처", "인기", "대표 메뉴" 키워드 확인
     * **soldout_time_avg**: ⭐ 평균 품절 시간
       - 예: "평일 14시, 주말 12시", "오픈 1시간 내 품절"
       - 검색 결과에서 "품절", "조기 소진", "오픈런" 키워드 확인
     * **purchase_limit**: ⭐ 구매 제한
       - 예: "1인 3개 한정", "중복 구매 불가"
       - 검색 결과에서 "제한", "한정", "1인당" 키워드 확인
     * **menu_categories**: 메뉴 카테고리 배열
       - 예: ["베이글", "커피", "디저트"], ["도넛", "음료"]
     * **price_range**: 가격대
       - 예: "5,000원~15,000원", "8,000원 대"
     * **best_items**: 인기 아이템 (품절 주의!)
       - 예: ["조기 품절", "오픈런 필수"], ["평일 14시 품절"]
   
   - **goods_items**: 판매 굿즈 배열
     * 예: ["한정판 에코백", "키링", "포토카드"]
     * 검색 결과에서 "굿즈", "한정판", "판매" 키워드 확인
   
   - **limited_edition**: 한정판/한정 수량 여부 (true/false)
     * 검색 결과에서 "한정", "선착순", "수량 제한" 키워드 확인
   
   - **photo_zone**: 포토존 유무 (true/false)
     * 검색 결과에서 "포토존", "인증샷", "사진" 키워드 확인
   
   - **photo_zone_desc**: 포토존 설명 **및 위치**
     * **위치 정보 필수**: "1층 입구", "매장 안쪽", "2층 계단 옆" 등 구체적인 위치 포함
     * 예: "매장 입구 오른쪽에 대형 곰인형 포토존", "2층 계단 옆 LED 조명 배경", "입구 바로 앞 브랜드 로고 포토존"
     * 블로그 후기에서 "입구", "안쪽", "층", "옆", "앞", "뒤" 등의 위치 키워드 주의 깊게 확인
   
   - **waiting_hint**: ⭐ 대기 시간 힌트 객체 (level + text 모두 필수!)
     * **level**: 대기 수준 ("low" | "medium" | "high")
       - low: 10분 이내, 빠른 입장
       - medium: 20-40분, 보통 혼잡
       - high: 1시간 이상, 오픈런 필수
     * **text**: ⭐⭐⭐ 대기 시간 상세 설명 (매우 중요!)
       - **반드시 구체적인 시간대/요일 정보 포함**
       - **좋은 예시**:
         * "평일 오후 2-5시는 대기 없음, 주말 오픈 시간(11시)에는 30분 대기"
         * "주말 오픈 1시간 전부터 줄 서기 시작, 평일은 비교적 여유"
         * "오픈런 필수! 주말 낮 시간대는 최대 1시간 이상 대기"
       - **나쁜 예시** (너무 간단):
         * "대기 있음" ❌
         * "혼잡함" ❌
       - 검색 결과에서 "대기", "줄", "혼잡", "오픈런", "평일", "주말", "시간" 키워드 확인
     * **중요**: level만 있고 text가 없으면 사용자에게 도움이 안 됨!

**⚠️ 중요 규칙**:
1. **전시 카테고리가 아니면 exhibition_display를 null로 반환하세요**
2. **공연 카테고리가 아니면 performance_display를 null로 반환하세요**
3. **축제 카테고리가 아니면 festival_display를 null로 반환하세요**
4. **행사 카테고리가 아니면 event_display를 null로 반환하세요**
5. **팝업 카테고리가 아니면 popup_display를 null로 반환하세요**
6. **블로그 리뷰를 꼼꼼히 확인하세요!** (F&B 메뉴, 대기 시간, 굿즈 정보가 많이 있음)
7. **명확한 증거가 없으면 null 또는 false로 표시하세요**

---

**⚠️ 중요: 운영시간(opening_hours)은 반드시 채워주세요!**
- 검색 결과에 운영시간이 없으면 **카테고리별 일반적인 운영시간을 추론**하세요
- **절대 null로 두지 마세요**
- 카테고리별 기본 운영시간:
  * **전시/갤러리**: weekday: "10:00-18:00", weekend: "10:00-20:00", closed: "월요일"
  * **팝업스토어**: weekday: "11:00-20:00", weekend: "11:00-21:00", closed: "없음" (건물 영업시간)
  * **공연/뮤지컬**: notes: "회차별 상이, 예매 페이지 참고"
  * **페스티벌**: weekday: "10:00-22:00", weekend: "10:00-23:00"
  * **전통문화/박물관**: weekday: "09:00-18:00", weekend: "09:00-18:00", closed: "월요일"

**응답 형식**: 반드시 아래 JSON 형식으로만 응답하세요. 다른 설명은 불필요합니다.

### 전시 카테고리 예시:
\`\`\`json
{
  "start_date": "2026-01-23",
  "end_date": "2026-02-22",
  "venue": "롯데월드몰",
  "address": "서울특별시 송파구 올림픽로 300",
  "overview": "디지털 아트의 선두주자 팀랩이 선보이는 인터랙티브 미디어아트 전시입니다. 빛과 소리가 어우러진 몰입형 공간에서 관람객이 직접 작품의 일부가 되는 독특한 경험을 제공합니다. SNS 인증샷 명소로도 유명하며, 가족 단위 관람객에게 특히 인기가 높습니다.",
  "opening_hours": { 
    "weekday": "10:00-19:00", 
    "weekend": "10:00-20:00", 
    "closed": "월요일",
    "notes": "입장 마감 1시간 전" 
  },
  "price_min": 15000,
  "price_max": 20000,
  "price_notes": "성인 20,000원, 청소년 15,000원",
  "reservation_required": false,
  "reservation_link": null,
  "external_links": { "official": "https://...", "ticket": "https://...", "reservation": null },
  "age_restriction": "전체관람가",
  "derived_tags": ["데이트", "힙한", "사진맛집", "인터랙티브", "실내"],
  "parking_info": "건물 주차장 이용 가능",
  "public_transport_info": "2호선 잠실역 1번 출구",
  "accessibility_info": null,
  "exhibition_display": {
    "artists": ["팀랩"],
    "genre": ["미디어아트", "현대미술"],
    "facilities": {
      "photo_zone": true,
      "audio_guide": false,
      "goods_shop": true,
      "cafe": true
    },
    "docent_tour": null,
    "special_programs": [],
    "photography_allowed": true,
    "last_admission": "18:00"
  },
  "performance_display": null
}
\`\`\`

### 공연 카테고리 예시:
\`\`\`json
{
  "start_date": "2026-03-01",
  "end_date": "2026-05-31",
  "venue": "샤롯데씨어터",
  "address": "서울특별시 송파구 올림픽로 240",
  "overview": "브로드웨이 명작 뮤지컬의 국내 라이센스 공연으로, 웅장한 음악과 화려한 무대가 압도적인 감동을 선사합니다. 주연 배우들의 열정적인 연기와 뛰어난 가창력이 돋보이며, 뮤지컬 팬이라면 반드시 봐야 할 작품으로 손꼽힙니다.",
  "opening_hours": { 
    "notes": "화~금 19:30, 토 14:00/18:00, 일 15:00" 
  },
  "price_min": 60000,
  "price_max": 150000,
  "price_notes": "VIP석 150,000원, R석 120,000원, S석 90,000원, A석 60,000원",
  "reservation_required": true,
  "reservation_link": "https://tickets.interpark.com/...",
  "external_links": { "official": "https://...", "ticket": "https://tickets.interpark.com/...", "reservation": null },
  "age_restriction": "만 8세 이상",
  "derived_tags": ["데이트", "감성적인", "뮤지컬", "주말추천", "실내"],
  "parking_info": "건물 주차장 3시간 무료",
  "public_transport_info": "2호선 잠실새내역 2번 출구 도보 5분",
  "accessibility_info": "휠체어석 별도 운영",
  "exhibition_display": null,
  "performance_display": {
    "cast": ["조승우", "홍광호", "김소현"],
    "genre": ["뮤지컬"],
    "crew": {
      "director": "홍길동",
      "writer": "김작가",
      "composer": "박작곡"
    },
    "intermission": true,
    "discounts": ["조기예매 30%", "학생 20%", "장애인 50%"],
    "last_admission": "공연 시작 10분 전"
  }
}
\`\`\`

**⚠️ 다시 강조**: 전시가 아니면 exhibition_display는 null, 공연이 아니면 performance_display는 null로 반환하세요!

---

# 🚨 필수 응답 필드 (절대 누락 금지!)

**반드시 아래 필드를 모두 포함하세요:**

1. **기본 필드**: start_date, end_date, venue, address, overview, opening_hours, price_min, price_max, external_links, age_restriction, derived_tags
2. **카테고리 특화 필드** (매우 중요!):
   - **공연**: \`exhibition_display: null\`, \`festival_display: null\`, \`event_display: null\`, \`popup_display: null\`, \`performance_display: { cast, genre, duration_minutes, crew, intermission, discounts, ... }\`
     - **duration_minutes**: 공연 러닝타임 (분 단위, 예: 150 = 2시간 30분) - "120분", "2시간", "러닝타임 100분" 등을 찾아서 숫자로 변환
     - **opening_hours.notes**: 공연 시간대 ("화~금 19:30, 토 14:00/18:00")
   - **전시**: \`exhibition_display: { artists, genre, facilities, ... }\`, \`performance_display: null\`, \`festival_display: null\`, \`event_display: null\`, \`popup_display: null\`
   - **축제 (현재 카테고리: ${category})**: \`festival_display: { organizer, program_highlights, food_and_booths, scale_text, parking_tips }\`, \`exhibition_display: null\`, \`performance_display: null\`, \`event_display: null\`, \`popup_display: null\`
   - **행사**: \`event_display: { target_audience, capacity, registration }\`, \`exhibition_display: null\`, \`performance_display: null\`, \`festival_display: null\`, \`popup_display: null\`
   - **팝업**: \`popup_display: { brands, is_fnb, fnb_items, goods_items, ... }\`, \`exhibition_display: null\`, \`performance_display: null\`, \`festival_display: null\`, \`event_display: null\`

**❌ 잘못된 응답 (performance_display 누락)**:
\`\`\`json
{
  "overview": "...",
  "opening_hours": {...}
  // ❌ performance_display가 없음!
}
\`\`\`

**✅ 올바른 응답 (필수 필드 포함)**:
\`\`\`json
{
  "overview": "...",
  "opening_hours": {...},
  "exhibition_display": null,
  "performance_display": {
    "cast": ["출연진1", "출연진2"],
    "genre": ["장르1"],
    "crew": { "director": "연출자" },
    "intermission": true,
    "discounts": ["할인 정보"]
  },
  "festival_display": null,
  "event_display": null,
  "popup_display": null
}
\`\`\`

### 🎪 축제 카테고리 예시:
\`\`\`json
{
  "start_date": "2026-01-15",
  "end_date": "2026-02-15",
  "venue": "평창 알펜시아 리조트",
  "address": "강원도 평창군 대관령면 솔봉로 325",
  "overview": "하얀 눈 속에서 펼쳐지는 겨울의 낭만! 설경과 함께 즐기는 K-POP 공연, LED 등불 전시, 그리고 지역 특산물 푸드마켓까지. 가족과 함께 겨울 추억을 만들어보세요.",
  "opening_hours": { 
    "weekday": "10:00-22:00", 
    "weekend": "10:00-23:00"
  },
  "price_min": 0,
  "price_max": 0,
  "price_notes": "무료 (일부 체험 프로그램 유료)",
  "external_links": { "official": "https://...", "ticket": null, "reservation": null },
  "age_restriction": "전체관람가",
  "derived_tags": ["가족", "활기찬", "야외", "체험형", "겨울감성"],
  "exhibition_display": null,
  "performance_display": null,
  "festival_display": {
    "organizer": "평창군청, 강원도 관광재단",
    "program_highlights": "개막식 불꽃놀이, K-POP 콘서트, LED 등불 전시, 눈꽃 트레킹, 지역 특산물 푸드마켓",
    "food_and_booths": "푸드트럭 20개, 지역 특산물 판매, 체험 부스 15개",
    "scale_text": "작년 기준 50만 명 방문, 전국 최대 겨울 축제",
    "parking_tips": "행사장 주차 제한, 셔틀버스 운영 (대관령 역 출발)"
  },
  "event_display": null,
  "popup_display": null
}
\`\`\`

### 📅 행사 카테고리 예시:
\`\`\`json
{
  "start_date": "2026-03-10",
  "end_date": "2026-03-10",
  "venue": "코엑스 컨퍼런스룸",
  "address": "서울특별시 강남구 영동대로 513",
  "overview": "AI 스타트업 창업을 꿈꾸는 분들을 위한 실전 워크샵! 현직 창업자의 생생한 경험담과 투자 유치 노하우를 배우고, 네트워킹 기회도 얻어가세요.",
  "opening_hours": { 
    "notes": "14:00-18:00 (1회 진행)"
  },
  "price_min": 0,
  "price_max": 30000,
  "price_notes": "사전등록 무료, 현장등록 30,000원",
  "external_links": { "official": "https://...", "ticket": null, "reservation": "https://forms.gle/..." },
  "age_restriction": "대학생 이상",
  "derived_tags": ["혼자", "교육적인", "네트워킹", "실내", "주말추천"],
  "exhibition_display": null,
  "performance_display": null,
  "festival_display": null,
  "event_display": {
    "target_audience": "대학생, 취준생, 예비 창업자",
    "capacity": "선착순 100명",
    "registration": {
      "required": true,
      "url": "https://forms.gle/example",
      "deadline": "2026-03-08"
    }
  },
  "popup_display": null
}
\`\`\`

### 🏪 팝업 카테고리 예시 (F&B):
\`\`\`json
{
  "start_date": "2026-02-01",
  "end_date": "2026-02-28",
  "venue": "롯데월드몰",
  "address": "서울특별시 송파구 올림픽로 300",
  "overview": "쫄깃한 식감이 매력인 두쫀쿠 팝업이 롯데월드몰에 상륙! 시그니처 쪽파 크림치즈 베이글과 함께 SNS 인증샷 필수 포토존도 준비되어 있습니다. 평일에도 조기 품절되니 오픈런 추천!",
  "opening_hours": { 
    "weekday": "11:00-20:00", 
    "weekend": "11:00-21:00"
  },
  "price_min": 5000,
  "price_max": 15000,
  "price_notes": "베이글 8,000원, 음료 5,000원~7,000원",
  "external_links": { "official": null, "ticket": null, "reservation": "https://booking.naver.com/..." },
  "age_restriction": "전체관람가",
  "derived_tags": ["친구", "힙한", "사진맛집", "디저트", "한정기간"],
  "exhibition_display": null,
  "performance_display": null,
  "festival_display": null,
  "event_display": null,
  "popup_display": {
    "type": "fnb",
    "brands": ["두쫀쿠"],
    "fnb_items": {
      "signature_menu": ["쪽파 크림치즈 베이글", "시그니처 쿠키"],
      "soldout_time_avg": "평일 14시, 주말 12시",
      "purchase_limit": "1인 3개 한정",
      "menu_categories": ["베이글", "쿠키", "음료"],
      "price_range": "5,000원~15,000원",
      "best_items": ["평일 14시 품절", "주말 오픈런 필수"]
    },
    "goods_items": ["에코백", "키링"],
    "limited_edition": true,
    "photo_zone": true,
    "photo_zone_desc": "매장 입구 왼쪽에 대형 베이글 조형물 포토존 (입구에서 바로 보임)",
    "waiting_hint": {
      "level": "high",
      "text": "주말 오픈런 추천, 평일 오후는 대기 20-30분"
    }
  }
}
\`\`\`

### 🤝 팝업 카테고리 예시 (콜라보):
\`\`\`json
{
  "start_date": "2026-02-01",
  "end_date": "2026-02-28",
  "venue": "성수동 팝업스토어",
  "address": "서울특별시 성동구 연무장길 12",
  "overview": "노티드와 산리오 캐릭터즈의 첫 공식 콜라보레이션! 쿠로미, 시나모롤 등 인기 캐릭터가 적용된 한정판 굿즈와 특별 메뉴를 만나보세요.",
  "opening_hours": { 
    "weekday": "11:00-20:00", 
    "weekend": "11:00-21:00"
  },
  "price_min": 8000,
  "price_max": 35000,
  "external_links": { "official": "https://notted.co.kr/..." },
  "derived_tags": ["친구", "힙한", "사진맛집", "한정판", "캐릭터"],
  "exhibition_display": null,
  "performance_display": null,
  "festival_display": null,
  "event_display": null,
  "popup_display": {
    "type": "collab",
    "brands": ["노티드", "산리오"],
    "collab_description": "노티드와 산리오 캐릭터즈의 첫 공식 콜라보레이션으로, 쿠로미/시나모롤 테마의 한정판 굿즈와 특별 메뉴 제공",
    "goods_items": ["쿠로미 에코백", "시나모롤 키링", "한정판 포토카드"],
    "limited_edition": true,
    "photo_zone": true,
    "photo_zone_desc": "2층 입구에 쿠로미/시나모롤 대형 인형 포토존",
    "waiting_hint": {
      "level": "medium",
      "text": "주말 낮 시간대 20분 대기"
    }
  }
}
\`\`\`

**지금 반드시 카테고리에 맞는 특화 필드를 포함하고, 나머지는 null로 반환하세요!**`;
}

/**
 * Phase A 보완: 섹션별로 구분된 검색 결과로 프롬프트 생성
 */
function buildExtractionPromptWithSections(
  eventTitle: string,
  category: string,
  overview: string | null,
  yearTokens: string,
  sections: {
    ticket: string[];
    official: string[];
    place: string[];
    blog: string[];
  },
  useGoogleSearch: boolean = false // 🆕 Google Search 모드
): string {
  // 섹션별 컨텍스트 구성
  const ticketSection = sections.ticket.length > 0 
    ? `\n=== 🎫 티켓/예매 정보 (최우선 참고!) ===\n${sections.ticket.join('\n---\n')}` 
    : '';
  
  const officialSection = sections.official.length > 0
    ? `\n=== 🏛️ 공식 상세 페이지 ===\n${sections.official.join('\n---\n')}`
    : '';
  
  const placeSection = sections.place.length > 0
    ? `\n=== 📍 장소 정보 (주소/운영시간) ===\n${sections.place.join('\n---\n')}`
    : '';
  
  const blogSection = sections.blog.length > 0
    ? `\n=== 📝 참고 정보 (블로그) ===\n${sections.blog.join('\n---\n')}`
    : '';

  const contextSection = useGoogleSearch 
    ? `\n⭐ **Google Search를 사용하여 최신 정보를 검색하세요!** 네이버, 공식 홈페이지, 티켓 사이트 등을 참고하여 정확한 정보만 추출하세요.`
    : `${ticketSection}${officialSection}${placeSection}${blogSection}`;

  return `당신은 이벤트 정보 추출 전문가입니다. ${useGoogleSearch ? '웹 검색을 통해' : '주어진 정보에서'} 구조화된 데이터를 추출해주세요.

# 이벤트 정보
- 제목: ${eventTitle}
- 카테고리: ${category}
- 이벤트 연도: ${yearTokens}

# ⭐ 기존 개요 (참고용)
${overview ? `\`\`\`
${overview}
\`\`\`

**📌 참고**: 위 개요는 이전에 생성된 것입니다. 새로운 검색 결과를 바탕으로 **overview_raw (상세)와 overview (매력적)를 모두 새로 작성**하세요.` : '없음 (검색 결과를 바탕으로 작성)'}

**🔥 중요 작업 순서**:
1. **먼저 overview_raw 작성**: 검색 결과의 모든 정보를 종합 (날짜, 시간, 출연진, 할인, 시설 등 모든 세부사항 포함)
2. **overview_raw를 참고해서 특화 필드 추출**: 
   - 공연 → cast, genre, duration_minutes, intermission, discounts, crew 등
   - 전시 → artists, genre, facilities, docent_tour, special_programs 등
   - 축제 → organizer, program_highlights, food_and_booths, scale_text, parking_tips 등
   - 행사 → target_audience, capacity, registration 등
   - 팝업 → brands, is_fnb, fnb_items (F&B인 경우 시그니처 메뉴 필수!), goods_items, photo_zone, waiting_hint 등
3. **overview (사용자용) 작성**: overview_raw를 바탕으로 매력적이고 간결하게 재작성

# 검색 결과 (섹션별 분류)
${contextSection}

---

⚠️ **중요: 과거 회차/공연 절대 사용 금지!**
- 이벤트 연도는 ${yearTokens}입니다
- 링크나 설명에 **다른 연도(예: 2024, 2025)**가 명시되어 있으면 **절대 사용하지 마세요**
- "지난", "종료", "완료", "판매종료" 같은 키워드가 있는 정보는 **무시**하세요
- 반드시 **${yearTokens}년 현재 진행 중**인 정보만 사용하세요!

---

위 정보를 바탕으로 다음 항목들을 추출해주세요. **정보가 없으면 null을 반환**하세요.

**🎫 최우선 원칙**: 
1. **"티켓/예매 정보" 섹션의 정보를 최우선으로 참고하세요!**
   - 인터파크, 예스24, 멜론티켓, 티켓링크, NOL 티켓 등
   - 이 사이트들의 가격, 날짜, 장소 정보가 가장 정확합니다
2. 공식 상세 페이지와 장소 정보도 높은 우선순위로 활용하세요
3. 블로그는 참고용으로만 사용하세요 (정확도가 낮을 수 있음)

1. **start_date / end_date**: 시작일과 종료일 (YYYY-MM-DD 형식)
   - 검색 결과에서 "~까지", "기간", "일정" 등의 키워드로 날짜 추출
   - **반드시 ${yearTokens}년의 날짜만** 추출하세요
   - 예: "2026.01.23~2026.02.22" → start_date: "2026-01-23", end_date: "2026-02-22"

2. **venue**: 장소명
   - 장소 정보 섹션의 place_name 또는 title 사용
   - 예: "롯데월드몰", "인사동 갤러리", "잠실 롯데타워"

3. **address**: 주소 (도로명주소 우선)
   - 장소 정보 섹션의 roadAddress 또는 address 사용
   - 예: "서울특별시 종로구 인사동9길 26"

4. **overview_raw**: 내부용 개요 (상세 정보, AI 특화 필드 추출용)
   - 검색 결과의 정보를 **모두 종합**하여 상세하게 작성
   - **5-7문장**으로 구성 (날짜, 시간, 출연진, 할인 정보 등 모든 세부 정보 포함)
   - 예: "2026년 2월 18일 롯데콘서트홀에서 제13회 실내악스케치 공연이 개최됩니다. 리움챔버오케스트라와 한국피아노협회가 주최하는 이번 공연은 섬세한 실내악 선율을 통해 관객들에게 깊은 감동을 선사할 예정입니다. 초등학생 이상 관람 가능하며, 약 100분간의 러닝타임 동안 인터미션 10분이 포함되어 있습니다."

5. **overview**: 사용자용 개요 (매력적인 설명, 사용자에게 노출)
   - **절대 딱딱한 형식 금지!** 흥미와 감성을 자극
   - **2-3문장**으로 간결하게 (날짜/시간 같은 세부 정보 최소화)
   - 예: "피아노와 첼로가 만들어내는 섬세한 실내악의 세계로 초대합니다. 아름다운 선율 속에서 일상의 소음을 잊고 깊이 있는 감동을 경험해보세요."

6. **opening_hours**: 운영/공연 시간 ⭐ **가장 중요!**
   
   **🎭 카테고리별 구분**:
   
   **A. 공연/뮤지컬/연극 → 공연 시작 시간 (공연일시 정보 찾기!)**
   
   **🔍 검색 키워드**: "공연시간", "공연일시", "공연회차", "화~금", "토일", "평일", "주말"
   
   **📌 추출 방법**:
   1. 티켓/예매 섹션 또는 공식 페이지에서 **"공연시간" 또는 "공연일시"** 정보 찾기
   2. "화(19:30), 수(14:30,19:30), 목~금(19:30), 토~일(14:00,19:00)" 형태의 스케줄 정보
   3. notes에 **원본 그대로 저장** (예: "화 목 금 7시 30분 / 수 2시 30분 7시 30분 / 토 일 공휴일 2시 7시 / 월 공연 없음")
   
   **예시**:
   \`\`\`json
   {
     "notes": "화~금 19:30, 토 14:00/18:00, 일 15:00"
   }
   \`\`\`
   
   **B. 전시/팝업/박물관 → 장소 운영 시간**
   - weekday: 평일 운영 시간 (예: "10:00-18:00")
   - weekend: 주말 운영 시간 (예: "10:00-20:00")
   - closed: 휴무일 (예: "월요일", "연중무휴")
   
   **추출 우선순위**: 티켓 섹션 > 공식 페이지 > 장소 정보 > 블로그

7. **price_min / price_max**: 가격 (숫자만, 원 단위)
   - **최우선**: 🎫 티켓/예매 섹션의 가격 정보를 사용하세요!
   - "무료" → min: 0, max: 0
   - "성인 15,000원" → min: 15000, max: 15000
   - "5,000원~20,000원" → min: 5000, max: 20000

8. **external_links**: 외부 링크 ⭐⭐⭐ **매우 중요!**
   
   **⚠️ URL 추출 형식 - 절대 지킬 것!**
   - ✅ **순수 URL만 추출**: https://www.example.com/view.do?id=123
   - ❌ **HTML 태그 금지**: <a href="https://..."> 또는 href="https://..." (절대 안됨!)
   - ❌ **마크다운 금지**: [링크](https://...) (절대 안됨!)
   
   **official**: 이벤트 상세 페이지 URL
   - ✅ 반드시 URL에 /view, /detail, /performanceView, ?code= 등이 포함된 상세 페이지
   - ✅ 예: https://www.snart.or.kr/main/prex/prefer/view.do?prfr_exhb_sn=38441
   - ❌ 메인 페이지(www.example.com)는 절대 안됨!
   
   **ticket**: 예매 링크 (티켓 섹션에서 추출)
   **reservation**: 예약 링크
   
   **반드시 순수 URL만 반환하세요! HTML 태그나 마크다운 형식 금지!**

9. **age_restriction**: 연령 제한
10. **derived_tags**: 추천 태그 (정확히 5개)
   - 동행 대상(데이트/가족/친구/혼자), 분위기(힙한/조용한/감성적인), 특징(사진맛집/체험형/힐링) 등
   - 예: ["가족", "아이와함께", "유쾌한", "주말추천", "체험형"]
11. **parking_info, public_transport_info, accessibility_info**

---

**응답 형식**: 반드시 아래 JSON 형식으로만 응답하세요.

${category === '전시' ? `
### 전시 카테고리 응답 형식:
\`\`\`json
{
  "start_date": "2026-01-23",
  "end_date": "2026-02-22",
  "venue": "롯데월드몰",
  "address": "서울특별시 송파구 올림픽로 300",
  "overview_raw": "2026년 1월 23일부터 2월 22일까지 롯데월드몰에서 팀랩의 디지털 아트 전시가 열립니다. 빛과 소리가 어우러진 몰입형 미디어아트 공간으로, 평일 10:00-19:00, 주말 10:00-20:00 운영하며 월요일은 휴무입니다. 성인 20,000원, 청소년 15,000원이며, 포토존, 굿즈샵, 카페가 있습니다. 매일 14:00 도슨트 투어가 진행되며, 작가와의 대화 프로그램도 있습니다. 촬영이 가능하며, 입장 마감은 18:00입니다.",
  "overview": "디지털 아트의 선구자 팀랩이 선보이는 빛과 소리의 향연. 작품 속으로 들어가 직접 일부가 되는 특별한 경험을 만나보세요.",
  "opening_hours": { "weekday": "10:00-19:00", "weekend": "10:00-20:00", "closed": "월요일" },
  "price_min": 15000,
  "price_max": 20000,
  "external_links": { "official": "https://...", "ticket": null, "reservation": null },
  "age_restriction": "전체관람가",
  "derived_tags": ["데이트", "힙한", "사진맛집", "인터랙티브", "실내"],
  "exhibition_display": {
    "artists": ["팀랩"],
    "genre": ["미디어아트", "현대미술"],
    "facilities": { "photo_zone": true, "audio_guide": false, "goods_shop": true, "cafe": true },
    "docent_tour": "매일 14:00",
    "special_programs": ["작가와의 대화"],
    "photography_allowed": true,
    "last_admission": "18:00"
  },
  "performance_display": null
}
\`\`\`
` : category === '공연' ? `
### 공연 카테고리 응답 형식:
\`\`\`json
{
  "start_date": "2026-03-01",
  "end_date": "2026-05-31",
  "venue": "샤롯데씨어터",
  "address": "서울특별시 송파구 올림픽로 240",
  "overview_raw": "2026년 3월 1일부터 5월 31일까지 샤롯데씨어터에서 브로드웨이 명작 뮤지컬이 공연됩니다. 조승우, 홍광호, 김소현이 출연하며, 홍길동 연출, 김작가 작가, 박작곡 작곡으로 제작되었습니다. 공연 시간은 화~금 19:30, 토 14:00/18:00, 일 15:00이며, 약 150분간 진행되고 인터미션이 있습니다. VIP석 150,000원, R석 120,000원, S석 90,000원, A석 60,000원이며, 조기예매 30%, 학생 20%, 장애인 50% 할인이 적용됩니다. 만 8세 이상 관람 가능합니다.",
  "overview": "브로드웨이의 감동이 살아있는 대작 뮤지컬. 웅장한 음악과 화려한 무대, 배우들의 열정적인 연기가 어우러져 잊지 못할 감동을 선사합니다.",
  "opening_hours": { "notes": "화~금 19:30, 토 14:00/18:00, 일 15:00" },
  "price_min": 60000,
  "price_max": 150000,
  "external_links": { "official": "https://...", "ticket": "https://tickets.interpark.com/...", "reservation": null },
  "age_restriction": "만 8세 이상",
  "derived_tags": ["데이트", "감성적인", "뮤지컬", "주말추천", "실내"],
  "exhibition_display": null,
  "performance_display": {
    "cast": ["조승우", "홍광호", "김소현"],
    "genre": ["뮤지컬"],
    "duration_minutes": 150,
    "crew": { "director": "홍길동", "writer": "김작가", "composer": "박작곡" },
    "intermission": true,
    "age_limit": "만 8세 이상",
    "discounts": ["조기예매 30%", "학생 20%", "장애인 50%"],
    "last_admission": "공연 시작 10분 전"
  }
}
\`\`\`
` : category === '팝업' ? `
### 🏪 팝업 카테고리 응답 형식 (⭐ F&B 강화):
\`\`\`json
{
  "start_date": "2026-02-01",
  "end_date": "2026-02-28",
  "venue": "롯데월드몰 지하 1층",
  "address": "서울특별시 송파구 올림픽로 300",
  "overview_raw": "2026년 2월 1일부터 2월 28일까지 롯데월드몰 지하 1층에서 노티드 팝업스토어가 오픈합니다. F&B 팝업으로, 시그니처 메뉴인 두쫀쿠, 쪽파 크림치즈 베이글, 딸기 생크림 케이크를 판매합니다. 디저트와 음료 카테고리로 구성되며, 가격대는 5천원-1만5천원대입니다. 대형 곰인형 포토존이 있으며, 주말 오픈 1시간 전부터 웨이팅이 시작됩니다. 평일 11:00-20:00, 주말 11:00-21:00 운영합니다.",
  "overview": "노티드의 인기 디저트를 한자리에서 만나보세요. 시그니처 두쫀쿠와 쪽파 베이글, SNS를 뜨겁게 달군 포토존까지 놓치지 마세요.",
  "opening_hours": { "weekday": "11:00-20:00", "weekend": "11:00-21:00", "closed": "없음" },
  "price_min": 5000,
  "price_max": 15000,
  "price_notes": "디저트 5천원-1만5천원대",
  "external_links": { "official": "https://...", "ticket": null, "reservation": null },
  "age_restriction": "전체관람가",
  "derived_tags": ["친구", "힙한", "사진맛집", "디저트", "한정기간"],
  "exhibition_display": null,
  "performance_display": null,
  "popup_display": {
    "type": "fnb",
    "brands": ["노티드"],
    "fnb_items": {
      "signature_menu": ["두쫀쿠", "쪽파 크림치즈 베이글", "딸기 생크림 케이크"],
      "soldout_time_avg": "평일 15시, 주말 12시",
      "purchase_limit": "1인 3개 한정",
      "menu_categories": ["디저트", "음료"],
      "price_range": "5천원-1만5천원대",
      "best_items": ["두쫀쿠 (추천 1위)", "쪽파 베이글 (추천 2위)"]
    },
    "photo_zone": true,
    "photo_zone_desc": "2층 계단 옆 대형 곰인형과 핑크 벽 포토존 (입구 오른쪽)",
    "waiting_hint": {
      "level": "high",
      "text": "주말 오픈 1시간 전부터 줄 서기 시작"
    }
  },
  "festival_display": null,
  "event_display": null
}
\`\`\`

**⭐ 팝업 추출 가이드**:
1. **type 판별**: 
   - "디저트", "카페", "베이커리", "음식점" 키워드 → type: "fnb"
   - "콜라보", "협업", "X", "×" 키워드 + 브랜드 2개 이상 → type: "collab"
   - 그 외 → type: "general"
2. **fnb_items (F&B 팝업만)**: 
   - **signature_menu**: 블로그에서 가장 많이 언급된 메뉴 (⭐ 필수!)
   - **soldout_time_avg**: "품절", "조기 소진" 키워드에서 시간 추출 (⭐ 필수!)
   - **purchase_limit**: "1인 N개", "구매 제한" 키워드 확인 (⭐ 필수!)
3. **collab_description (콜라보 팝업만)**: ⭐ **"브랜드 A와 브랜드 B의 협업"을 명확히 강조**, 콜라보 배경, 한정 아이템 언급 (예: "노티드와 산리오 캐릭터즈의 첫 공식 콜라보레이션으로, 시나모롤 테마 디저트 제공")
4. **photo_zone_desc**: 포토존의 특징과 **정확한 위치**를 함께 추출 (예: "대형 곰인형 포토존 (2층 입구)")
5. **waiting_hint**: ⭐ **level과 text 모두 추출!** "웨이팅", "대기", "줄서기", "오픈런", "평일", "주말", "시간" 키워드 확인 후 구체적인 시간대/요일 정보를 text에 포함
` : category === '축제' ? `
### 🎪 축제 카테고리 응답 형식:
\`\`\`json
{
  "start_date": "2026-03-15",
  "end_date": "2026-03-20",
  "venue": "여의도 한강공원",
  "address": "서울특별시 영등포구 여의동로 330",
  "overview_raw": "2026년 3월 15일부터 3월 20일까지 여의도 한강공원에서 벚꽃축제가 열립니다. 서울시 관광재단 주최로 개막식 불꽃놀이, K-POP 공연, LED 등불 전시가 진행됩니다. 푸드트럭 20개, 체험 부스 10개가 운영되며, 작년 50만 명이 방문했습니다. 행사장 주차는 불가능하며 인근 공영주차장 이용을 권장합니다. 입장은 무료입니다.",
  "overview": "벚꽃이 만개하는 봄밤, 화려한 불꽃놀이와 K-POP 공연이 어우러진 축제로 초대합니다. 가족, 친구와 함께 봄을 만끽해보세요.",
  "opening_hours": { "weekday": "10:00-22:00", "weekend": "10:00-23:00" },
  "price_min": 0,
  "price_max": 0,
  "external_links": { "official": "https://...", "ticket": null, "reservation": null },
  "age_restriction": "전체관람가",
  "derived_tags": ["가족", "활기찬", "야외", "체험형", "봄나들이"],
  "exhibition_display": null,
  "performance_display": null,
  "popup_display": null,
  "festival_display": {
    "organizer": "서울시 관광재단",
    "program_highlights": "개막식 불꽃놀이, K-POP 공연, LED 등불 전시",
    "food_and_booths": "푸드트럭 20개, 체험 부스 10개",
    "scale_text": "작년 50만 명 방문",
    "parking_tips": "행사장 주차 불가, 인근 공영주차장 이용"
  },
  "event_display": null
}
\`\`\`
` : category === '행사' ? `
### 📅 행사 카테고리 응답 형식:
\`\`\`json
{
  "start_date": "2026-04-10",
  "end_date": "2026-04-10",
  "venue": "코엑스 컨퍼런스룸",
  "address": "서울특별시 강남구 영동대로 513",
  "overview": "스타트업 채용 박람회로, 대학생과 취준생을 대상으로 20개 기업이 참여합니다. 사전 등록 필수이며 현장 등록은 불가합니다.",
  "opening_hours": { "weekday": "14:00-18:00" },
  "price_min": 0,
  "price_max": 0,
  "external_links": { "official": "https://...", "ticket": null, "reservation": "https://forms.naver.com/..." },
  "age_restriction": "대학생 이상",
  "derived_tags": ["취준생", "네트워킹", "실내", "교육적인", "커리어"],
  "exhibition_display": null,
  "performance_display": null,
  "popup_display": null,
  "festival_display": null,
  "event_display": {
    "target_audience": "대학생, 취준생",
    "capacity": "선착순 200명",
    "registration": {
      "required": true,
      "url": "https://forms.naver.com/...",
      "deadline": "2026-04-08"
    }
  }
}
\`\`\`
` : `
\`\`\`json
{
  "start_date": "2026-01-23",
  "end_date": "2026-02-22",
  "venue": "롯데월드몰",
  "address": "서울특별시 종로구 인사동9길 26",
  "overview": "어린이들을 위한 가족 뮤지컬로, 고전 동화를 현대적으로 재해석한 작품입니다.",
  "opening_hours": { "weekday": "10:00-18:00", "weekend": "10:00-20:00", "closed": "월요일" },
  "price_min": 0,
  "price_max": 0,
  "external_links": { "official": "https://...", "ticket": "https://...", "reservation": null },
  "age_restriction": "전체관람가",
  "derived_tags": ["가족", "아이와함께", "유쾌한", "주말추천", "체험형"]
}
\`\`\`
`}

**🚨 반드시 지켜야 할 규칙:**
1. **카테고리별 display 필드는 절대 생략 금지!**
   - **전시**: exhibition_display (객체), 나머지 모두 null
   - **공연**: performance_display (객체), 나머지 모두 null
   - **팝업**: popup_display (객체), 나머지 모두 null
   - **축제**: festival_display (객체), 나머지 모두 null
   - **행사**: event_display (객체), 나머지 모두 null

2. ${
  category === '공연' ? '**exhibition_display/popup_display/festival_display/event_display는 모두 null**, **performance_display는 반드시 객체로 채워주세요!**' :
  category === '전시' ? '**performance_display/popup_display/festival_display/event_display는 모두 null**, **exhibition_display는 반드시 객체로 채워주세요!**' :
  category === '팝업' ? '**exhibition_display/performance_display/festival_display/event_display는 모두 null**, **popup_display는 반드시 객체로 채워주세요!** ⭐ is_fnb 필드 필수!' :
  category === '축제' ? '**exhibition_display/performance_display/popup_display/event_display는 모두 null**, **festival_display는 반드시 객체로 채워주세요!**' :
  category === '행사' ? '**exhibition_display/performance_display/popup_display/festival_display는 모두 null**, **event_display는 반드시 객체로 채워주세요!**' :
  '카테고리에 맞는 display 필드를 채워주세요'
}

3. 정보가 부족하더라도 **빈 값(null, [], {})으로라도 필드를 포함**하세요!
4. ${category === '팝업' ? '⭐ **팝업 카테고리는 is_fnb 필드가 필수입니다!** F&B 팝업이면 signature_menu를 반드시 추출하세요!' : ''}`;
}

/**
 * Gemini API로 정보 추출
 */
export async function extractEventInfo(
  eventTitle: string,
  category: string,
  overview: string | null,
  searchResults: string
): Promise<AIExtractedInfo | null> {
  if (!model) {
    console.warn('[AI] Gemini not initialized. Skipping extraction.');
    return null;
  }

  const prompt = buildExtractionPrompt(eventTitle, category, overview, searchResults);

  try {
    console.log('[AI] Extracting info for:', eventTitle);

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const content = response.text();

    if (!content) {
      console.warn('[AI] No response content');
      return null;
    }

    // JSON 추출 (```json ... ``` 형식 처리)
    let jsonMatch = content.match(/```json\s*\n?([\s\S]*?)\n?```/);
    
    // 백틱 없이 JSON만 있는 경우
    if (!jsonMatch) {
      jsonMatch = content.match(/\{[\s\S]*\}/);
    }
    
    if (!jsonMatch) {
      console.warn('[AI] No JSON found in response:', content.slice(0, 500));
      // 혹시 ```json으로 시작했지만 끝 부분이 잘린 경우
      const partialMatch = content.match(/```json\s*\n?([\s\S]*)/);
      if (partialMatch) {
        console.log('[AI] Found partial JSON, attempting to parse...');
        jsonMatch = partialMatch;
      } else {
        return null;
      }
    }

    const jsonText = jsonMatch[1] || jsonMatch[0];
    
    // JSON 파싱 시도
    let extracted: AIExtractedInfo;
    try {
      extracted = JSON.parse(jsonText);
    } catch (parseError) {
      // JSON이 불완전한 경우 (중간에 잘린 경우) 복구 시도
      console.warn('[AI] JSON parse error, attempting recovery:', parseError);
      
      // 마지막 불완전한 항목 제거 후 재시도
      const fixedJson = jsonText.replace(/,\s*$/, '') + '}';
      try {
        extracted = JSON.parse(fixedJson);
      } catch {
        console.error('[AI] JSON recovery failed');
        return null;
      }
    }

    console.log('[AI] Extraction success:', {
      title: eventTitle,
      hasOpeningHours: !!extracted.opening_hours,
      hasPrice: extracted.price_min !== undefined,
      tagCount: extracted.derived_tags?.length || 0,
    });

    return postProcessExtractedInfo(extracted);
  } catch (error: any) {
    console.error('[AI] Extraction error:', {
      title: eventTitle,
      error: error.message,
    });
    return null;
  }
}

/**
 * Phase A: 향상된 정보 추출 (섹션별 분리 + 검증)
 */
export async function extractEventInfoEnhanced(
  eventTitle: string,
  category: string,
  overview: string | null,
  yearTokens: string,
  sections: {
    ticket: string[];
    official: string[];
    place: string[];
    blog: string[];
  }
): Promise<AIExtractedInfo | null> {
  if (!model) {
    console.warn('[AI] Gemini not initialized. Skipping extraction.');
    return null;
  }

  // sections가 모두 비어있으면 Google Search Grounding 사용
  const totalSectionItems = sections.ticket.length + sections.official.length + sections.place.length + sections.blog.length;
  const useGoogleSearch = totalSectionItems === 0;

  if (useGoogleSearch) {
    console.log('[AI] 🔍 No sections provided, using Google Search Grounding');
  }

  const prompt = buildExtractionPromptWithSections(
    eventTitle, 
    category, 
    overview, 
    yearTokens, 
    sections,
    useGoogleSearch // 🆕 Google Search 모드 전달
  );

  try {
    console.log('[AI] Enhanced extraction for:', eventTitle);
    console.log('[AI] 🔍 Prompt length:', prompt.length, 'chars');
    console.log('[AI] 🔍 Category:', category);
    console.log('[AI] 🔍 Overview length:', overview?.length || 0, 'chars');
    console.log('[AI] 🔍 Google Search mode:', useGoogleSearch);

    // Google Search Grounding 사용 시 다른 모델 설정
    let currentModel = model;
    if (useGoogleSearch) {
      const { GoogleGenerativeAI } = await import('@google/generative-ai');
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
      currentModel = genAI.getGenerativeModel({
        model: 'gemini-2.5-flash',
        tools: [{ googleSearch: {} } as any], // Google Search Grounding (타입 우회)
      });
      console.log('[AI] 🔍 Using Gemini 2.5 Flash with Google Search Grounding');
    }

    const result = await currentModel.generateContent(prompt);
    const response = await result.response;
    const content = response.text();
    
    console.log('[AI] 🔍 Response length:', content.length, 'chars');
    console.log('[AI] 🔍 Full AI Response:', content); // 🆕 전체 응답 로깅

    if (!content) {
      console.warn('[AI] No response content');
      return null;
    }

    // JSON 추출
    let jsonMatch = content.match(/```json\s*\n?([\s\S]*?)\n?```/);
    if (!jsonMatch) {
      jsonMatch = content.match(/\{[\s\S]*\}/);
    }
    
    if (!jsonMatch) {
      console.warn('[AI] No JSON found in response:', content.slice(0, 500));
      const partialMatch = content.match(/```json\s*\n?([\s\S]*)/);
      if (partialMatch) {
        console.log('[AI] Found partial JSON, attempting to parse...');
        jsonMatch = partialMatch;
      } else {
        return null;
      }
    }

    const jsonText = jsonMatch[1] || jsonMatch[0];
    console.log('[AI] 🔍 Extracted JSON:', jsonText); // 🆕 추출된 JSON 로깅
    
    // JSON 파싱
    let extracted: AIExtractedInfo;
    try {
      extracted = JSON.parse(jsonText);
    } catch (parseError) {
      console.warn('[AI] JSON parse error, attempting recovery:', parseError);
      const fixedJson = jsonText.replace(/,\s*$/, '') + '}';
      try {
        extracted = JSON.parse(fixedJson);
      } catch {
        console.error('[AI] JSON recovery failed');
        return null;
      }
    }

    console.log('[AI] Enhanced extraction success:', {
      title: eventTitle,
      category,
      hasStartDate: !!extracted.start_date,
      hasEndDate: !!extracted.end_date,
      hasVenue: !!extracted.venue,
      hasAddress: !!extracted.address,
      hasOpeningHours: !!extracted.opening_hours,
      hasPrice: extracted.price_min !== undefined,
      hasOfficialLink: !!extracted.external_links?.official,
      tagCount: extracted.derived_tags?.length || 0,
      // Phase 3+ 로그
      hasExhibitionDisplay: !!(extracted as any).exhibition_display,
      hasPerformanceDisplay: !!(extracted as any).performance_display,
      hasPopupDisplay: !!(extracted as any).popup_display,
      hasFestivalDisplay: !!(extracted as any).festival_display,
      hasEventDisplay: !!(extracted as any).event_display,
      // 팝업 F&B 세부 로그
      ...(category === '팝업' && {
        popup_is_fnb: !!(extracted as any).popup_display?.is_fnb,
        popup_signature_menu_count: (extracted as any).popup_display?.fnb_items?.signature_menu?.length || 0,
      }),
    });

    return postProcessExtractedInfo(extracted);
  } catch (error: any) {
    console.error('[AI] Enhanced extraction error:', {
      title: eventTitle,
      error: error.message,
    });
    return null;
  }
}

/**
 * URL 정제: HTML 태그에서 순수 URL만 추출
 */
function cleanUrl(url: string | undefined | null): string | null {
  if (!url) return null;
  
  // HTML 태그 제거: <a href="URL"> → URL
  const hrefMatch = url.match(/href=["']([^"']+)["']/);
  if (hrefMatch) {
    return hrefMatch[1];
  }
  
  // 이미 깨끗한 URL이면 그대로 반환
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url.trim();
  }
  
  return null;
}

/**
 * AI 추출 결과 후처리: URL 정제
 */
function postProcessExtractedInfo(extracted: AIExtractedInfo): AIExtractedInfo {
  if (extracted.external_links) {
    extracted.external_links = {
      official: cleanUrl(extracted.external_links.official) ?? undefined,
      ticket: cleanUrl(extracted.external_links.ticket) ?? undefined,
      reservation: cleanUrl(extracted.external_links.reservation) ?? undefined,
    };
  }
  
  if (extracted.reservation_link) {
    extracted.reservation_link = cleanUrl(extracted.reservation_link) ?? undefined;
  }
  
  return extracted;
}

// ============================================
// Admin Hot Discovery: 배치 처리 (비용 절감)
// ============================================

/**
 * Blog/Web 검색 결과에서 Seed 이벤트명 추출 (배치 처리)
 * 
 * @param items 블로그/웹 검색 결과 (최대 10개)
 * @returns 추출된 이벤트명 배열
 */
export async function extractEventSeeds(
  items: Array<{ title: string; description: string; link: string }>
): Promise<string[]> {
  if (!model) {
    console.warn('[AI] Gemini not initialized. Returning empty seeds.');
    return [];
  }

  // 블로그/웹 아이템을 텍스트로 변환
  const itemsText = items
    .map((item, idx) => `[${idx + 1}] 제목: ${item.title}\n설명: ${item.description}`)
    .join('\n\n');

  const prompt = `아래는 힙한 이벤트/팝업을 검색한 네이버 블로그/웹 결과입니다.

**목표**: 각 블로그 포스트에서 **구체적인 이벤트/팝업 이름**만 추출하세요.

**중요 규칙**:
1. "8곳 추천", "베이글 맛집 5곳" 같은 **리스트 포스팅은 무시**하세요 (개별 이벤트명이 아님)
2. 구체적인 **브랜드명 또는 이벤트명**만 추출하세요
3. 중복 제거하세요
4. 최대 20개까지만 추출하세요

**좋은 예시**:
- "노티드 팝업" → ["노티드"]
- "쿠키런 콜라보 카페" → ["쿠키런 콜라보"]
- "롯데월드몰 겨울축제" → ["롯데월드몰 겨울축제"]

**나쁜 예시** (제외해야 함):
- "2월에 갈 만한 팝업 8곳" → 리스트 포스팅, 무시
- "성수동 베이글 맛집 5곳" → 리스트 포스팅, 무시
- "이번주 전시 추천" → 너무 추상적, 무시

# 검색 결과
${itemsText}

**응답 형식**: JSON 배열만 반환하세요 (설명 불필요)

\`\`\`json
["이벤트명1", "이벤트명2", ...]
\`\`\``;

  try {
    console.log('[AI] [Seed] Extracting seeds from', items.length, 'items...');
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const content = response.text();

    if (!content) return [];

    let jsonMatch = content.match(/```json\s*\n?([\s\S]*?)\n?```/);
    if (!jsonMatch) {
      jsonMatch = content.match(/\[[\s\S]*?\]/);
    }

    if (!jsonMatch) {
      console.warn('[AI] [Seed] No JSON array found');
      return [];
    }

    const jsonText = jsonMatch[1] || jsonMatch[0];
    const seeds: string[] = JSON.parse(jsonText);

    console.log('[AI] [Seed] Extracted', seeds.length, 'seeds:', seeds.slice(0, 5));
    return Array.isArray(seeds) ? seeds : [];
  } catch (error: any) {
    console.error('[AI] [Seed] Extraction error:', error.message);
    return [];
  }
}

/**
 * Seed 이벤트 목록 정규화 및 중복 제거 (배치 처리)
 * 
 * @param seeds 추출된 이벤트명 배열 (중복 가능)
 * @returns 정규화된 고유 이벤트명 배열
 */
export async function normalizeAndDeduplicateEvents(seeds: string[]): Promise<string[]> {
  if (!model) {
    console.warn('[AI] Gemini not initialized. Returning original seeds.');
    return [...new Set(seeds)]; // 단순 중복 제거
  }

  const seedsText = seeds.map((s, idx) => `${idx + 1}. ${s}`).join('\n');

  const prompt = `아래는 자동으로 추출된 이벤트명 목록입니다. 중복과 오타를 정리해주세요.

**목표**:
1. 같은 이벤트의 다른 표현 → 하나로 통일 (예: "노티드 팝업", "노티드 팝업스토어" → "노티드 팝업")
2. 오타 수정 (예: "쿠키런킹덤" → "쿠키런 킹덤")
3. 너무 추상적이거나 일반적인 이름 제거 (예: "팝업스토어", "전시회")
4. 최대 30개까지만

# 이벤트 목록
${seedsText}

**응답 형식**: JSON 배열만 반환

\`\`\`json
["정리된 이벤트명1", "정리된 이벤트명2", ...]
\`\`\``;

  try {
    console.log('[AI] [Normalize] Normalizing', seeds.length, 'seeds...');
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const content = response.text();

    if (!content) return [...new Set(seeds)];

    let jsonMatch = content.match(/```json\s*\n?([\s\S]*?)\n?```/);
    if (!jsonMatch) {
      jsonMatch = content.match(/\[[\s\S]*?\]/);
    }

    if (!jsonMatch) {
      console.warn('[AI] [Normalize] No JSON array found');
      return [...new Set(seeds)];
    }

    const jsonText = jsonMatch[1] || jsonMatch[0];
    const normalized: string[] = JSON.parse(jsonText);

    console.log('[AI] [Normalize] Normalized to', normalized.length, 'unique events:', normalized.slice(0, 5));
    return Array.isArray(normalized) ? normalized : [...new Set(seeds)];
  } catch (error: any) {
    console.error('[AI] [Normalize] Error:', error.message);
    return [...new Set(seeds)]; // 실패 시 기본 중복 제거
  }
}

/**
 * Derived Tags만 추출 (네이버 검색 없이)
 * 기존 이벤트 정보만으로 태그 생성
 */
export async function extractDerivedTagsOnly(
  eventTitle: string,
  category: string,
  subCategory: string | null,
  overview: string | null
): Promise<string[]> {
  if (!model) {
    console.warn('[AI] Gemini not initialized. Returning empty tags.');
    return [];
  }

  const prompt = `이벤트 정보를 바탕으로 사용자에게 유용한 추천 태그를 생성해주세요.

# 이벤트 정보
- 제목: ${eventTitle}
- 카테고리: ${category} / ${subCategory || '없음'}
- 개요: ${overview || '없음'}

# 요구사항
- 사용자의 관심사/상황에 맞는 태그 5개 이내 추출
- 예: "데이트", "가족", "혼자", "힙한", "조용한", "전통적인", "실내", "야외", "사진맛집", "주말추천" 등
- 반드시 JSON 배열 형식으로만 응답

**응답 형식**:
\`\`\`json
["데이트", "힙한", "사진맛집"]
\`\`\``;

  try {
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const content = response.text();

    if (!content) return [];

    let jsonMatch = content.match(/```json\s*\n([\s\S]*?)\n```/);
    if (!jsonMatch) {
      jsonMatch = content.match(/\[[\s\S]*?\]/);
    }
    
    if (!jsonMatch) {
      console.warn('[AI] No JSON array found in tags response');
      return [];
    }

    const jsonText = jsonMatch[1] || jsonMatch[0];
    const tags: string[] = JSON.parse(jsonText);

    return Array.isArray(tags) ? tags.slice(0, 5) : [];
  } catch (error: any) {
    console.error('[AI] Tag extraction error:', error.message);
    return [];
  }
}

