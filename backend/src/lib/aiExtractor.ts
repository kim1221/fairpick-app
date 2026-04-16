/**
 * AI 기반 정보 추출기
 * 
 * Google Gemini API를 사용하여 비정형 텍스트에서 구조화된 정보 추출
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { logGeminiUsage } from './aiUsageLogger';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-pro'; // 안정적인 모델

let genAI: GoogleGenerativeAI | null = null;
let model: any = null;

if (GEMINI_API_KEY) {
  genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  model = genAI.getGenerativeModel({
    model: GEMINI_MODEL,
    generationConfig: {
      temperature: 0.05,
      maxOutputTokens: 8192,
      topP: 0.8,
      topK: 10,
      // @ts-ignore - thinkingConfig은 아직 타입 정의에 없지만 API에서 지원
      thinkingConfig: { thinkingBudget: 0 }, // thinking 비활성화 (비용 절감)
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

  // 외부 링크 (URL은 서버가 searchResults 인덱스로 resolve, AI는 index만 반환)
  external_links?: {
    // AI가 반환: searchResults 배열의 index (없으면 null)
    official_index?: number | null;
    ticket_index?: number | null;
    reservation_index?: number | null;
    // 서버가 resolve 후 채움 (AI는 이 필드를 직접 출력하지 않음)
    official?: string | null;
    ticket?: string | null;
    reservation?: string | null;
  };

  // AI가 반환: 필드별 근거 검색결과 index 배열 (서버가 sources로 resolve)
  source_indexes?: {
    [fieldName: string]: number[]; // searchResults 인덱스 배열
  };

  // 서버가 source_indexes resolve 후 채우는 출처 정보 (AI가 직접 생성하지 않음)
  sources?: {
    [fieldName: string]: {
      source: string;      // 출처 제공자 (예: "web", "blog", "place")
      evidence: string;    // 근거/인용문 (snippet에서 추출)
      reason?: string;     // AI 추론 이유
      url?: string;        // 네이버 검색결과 URL (searchResults에서 resolve됨)
      confidence: number;  // 신뢰도 (1-10)
    };
  };

  // 연령 제한
  age_restriction?: string;

  // 추천 태그
  derived_tags?: string[];

  // 기타 유용한 정보
  parking_available?: boolean;   // 🚗 주차 가능 여부
  parking_info?: string;          // 🅿️ 주차 상세 정보 (위치, 요금, 제한 등)
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
 * ⚠️ DEPRECATED: buildExtractionPrompt 함수는 더 이상 사용되지 않습니다.
 * buildExtractionPromptWithSections를 사용하세요.
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

**🚨 가장 중요한 원칙: 각 필드에 딱 맞는 값만 추출**
- ✅ **address**: "서울특별시 종로구 삼청로 30" (주소만!)
- ❌ **address**: "서울특별시 종로구 삼청로 30 국립현대미술관 서울" (장소명 포함 금지!)
- ✅ **venue**: "국립현대미술관 서울" (장소명만!)
- ❌ **venue**: "서울특별시 종로구 삼청로 30 국립현대미술관 서울" (주소 포함 금지!)
- ✅ **price_min**: 15000 (숫자만!)
- ❌ **price_min**: "15,000원" (문자열 금지!)
- **각 필드는 그 필드에 맞는 정확한 값만 포함해야 합니다**
- **절대로 다른 필드의 정보를 섞지 마세요**

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
   - **도로명 주소만** 정확히 추출 (시/도 → 구 → 동/로 → 번지)
   - ⚠️ **장소명(venue)은 절대 포함하지 마세요!**
   - 네이버 플레이스의 roadAddress를 최우선으로 사용
   - 건물명이 도로명 주소의 일부인 경우에만 포함 가능
   
   **✅ 좋은 예시**:
   - "경기도 용인시 수지구 포은대로 499"
   - "서울특별시 송파구 올림픽로 300"
   - "경기도 과천시 막계동 108"
   - "서울특별시 종로구 삼청로 30"
   
   **❌ 나쁜 예시**:
   - "서울특별시 종로구 삼청로 30 국립현대미술관 서울" (장소명 포함 금지!)
   - "경기도 과천시 막계동 108 서울랜드" (장소명 포함 금지!)
   - "과천시 막계동 108" (시/도 누락)
   - "서울 송파구" (구체적 주소 없음)
   - "롯데월드몰" (주소가 아닌 장소명)

4. **overview_raw**: 내부용 개요 (상세 정보) ⭐⭐⭐ **AI 특화 필드 추출용!**

   **📝 작성 원칙**:
   - 검색 결과에서 확인된 **사실 정보만** 종합
   - **5-7문장**으로 구성
   - 날짜, 시간, 장소, 출연진, 작가, 할인 정보 등 객관적 세부사항만 포함

   **✅ 좋은 예시**:
   - "2026년 2월 18일 롯데콘서트홀에서 제13회 실내악스케치 공연이 개최됩니다. 리움챔버오케스트라와 한국피아노협회가 주최하며 초등학생 이상 관람 가능합니다. 약 100분간의 러닝타임 동안 인터미션 10분이 포함되어 있습니다. 2026년 1월 28일 티켓이 오픈될 예정입니다."

5. **overview**: 사용자용 개요 (간결한 콘셉트 요약) ⭐⭐⭐ **사용자에게 노출!**

   **📝 작성 원칙**:
   - **목적**: "이 이벤트가 무엇을 하는지 / 어떤 주제인지 / 어떤 형식인지"만 설명
   - overview_raw의 핵심 **콘셉트만** 1-2문장으로 재정리

   **🚫 절대 금지 토큰 (SSOT 위반 - 다른 필드가 관리함)**:
   1. **날짜/시간**: "YYYY년", "X월", "X일", "~부터", "~까지", "약 X분", "X시간", "오전/오후" → start_date, end_date, opening_hours 필드에서 관리
   2. **가격**: "원", "무료", "유료", "₩", "X,XXX원" → price_min, price_max 필드에서 관리
   3. **주소**: 도로명주소, "구/동/로", "지번" → address 필드에서 관리
   4. **링크**: "http", "https", "www" → external_links 필드에서 관리

   **🚫 품질 금지 사항**:
   1. 새로운 정보 추가 (검색 결과 또는 overview_raw에 없는 내용)
   2. 주관적 수식어 (아름다운, 특별한, 매력적인, 감동적인, 웅장한, 화려한 등)
   3. 마케팅 톤 (초대합니다, 경험해보세요, 놓치지 마세요, 만나보세요 등)
   4. 정서적 표현 (일상의 소음을 잊고, 힐링, 감성, 설렘, 기대감 등)
   5. 미래 예측 (감동을 선사할 예정, 인기를 끌 것으로 예상 등)

   **✅ 허용 사항**:
   - 이벤트 주제/형식/콘셉트 설명
   - 주최/출연진/작가 등 핵심 인물
   - 장르/카테고리 설명
   - 대상/관람연령 (객관적 사실인 경우)

   **✅ 좋은 예시 (콘셉트만, 해요체)**:
   - **공연**: "리움챔버오케스트라와 한국피아노협회가 주최하는 실내악 공연이에요."

   - **전시**: "팀랩의 디지털 아트 전시로 관람객이 작품과 상호작용할 수 있어요."

   - **팝업**: "쿠키런 캐릭터를 활용한 인터랙티브 콜라보 팝업이에요. 포토존과 한정판 굿즈가 준비되어 있어요."

   **🎯 작성 가이드**:
   - overview_raw에 있는 **콘셉트만** 재정리
   - **반드시 해요체 사용**: "~이에요", "~해요", "~있어요", "~예요" (합니다/입니다 금지!)
   - 날짜/시간/가격/주소/링크는 **절대 포함 금지**

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

10. **derived_tags**: 추천 태그 ⭐⭐⭐ **매우 중요!**

    **🏷️ 태그 선정 원칙**:
    - **5~8개** 선정 (이벤트 성격에 따라 유연하게)
    - 사용자가 **"나에게 맞는 이벤트인가?"** 직관적으로 판단할 수 있어야 함
    - ⭐ **이 이벤트만의 고유한 특성**을 반드시 포함 — 다른 이벤트와 구별되는 태그

    **🎯 태그 카테고리 가이드**:

    **A. 동행 대상** (1개 필수):
    - 데이트, 커플, 가족, 친구, 혼자, 아이와함께, 단체관람, 부모님과

    **B. 분위기/감성** (1-2개):
    - 힙한, 조용한, 활기찬, 감성적인, 전통적인, 모던한, 고급스러운, 아늑한
    - 잔잔한, 강렬한, 신비로운, 유쾌한, 몽환적인, 따뜻한, 웅장한, 미니멀한, 이국적인

    **C. 경험/형태** (1-2개):
    - 사진맛집, 포토존, 체험형, 핸즈온, 몰입형, 인터랙티브, 힐링, 교육적인
    - 도슨트, 워크샵, 토크, 야경, 주말추천, 무료

    **D. ⭐ 이벤트 고유 키워드** (1-3개 — 가장 중요!):
    이 이벤트만의 특징을 나타내는 **자유 태그** — 장르·주제·소재·작가·브랜드 등 무엇이든 가능
    - 미술 장르: 수묵화, 사진전, 조각, 판화, 도예, 미디어아트, 팝아트, 인상주의, 추상화, 설치미술
    - 공연 장르: 클래식, 재즈, 국악, 발레, 연극, 오페라, 탱고, 현대무용, 오케스트라
    - 테마·소재: 자연, 빛, 우주, 바다, 꽃, 역사, 신화, 도시, 어린이, 여성, 환경
    - 감정·효과: 치유, 영감, 성찰, 위로, 몰입, 추억
    - 브랜드·작가명: 특정 유명 작가나 브랜드가 있으면 태그로 추가

    **❌ 나쁜 예시** (모든 이벤트에 똑같이 나오는 단조로운 태그):
    - ["데이트", "힙한", "사진맛집", "실내", "주말추천"] ← 어떤 전시든 동일한 조합
    - ["가족", "활기찬", "체험형", "야외", "주말추천"] ← 이벤트 고유성 없음

    **✅ 좋은 예시** (이벤트 특화):
    - 앤디워홀 회고전: ["데이트", "팝아트", "현대미술", "힙한", "사진맛집", "앤디워홀"]
    - 국악 정기공연: ["혼자", "국악", "전통음악", "조용한", "힐링", "한국문화"]
    - 빛 테마 미디어아트: ["데이트", "미디어아트", "빛", "몰입형", "인터랙티브", "사진맛집"]
    - 도예 체험 전시: ["친구", "도예", "핸즈온", "힐링", "소규모", "체험형"]
    - 어린이 과학 체험관: ["아이와함께", "과학", "교육적인", "체험형", "호기심", "실내"]
    - 발레 공연: ["데이트", "발레", "고급스러운", "감성적인", "클래식", "몰입형"]
    - 수묵화 전시: ["혼자", "수묵화", "전통적인", "조용한", "한국화", "힐링"]

11. **parking_available**: 🚗 건물 공식 주차장 유무 (boolean)
   - ⚠️ **중요: 건물/시설 자체의 주차장 유무만 체크!**
   - 건물 내 주차장이 있으면 true, 없으면 false
   - 정보가 없으면 null
   - 검색 결과에서 "주차", "parking", "주차장 운영", "건물 주차장" 등 키워드 확인
   - **근처 공영주차장만 있는 경우 false** (공식 주차장 아님)
   - 🆕 **AI가 자동으로 근처 공영주차장을 찾았다면 false로 설정됩니다**

12. **parking_info**: 🅿️ 주차 상세 정보 (string)
   - ⚠️ **중요: 단순 문자열로 반환!** 객체 금지!
   - **공식 주차장이 있을 때**: 위치, 요금, 제한 사항을 상세히 기재
   - **공식 주차장이 없을 때**: 근처 공영주차장 정보는 시스템이 자동 추가하므로 null 반환
   - 예시:
     - ✅ "건물 지하 주차장 이용 가능, 1시간 무료, 이후 10분당 1,000원"
     - ✅ "주차 17대 가능 (주차장 1, 2), 09:00-20:00 유료 운영"
     - ✅ null (공식 주차장 없음 → 시스템이 자동으로 근처 주차장 검색)
   - parking_available이 true일 때는 반드시 상세 정보 포함
   - ❌ 절대 금지: 객체 형식 (예: {"charge": true, "details": "..."})!
   - 💡 **시스템이 자동으로 근처 공영주차장을 검색하여 추가하므로, AI는 공식 주차장 정보만 추출하세요**

13. **public_transport_info**: 대중교통 정보
14. **accessibility_info**: 장애인 편의시설

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
       - "노티드와 산리오 캐릭터즈의 첫 공식 콜라보레이션으로, 시나모롤과 쿠로미 캐릭터가 적용된 한정판 디저트를 선보여요."
       - "무신사 스탠다드와 뉴발란스가 손잡은 특별 협업 팝업으로, 한정판 스니커즈와 익스클루시브 의류를 만나볼 수 있어요."
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

**🔥🔥🔥 중요: 절대 틀리면 안 되는 JSON 형식!**

⚠️ **특수 문자와 따옴표 처리**:
- 문자열 내부에 따옴표(")가 필요하면 **반드시 이스케이프** (\`\"\`)하세요
- 《, 》, ', " 등 **특수 문자**가 포함된 경우 주의!
- 문자열이 **반드시 닫혀야 함** (Unterminated string 금지!)
- 예시:
  - ✅ "미술은행 20주년 특별전 《돌아온 미래》"
  - ✅ "작가와의 대화 \"아트토크\""
  - ❌ "미술은행 20주년 특별전 《돌아온 미래 (따옴표 안 닫힘!)
  - ❌ "작가와의 대화 "아트토크"" (이스케이프 누락!)

✅ **올바른 형식**:
\`\`\`json
{
  "address": "서울특별시 송파구 올림픽로 300",
  "price_min": 15000,
  "overview": "디지털 아트 전시예요...",
  "sources": {
    "address": { "source": "...", "evidence": "...", "url": "...", "confidence": 9 },
    "price_min": { "source": "...", "evidence": "...", "url": "...", "confidence": 10 },
    "overview": { "source": "...", "evidence": "...", "url": "...", "confidence": 9 }
  }
}
\`\`\`

❌ **절대 금지! 이렇게 하면 안 됨!**:
\`\`\`json
{
  "address": {
    "value": "서울특별시 송파구 올림픽로 300",
    "source": "...",
    "evidence": "...",
    "url": "...",
    "confidence": 9
  }
}
\`\`\`
→ **필드 자체를 객체로 만들지 마세요! 필드는 값이고, sources는 별도입니다!**

**🔥🔥🔥 sources 필드 필수! (누락 시 거부됨)**
- 반드시 추출한 **모든 필드**에 대해 sources 객체에 출처 정보를 포함하세요
- **하나라도 빠지면 안 됩니다!** 필드를 추출했다면, 그 필드의 source도 반드시 포함하세요
- 각 출처는 다음 형식을 따르세요:
  - **source**: 출처명 (예: 인터파크 티켓, 네이버 플레이스, 공식 홈페이지, KOPIS API, 블로그)
  - **evidence**: ⭐ **필수!** 근거/인용 텍스트 (해당 정보를 찾은 원문 일부 또는 추론 근거)
    - **길이 제한: 100자 이내**로 간결하게 작성하세요!
    - JSON 안전성을 위해 따옴표(")는 작은따옴표(')로 대체하세요
    - **⚠️ URL이 없어도 evidence는 반드시 작성!** 추론했다면 그 이유를 명시!
    - 팩트 기반 예: "인터파크 티켓 페이지에 '성인 20,000원'이라고 명시됨"
    - 팩트 기반 예: "네이버 플레이스에서 '롯데월드몰 B1층'으로 확인"
    - 팩트 기반 예: "블로그 후기 3개에서 '오전 11시에 품절되었다'는 언급"
    - 추론 기반 예: "제목과 개요에서 '팀랩', '디지털 아트'가 반복 언급되어 [인터랙티브] [사진맛집] 태그 부여"
    - 추론 기반 예: "공연 제목에 '뮤지컬'이 명시되고 티켓 가격대가 6만원~15만원이므로 [데이트] [감성적인] 태그 부여"
  - **reason**: 🆕 **AI 추론 필드의 경우 필수!** (예: derived_tags, overview 등)
    - 왜 이렇게 판단했는지 명확한 이유 설명 (100자 이내)
    - 예: "제목과 개요에서 디지털 아트, SNS 인증샷이 강조되어 젊은 층 타겟으로 판단"
    - 예: "티켓 가격대와 공연 장르를 고려할 때 데이트 코스로 적합"
  - **url**: 출처 URL (있으면 반드시 포함! 검색 결과의 link를 그대로 사용)
    - ⚠️ **중요: URL은 무조건 하나만!** 여러 개를 쉼표로 연결하지 마세요!
    - 가장 신뢰도 높은 URL 하나만 선택하세요 (공식 사이트 > 티켓 사이트 > 블로그)
    - 검색 결과에 링크가 있으면 100% 포함하세요
    - ⛔ **Google Grounding URL 금지**: "vertexaisearch.cloud.google.com"으로 시작하는 URL은 절대 사용하지 마세요. 실제 최종 목적지 URL만 포함하세요 (예: interpark.com, naver.com 등)
    - 팩트 필드 (가격, 주소 등): URL 있으면 반드시 포함, 없으면 null
    - 추론 필드 (태그, 일부 overview): URL이 없어도 OK, 대신 reason을 상세히 작성
  - **confidence**: 1-10 (신뢰도, 공식 사이트=10, 티켓 사이트=9, 블로그=6-7, AI 추론=5-7)
- **반복: 추출한 필드 수 = sources 항목 수** (1:1 매칭!)
  - overview 추출 → sources.overview 필수
  - price_min 추출 → sources.price_min 필수
  - exhibition_display.artists 추출 → sources['exhibition_display.artists'] 필수
  - exhibition_display.facilities 추출 → sources['exhibition_display.facilities'] 필수
  - popup_display.fnb_items 추출 → sources['popup_display.fnb_items'] 필수
  - popup_display.parking 추출 → sources['popup_display.parking'] 필수
  - performance_display.cast 추출 → sources['performance_display.cast'] 필수
  - 🔥 **카테고리별 특화 정보(metadata.display.*)도 모두 sources에 포함**해야 합니다!

### 전시 카테고리 예시:
\`\`\`json
{
  "start_date": "2026-01-23",
  "end_date": "2026-02-22",
  "venue": "롯데월드몰",
  "address": "서울특별시 송파구 올림픽로 300",
  "overview": "디지털 아트의 선두주자 팀랩이 선보이는 인터랙티브 미디어아트 전시예요. 빛과 소리가 어우러진 몰입형 공간에서 관람객이 직접 작품의 일부가 되는 독특한 경험을 제공해요.",
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
  "external_links": { "official_index": 2, "ticket_index": 0, "reservation_index": null },
  "age_restriction": "전체관람가",
  "derived_tags": ["데이트", "미디어아트", "빛", "몰입형", "인터랙티브", "사진맛집"],
  "parking_available": false,
  "parking_info": null,
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
  "performance_display": null,
  "sources": {
    "venue": {
      "source": "네이버 플레이스",
      "evidence": "롯데월드몰",
      "url": "https://m.place.naver.com/place/12345",
      "confidence": 10
    },
    "address": {
      "source": "네이버 플레이스",
      "evidence": "서울특별시 송파구 올림픽로 300",
      "url": "https://m.place.naver.com/place/12345",
      "confidence": 10
    },
    "overview": {
      "source": "공식 홈페이지",
      "evidence": "teamLab Borderless is a world of artworks without boundaries...",
      "url": "https://www.teamlab.art/e/borderless/",
      "confidence": 9
    },
    "price_min": {
      "source": "인터파크 티켓",
      "evidence": "일반(만 13세~64세) 20,000원 / 청소년(만 7세~12세) 15,000원",
      "url": "https://tickets.interpark.com/goods/12345",
      "confidence": 10
    },
    "price_max": {
      "source": "인터파크 티켓",
      "evidence": "일반(만 13세~64세) 20,000원",
      "url": "https://tickets.interpark.com/goods/12345",
      "confidence": 10
    },
    "opening_hours": {
      "source": "네이버 플레이스",
      "evidence": "평일 10:00~19:00, 주말 10:00~20:00, 월요일 휴무",
      "url": "https://m.place.naver.com/place/12345",
      "confidence": 9
    },
    "derived_tags": {
      "source": "AI 추론",
      "evidence": "디지털 아트, SNS 인증샷 명소, 가족 단위 관람 → [인스타그램] [포토존] [가족] 태그 부여",
      "reason": "제목과 개요에서 디지털 아트와 인터랙티브가 강조되고, SNS 인증샷 명소로 언급되어 젊은 층과 가족 타겟으로 판단",
      "url": null,
      "confidence": 8
    },
    "parking_available": {
      "source": "네이버 지도",
      "evidence": "건물 주차장 없음, 도보 5분 거리 롯데월드몰 공영주차장 확인",
      "reason": "공식 주차장이 없지만 근처 롯데월드몰 공영주차장을 대체 주차 공간으로 제안",
      "url": "https://map.naver.com/v5/search/롯데월드몰%20주차장",
      "confidence": 8
    },
    "parking_info": {
      "source": "네이버 지도",
      "evidence": "롯데월드몰 지하 주차장 요금 정보: 10분당 1,000원",
      "reason": "건물에 주차장이 없어 가장 가까운 공영주차장 정보 제공",
      "url": "https://map.naver.com/v5/search/롯데월드몰%20주차장",
      "confidence": 8
    },
    "external_links.official": {
      "source": "구글 검색",
      "evidence": "teamLab Borderless 공식 사이트",
      "url": "https://www.teamlab.art/e/borderless/",
      "confidence": 10
    },
    "external_links.ticket": {
      "source": "인터파크 티켓",
      "evidence": "인터파크 예매 페이지",
      "url": "https://tickets.interpark.com/goods/12345",
      "confidence": 10
    },
    "exhibition_display.artists": {
      "source": "공식 홈페이지",
      "evidence": "Created by teamLab, an art collective...",
      "url": "https://www.teamlab.art/",
      "confidence": 10
    },
    "exhibition_display.genre": {
      "source": "공식 홈페이지",
      "evidence": "Digital Art, Interactive Media Art",
      "url": "https://www.teamlab.art/",
      "confidence": 10
    },
    "exhibition_display.duration_minutes": {
      "source": "블로그 후기",
      "evidence": "평균 관람 시간 90분 소요",
      "url": "https://blog.naver.com/example",
      "confidence": 7
    },
    "exhibition_display.facilities": {
      "source": "네이버 플레이스",
      "evidence": "카페, 굿즈샵, 포토존 운영",
      "url": "https://m.place.naver.com/place/12345",
      "confidence": 9
    },
    "parking_available": {
      "source": "네이버 플레이스",
      "evidence": "롯데월드몰 지하주차장 이용 가능",
      "url": "https://m.place.naver.com/place/12345",
      "confidence": 9
    },
    "parking_info": {
      "source": "네이버 플레이스",
      "evidence": "지하주차장 1시간 무료, 추가 10분당 1,000원",
      "url": "https://m.place.naver.com/place/12345",
      "confidence": 9
    }
  }
}
\`\`\`

### 공연 카테고리 예시:
\`\`\`json
{
  "start_date": "2026-03-01",
  "end_date": "2026-05-31",
  "venue": "샤롯데씨어터",
  "address": "서울특별시 송파구 올림픽로 240",
  "overview": "브로드웨이 원작의 국내 라이센스 공연이에요. 회차별로 다른 시간에 공연돼요.",
  "opening_hours": { 
    "notes": "화~금 19:30, 토 14:00/18:00, 일 15:00" 
  },
  "price_min": 60000,
  "price_max": 150000,
  "price_notes": "VIP석 150,000원, R석 120,000원, S석 90,000원, A석 60,000원",
  "reservation_required": true,
  "reservation_link": "https://tickets.interpark.com/...",
  "external_links": { "official_index": 2, "ticket_index": 0, "reservation_index": null },
  "age_restriction": "만 8세 이상",
  "derived_tags": ["데이트", "뮤지컬", "감성적인", "브로드웨이", "고급스러운", "공연관람"],
  "parking_available": true,
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
  },
  "sources": {
    "venue": {
      "source": "인터파크 티켓",
      "evidence": "샤롯데씨어터",
      "url": "https://tickets.interpark.com/goods/12345",
      "confidence": 10
    },
    "overview": {
      "source": "공식 홈페이지",
      "evidence": "브로드웨이 오리지널 프로덕션의 감동을 국내에서...",
      "url": "https://musical-example.com",
      "confidence": 9
    },
    "opening_hours": {
      "source": "인터파크 티켓",
      "evidence": "화~금 19:30, 토 14:00/18:00, 일 15:00",
      "url": "https://tickets.interpark.com/goods/12345",
      "confidence": 10
    },
    "price_min": {
      "source": "인터파크 티켓",
      "evidence": "A석 60,000원",
      "url": "https://tickets.interpark.com/goods/12345",
      "confidence": 10
    },
    "price_max": {
      "source": "인터파크 티켓",
      "evidence": "VIP석 150,000원",
      "url": "https://tickets.interpark.com/goods/12345",
      "confidence": 10
    },
    "external_links.ticket": {
      "source": "인터파크 티켓",
      "evidence": "예매 페이지",
      "url": "https://tickets.interpark.com/goods/12345",
      "confidence": 10
    },
    "derived_tags": {
      "source": "AI 추론",
      "evidence": "뮤지컬, 브로드웨이, 주연 배우 → [데이트] [감성적인] [뮤지컬] 태그 부여",
      "reason": "브로드웨이 뮤지컬이며 티켓 가격대가 6~15만원으로 데이트 코스에 적합",
      "url": null,
      "confidence": 8
    },
    "performance_display.cast": {
      "source": "인터파크 티켓",
      "evidence": "출연: 조승우, 홍광호, 김소현",
      "url": "https://tickets.interpark.com/goods/12345",
      "confidence": 10
    },
    "performance_display.genre": {
      "source": "인터파크 티켓",
      "evidence": "장르: 뮤지컬",
      "url": "https://tickets.interpark.com/goods/12345",
      "confidence": 10
    },
    "performance_display.intermission": {
      "source": "블로그 후기",
      "evidence": "1막 종료 후 15분 인터미션",
      "url": "https://blog.naver.com/example",
      "confidence": 8
    },
    "performance_display.discounts": {
      "source": "인터파크 티켓",
      "evidence": "조기예매 30% 할인, 학생 20%, 장애인 50%",
      "url": "https://tickets.interpark.com/goods/12345",
      "confidence": 10
    }
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
  "external_links": { "official_index": 2, "ticket_index": null, "reservation_index": null },
  "age_restriction": "전체관람가",
  "derived_tags": ["가족", "아이와함께", "K-POP", "야외", "활기찬", "체험형"],
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
  "popup_display": null,
  "sources": {
    "venue": {
      "source": "공식 홈페이지",
      "evidence": "평창 알펜시아 리조트",
      "url": "https://www.pyeongchang-festival.com",
      "confidence": 10
    },
    "overview": {
      "source": "공식 홈페이지",
      "evidence": "하얀 눈 속에서 펼쳐지는 겨울의 낭만...",
      "url": "https://www.pyeongchang-festival.com",
      "confidence": 10
    },
    "opening_hours": {
      "source": "네이버 지역 정보",
      "evidence": "평일 10:00~22:00, 주말 10:00~23:00",
      "url": "https://map.naver.com/...",
      "confidence": 9
    },
    "price_min": {
      "source": "공식 홈페이지",
      "evidence": "입장 무료 (일부 체험 프로그램 유료)",
      "url": "https://www.pyeongchang-festival.com",
      "confidence": 10
    },
    "derived_tags": {
      "source": "AI 추론",
      "evidence": "가족 축제, K-POP 공연, 체험 부스 → [가족] [활기찬] [체험형] 태그 부여",
      "reason": "가족 단위 관람객이 많고 체험 부스와 K-POP 공연이 있어 활기찬 분위기로 판단",
      "url": null,
      "confidence": 8
    },
    "festival_display.organizer": {
      "source": "공식 홈페이지",
      "evidence": "주최: 평창군청, 주관: 강원도 관광재단",
      "url": "https://www.pyeongchang-festival.com",
      "confidence": 10
    },
    "festival_display.program_highlights": {
      "source": "공식 홈페이지",
      "evidence": "주요 프로그램: 개막식 불꽃놀이, K-POP 콘서트...",
      "url": "https://www.pyeongchang-festival.com",
      "confidence": 10
    },
    "festival_display.food_and_booths": {
      "source": "블로그 후기",
      "evidence": "푸드트럭 20개, 체험 부스 15개 운영",
      "url": "https://blog.naver.com/example",
      "confidence": 7
    },
    "festival_display.scale_text": {
      "source": "뉴스 기사",
      "evidence": "지난해 50만 명이 방문한 전국 최대 겨울 축제",
      "url": "https://news.example.com",
      "confidence": 8
    },
    "festival_display.parking_tips": {
      "source": "공식 홈페이지",
      "evidence": "행사장 주차 제한, 셔틀버스 운영 (대관령역 출발)",
      "url": "https://www.pyeongchang-festival.com",
      "confidence": 10
    }
  }
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
  "derived_tags": ["혼자", "스타트업", "네트워킹", "교육적인", "커리어", "토크"],
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
  "popup_display": null,
  "sources": {
    "venue": {
      "source": "이벤트어스",
      "evidence": "코엑스 컨퍼런스룸",
      "url": "https://event-us.kr/example",
      "confidence": 10
    },
    "overview": {
      "source": "이벤트어스",
      "evidence": "AI 스타트업 창업을 꿈꾸는 분들을 위한 실전 워크샵...",
      "url": "https://event-us.kr/example",
      "confidence": 10
    },
    "opening_hours": {
      "source": "이벤트어스",
      "evidence": "2026년 3월 10일 14:00~18:00 (1회 진행)",
      "url": "https://event-us.kr/example",
      "confidence": 10
    },
    "price_min": {
      "source": "이벤트어스",
      "evidence": "사전등록 무료",
      "url": "https://event-us.kr/example",
      "confidence": 10
    },
    "price_max": {
      "source": "이벤트어스",
      "evidence": "현장등록 30,000원",
      "url": "https://event-us.kr/example",
      "confidence": 10
    },
    "derived_tags": {
      "source": "AI 추론",
      "evidence": "스타트업, 워크샵, 네트워킹 → [혼자] [교육적인] [네트워킹] 태그 부여",
      "reason": "스타트업 대상 행사로 1인 참가자가 많고 교육과 네트워킹이 주목적으로 판단",
      "url": null,
      "confidence": 8
    },
    "event_display.target_audience": {
      "source": "이벤트어스",
      "evidence": "대상: 대학생, 취준생, 예비 창업자",
      "url": "https://event-us.kr/example",
      "confidence": 10
    },
    "event_display.capacity": {
      "source": "이벤트어스",
      "evidence": "정원: 선착순 100명",
      "url": "https://event-us.kr/example",
      "confidence": 10
    },
    "event_display.registration": {
      "source": "이벤트어스",
      "evidence": "사전등록 필수, 마감 3월 8일",
      "url": "https://forms.gle/example",
      "confidence": 10
    }
  }
}
\`\`\`

### 🏪 팝업 카테고리 예시 (F&B):
\`\`\`json
{
  "start_date": "2026-02-01",
  "end_date": "2026-02-28",
  "venue": "롯데월드몰",
  "address": "서울특별시 송파구 올림픽로 300",
  "overview": "두쫀쿠 브랜드의 팝업 스토어예요. 쪽파 크림치즈 베이글 등의 메뉴와 포토존이 준비되어 있어요.",
  "opening_hours": { 
    "weekday": "11:00-20:00", 
    "weekend": "11:00-21:00"
  },
  "price_min": 5000,
  "price_max": 15000,
  "price_notes": "베이글 8,000원, 음료 5,000원~7,000원",
  "external_links": { "official": null, "ticket": null, "reservation": "https://booking.naver.com/..." },
  "age_restriction": "전체관람가",
  "derived_tags": ["친구", "베이글", "힙한", "사진맛집", "브런치", "한정기간"],
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
  },
  "sources": {
    "venue": {
      "source": "네이버 예약",
      "evidence": "롯데월드몰 B1층",
      "url": "https://booking.naver.com/booking/example",
      "confidence": 10
    },
    "overview": {
      "source": "블로그",
      "evidence": "두쫀쿠 팝업, 시그니처 쪽파 크림치즈 베이글...",
      "url": "https://blog.naver.com/example",
      "confidence": 8
    },
    "opening_hours": {
      "source": "네이버 예약",
      "evidence": "평일 11:00~20:00, 주말 11:00~21:00",
      "url": "https://booking.naver.com/booking/example",
      "confidence": 10
    },
    "price_min": {
      "source": "블로그",
      "evidence": "음료 5,000원부터",
      "url": "https://blog.naver.com/example",
      "confidence": 8
    },
    "price_max": {
      "source": "블로그",
      "evidence": "세트 메뉴 최대 15,000원",
      "url": "https://blog.naver.com/example",
      "confidence": 8
    },
    "derived_tags": {
      "source": "AI 추론",
      "evidence": "베이글, SNS 인증샷, 디저트 → [친구] [힙한] [사진맛집] [디저트] 태그 부여",
      "reason": "SNS 인증샷 필수 포토존과 시그니처 디저트 메뉴로 2030 친구 동반 방문에 적합",
      "url": null,
      "confidence": 8
    },
    "popup_display.type": {
      "source": "AI 추론",
      "evidence": "베이글/디저트 판매 → F&B 팝업으로 분류",
      "reason": "메뉴 정보와 시그니처 음식 판매로 F&B 팝업으로 분류",
      "url": null,
      "confidence": 9
    },
    "popup_display.brands": {
      "source": "블로그",
      "evidence": "두쫀쿠 팝업",
      "url": "https://blog.naver.com/example",
      "confidence": 9
    },
    "popup_display.fnb_items": {
      "source": "블로그 + 인스타그램",
      "evidence": "쪽파 크림치즈 베이글, 시그니처 쿠키, 평일 14시 품절",
      "url": "https://www.instagram.com/p/example",
      "confidence": 8
    },
    "popup_display.photo_zone": {
      "source": "블로그",
      "evidence": "매장 입구 왼쪽 대형 베이글 조형물 포토존",
      "url": "https://blog.naver.com/example",
      "confidence": 8
    },
    "popup_display.waiting_hint": {
      "source": "블로그 + 인스타그램 댓글",
      "evidence": "여러 후기에서 주말 오픈런 추천, 평일 오후 20-30분 대기 언급",
      "url": "https://blog.naver.com/example",
      "confidence": 7
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
  "derived_tags": ["친구", "산리오", "캐릭터", "힙한", "한정판", "사진맛집"],
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
  },
  "sources": {
    "venue": {
      "source": "공식 홈페이지",
      "evidence": "성수동 팝업스토어",
      "url": "https://notted.co.kr/popup",
      "confidence": 10
    },
    "overview": {
      "source": "공식 홈페이지",
      "evidence": "노티드 X 산리오 캐릭터즈 첫 공식 콜라보...",
      "url": "https://notted.co.kr/popup",
      "confidence": 10
    },
    "opening_hours": {
      "source": "공식 홈페이지",
      "evidence": "평일 11:00~20:00, 주말 11:00~21:00",
      "url": "https://notted.co.kr/popup",
      "confidence": 10
    },
    "price_min": {
      "source": "블로그",
      "evidence": "디저트 8,000원부터",
      "url": "https://blog.naver.com/example",
      "confidence": 8
    },
    "price_max": {
      "source": "블로그",
      "evidence": "한정판 굿즈 최대 35,000원",
      "url": "https://blog.naver.com/example",
      "confidence": 8
    },
    "derived_tags": {
      "source": "AI 추론",
      "evidence": "산리오 캐릭터, 콜라보, 한정판 → [친구] [힙한] [사진맛집] [한정판] [캐릭터] 태그 부여",
      "reason": "인기 캐릭터 콜라보 한정판 제품으로 젊은 층의 사진 인증과 굿즈 구매 목적 방문에 적합",
      "url": null,
      "confidence": 8
    },
    "popup_display.type": {
      "source": "AI 추론",
      "evidence": "노티드 X 산리오 협업 → 콜라보 팝업으로 분류",
      "reason": "F&B 브랜드와 캐릭터 IP의 협업 팝업으로 분류",
      "url": null,
      "confidence": 10
    },
    "popup_display.brands": {
      "source": "공식 홈페이지",
      "evidence": "노티드 X 산리오 캐릭터즈",
      "url": "https://notted.co.kr/popup",
      "confidence": 10
    },
    "popup_display.collab_description": {
      "source": "공식 홈페이지",
      "evidence": "노티드와 산리오 캐릭터즈의 첫 공식 콜라보레이션",
      "url": "https://notted.co.kr/popup",
      "confidence": 10
    },
    "popup_display.goods_items": {
      "source": "블로그",
      "evidence": "쿠로미 에코백, 시나모롤 키링, 한정판 포토카드 판매",
      "url": "https://blog.naver.com/example",
      "confidence": 8
    },
    "popup_display.photo_zone": {
      "source": "인스타그램",
      "evidence": "2층 입구에 쿠로미/시나모롤 대형 인형 포토존",
      "url": "https://www.instagram.com/p/example",
      "confidence": 9
    },
    "popup_display.waiting_hint": {
      "source": "블로그 후기",
      "evidence": "주말 낮 시간대 20분 대기",
      "url": "https://blog.naver.com/example",
      "confidence": 7
    }
  }
}
\`\`\`

**지금 반드시 카테고리에 맞는 특화 필드를 포함하고, 나머지는 null로 반환하세요!**

**🔥🔥🔥 중요: sources 필드를 반드시 포함하세요! 🔥🔥🔥**
- 추출한 **모든 필드**에 대해 sources 객체를 만들어야 합니다
- 각 필드의 출처, 근거, URL, 신뢰도를 포함하세요
- URL은 검색 결과에서 찾은 원본 링크를 그대로 사용하세요
- 예시를 참고하여 정확히 같은 형식으로 작성하세요!`;
}

/**
 * 카테고리별 Overview 가이드라인 생성
 *
 * 각 카테고리의 특성에 맞는 Overview 작성 전략을 반환합니다.
 */
function buildOverviewGuideline(category: string): string {
  const baseIntro = `5. **overview**: 사용자용 개요 (콘텐츠 큐레이터 역할, 사용자에게 노출) ⭐⭐⭐

   **🎨 너의 역할**:
   - 너는 **콘텐츠 큐레이터/에디터**다. 정보 나열이 아닌 **맥락 설명**이 목표다.
   - overview_raw의 **톤·세계관·분위기**를 유지하면서 **3-5문장**으로 재서술한다.
   - 사용자가 카드를 보고 "아, 이런 분위기구나"를 느끼고 클릭하게 만들어야 한다.
`;

  // 카테고리 정규화
  const normalizedCategory = category.toLowerCase().trim();

  let categoryStrategy = '';

  // 전시
  if (normalizedCategory.includes('exhibition') || normalizedCategory === '전시') {
    categoryStrategy = `
   **🖼️ 전시 전용 전략**:

   **목표**:
   1. **전시 제목의 의미** - 왜 이런 제목을 붙였는지, 무엇을 담고 있는지
   2. **전시 대상의 맥락** - 작가/유물/주제의 역사·문화적 배경
   3. **전시의 구성** - 어떤 방식으로 전시되는지 (공간 활용, 체험 요소 등)

   **문체**:
   - 서사형 문장 허용 (스토리텔링 가능)
   - "~전시예요"로만 끝내지 말 것 - 제목의 의미나 맥락을 풀어내기
   - 감정·의미 표현 허용 (단, 과장 금지)

   **포함 가능 요소**:
   - 작가의 세계관, 작품의 시대적·문화적 배경
   - 전시가 다루는 주제의 역사적 의미
   - 관람 방식의 특징 (도슨트, 인터랙티브, 체험 등)
   - 공간 구성의 특성 ("3층 규모", "야외 조각정원" 등은 가능)

   **예시**:
   - ❌ "현대미술 작가 OOO의 개인전입니다. 3층에서 진행됩니다."
   - ✅ "현대미술 작가 OOO이 20년간 천착해 온 '경계'라는 주제를 회화, 설치, 영상 등 다양한 매체로 풀어낸 전시예요. 관람객은 3층 규모의 공간을 따라 작가의 사유를 따라가며 경계의 의미를 재발견하게 돼요."
`;
  }
  // 공연 (performance, musical, theater)
  else if (
    normalizedCategory.includes('performance') ||
    normalizedCategory === '공연' ||
    normalizedCategory.includes('musical') ||
    normalizedCategory === '뮤지컬' ||
    normalizedCategory.includes('theater') ||
    normalizedCategory === '연극' ||
    normalizedCategory === 'concert' ||
    normalizedCategory === '콘서트'
  ) {
    categoryStrategy = `
   **🎭 공연 전용 전략**:

   **목표**:
   1. **장르와 분위기** - 어떤 결의 공연인지
   2. **관람 경험의 성격** - 웅장한/따뜻한/코믹한/경쾌한 등
   3. **공연의 특징** - 출연진, 음악적 특성, 연출 스타일

   **문체**:
   - 감정 표현 적극 허용 ("웅장한", "경쾌한", "따뜻한", "몰입감 있는")
   - 스토리 전체 요약 금지 (뮤지컬/연극의 줄거리를 다 설명하지 말 것)
   - 공연 분위기와 인상 중심

   **포함 가능 요소**:
   - 장르 (클래식, 재즈, 뮤지컬, 연극, 발레 등)
   - 출연진의 특징 (원로 배우, 젊은 연주자, 유명 배우 등)
   - 음악적/연출적 특성 (오케스트라 편성, 무대 디자인 등)
   - 작품의 원작이나 배경 (원작 소설, 역사적 사건 등)

   **절대 금지**:
   - 회차 정보 ("토요일 2회 공연" ❌)
   - 러닝타임 ("약 120분" ❌)
   - 인터미션 ("15분 휴식 포함" ❌)

   **예시**:
   - ❌ "클래식 음악 공연입니다. 토요일 오후 2시, 7시 2회 공연이며 약 100분 소요됩니다."
   - ✅ "리움챔버오케스트라가 선보이는 실내악 공연으로, 바로크부터 현대까지 아우르는 프로그램으로 구성돼요. 섬세한 앙상블과 웅장한 오케스트라 사운드를 동시에 경험할 수 있어요."
`;
  }
  // 축제
  else if (normalizedCategory.includes('festival') || normalizedCategory === '축제') {
    categoryStrategy = `
   **🎪 축제 전용 전략**:

   **목표**:
   1. **공간 전체의 분위기** - 어떤 느낌의 축제인지
   2. **즐기는 방식** - 어떤 사람들이 어떻게 즐기는지
   3. **규모와 지역성** - 대규모 축제인지, 지역 특색이 있는지

   **문체**:
   - "즐길 수 있어요", "체험할 수 있어요" 같은 직접 권유 허용
   - 프로그램 나열은 1-2개 핵심만 (전체 나열 금지)
   - 축제의 전체적인 느낌과 분위기 전달

   **포함 가능 요소**:
   - 축제의 콘셉트 (벚꽃, 음악, 푸드, 등불 등)
   - 대표 프로그램 1-2개 (핵심만)
   - 규모감 ("수십 개의 부스", "야외 무대 3곳", "강변 전역" 등은 가능)
   - 지역 특색 (해당 지역만의 전통, 명물 등)

   **절대 금지**:
   - 기간/요일 정보 ("3월 15일부터" ❌)
   - 부스 정확한 개수 ("부스 47개" ❌)
   - 입장료 ("무료 입장" ❌)

   **예시**:
   - ❌ "벚꽃 축제입니다. 3월 20일부터 4월 10일까지 진행되며 무료입니다."
   - ✅ "강변을 따라 펼쳐진 벚꽃길을 걸으며 봄을 만끽하는 지역 축제예요. 야간 조명으로 밤벚꽃을 감상할 수 있으며, 지역 먹거리 부스와 라이브 공연이 함께하는 활기찬 분위기가 특징이에요."
`;
  }
  // 팝업
  else if (normalizedCategory.includes('popup') || normalizedCategory === '팝업') {
    categoryStrategy = `
   **🏬 팝업 전용 전략**:

   **목표**:
   1. **콘셉트와 체험 포인트** - 무엇을 경험할 수 있는지
   2. **브랜드/IP 세계관** - 어떤 세계관을 구현했는지
   3. **특별함** - 왜 이 팝업이 특별하고 한정적인지

   **문체**:
   - 가볍고 캐주얼한 톤 허용
   - 과장 마케팅 문구는 절제 ("역대급", "최고의" 금지)
   - 체험과 경험 중심 설명

   **포함 가능 요소**:
   - IP/브랜드의 특징과 세계관
   - 포토존, 굿즈, F&B 등 핵심 콘텐츠
   - 팝업만의 한정 요소 (특별 메뉴, 한정 굿즈 등)
   - 공간 콘셉트와 디자인 특징

   **절대 금지**:
   - 운영 기간/시간 ("3월까지 운영" ❌)
   - 입장료/굿즈 가격 ("입장료 5천원" ❌)
   - 대기 시간 ("평균 1시간 대기" ❌)

   **예시**:
   - ❌ "인기 애니메이션 캐릭터 팝업스토어입니다. 3월까지 운영하며 입장료는 5천원입니다."
   - ✅ "인기 애니메이션 'OOO'의 세계관을 구현한 팝업 스토어로, 캐릭터들이 사는 마을을 재현한 포토존과 작중 등장하는 디저트를 맛볼 수 있는 F&B 공간이 마련되어 있어요. 팝업 한정 굿즈와 팬아트 전시도 함께 즐길 수 있어요."
`;
  }
  // 행사/세미나/강연
  else if (
    normalizedCategory.includes('event') ||
    normalizedCategory === '행사' ||
    normalizedCategory.includes('seminar') ||
    normalizedCategory === '세미나' ||
    normalizedCategory.includes('conference') ||
    normalizedCategory === '컨퍼런스' ||
    normalizedCategory === '강연' ||
    normalizedCategory === '포럼'
  ) {
    categoryStrategy = `
   **📋 행사/강연/포럼 전용 전략**:

   **목표**:
   1. **행사의 목적과 취지** - 어떤 목적의 자리인지
   2. **대상과 주제** - 누구를 위한 어떤 내용인지
   3. **행사의 성격** - 네트워킹/학습/토론/세미나 등

   **문체**:
   - 정보 나열체 금지 ("주제는 A이고 연사는 B입니다" ❌)
   - 취지와 의도 중심으로 설명
   - 전문성 있게, 하지만 딱딱하지 않게

   **포함 가능 요소**:
   - 주최/주관 단체와 그들의 배경
   - 핵심 아젠다와 논의 주제
   - 대상 (학생, 전문가, 일반인, 스타트업 등)
   - 행사 형식 (워크숍, 패널 토론, 강연 등)

   **절대 금지**:
   - 일시/장소 정보 ("3월 15일 서울대에서" ❌)
   - 참가비 ("참가비 무료" ❌)
   - 등록 방법 ("홈페이지에서 신청" ❌)
   - 정원/모집 인원 ("선착순 100명" ❌)

   **예시**:
   - ❌ "AI 기술에 대한 세미나입니다. 3월 15일 진행되며 참가비는 무료입니다."
   - ✅ "AI 기술이 산업 현장에 미치는 영향을 다루는 전문가 세미나로, 현직 개발자와 연구자들이 실제 적용 사례와 기술적 도전 과제를 공유해요. AI 분야에 관심 있는 학생과 실무자 모두에게 유익한 자리예요."
`;
  }
  // 기본 (카테고리 미지정 또는 기타)
  else {
    categoryStrategy = `
   **✅ 일반 이벤트 전략**:

   1. **이벤트의 성격** - 어떤 종류의 이벤트인지
   2. **참여 방식** - 어떻게 즐기거나 참여하는지
   3. **이벤트의 특징** - 무엇이 특별한지

   **문체**:
   - 기존 소개글의 톤·서사 구조 유지
   - "영혼"을 제거하지 말 것 (중복·과도한 감탄사만 줄임)
   - 분위기/세계관/체험 중 최소 1개는 전달

   **주의**:
   - 요약 모드 금지 ("OOO 이벤트입니다" 한 줄로 끝내지 말 것)
   - 첫 문장을 장르 정의로만 시작하지 말 것 (가능하면)
`;
  }

  // 공통 금지 사항 및 최종 체크
  const commonRules = `
   **❌ 절대 금지 (SSOT 위반 - 다른 필드가 관리함)**:
   1. **날짜/시간**: "YYYY년", "X월", "X일", "~부터", "~까지", "약 X분", "X시간", "오전/오후"
   2. **가격**: "원", "무료", "유료", "₩", "X,XXX원"
   3. **주소**: 도로명주소, "구/동/로", "지번"
   4. **링크**: "http", "https", "www"
   5. **새로운 사실 추가**: overview_raw나 검색 결과에 없는 내용 절대 ❌

   **❌ 과도한 마케팅 톤**:
   - "놓치지 마세요", "지금 바로 경험해보세요", "역대급", "최고의", "완전 대박" ❌

   **✅ 허용 사항**:
   - 감성 표현 (단, 과장 ❌): "동화 같은", "몰입감 있는", "특별한 경험", "따뜻한"
   - 분위기 전달: "차분한", "활기찬", "신비로운", "경쾌한"
   - 세계관 설명: "~를 따라가며", "~속에서", "~와 함께"
   - 주최/출연진/작가 등 핵심 인물
   - 대상/체험 방식 (객관적 사실)

   **🎯 최종 체크**:
   - 이 문장을 보고 이벤트 분위기가 떠오르는가?
   - **반드시 해요체 사용**: "~이에요", "~해요", "~있어요", "~예요", "~돼요" (합니다/입니다/됩니다 절대 금지!)
   - 정보 필드(날짜/가격/시간)를 대신 설명하고 있지 않은가?
   - 기존 소개글을 '죽이지 않고' 정리했는가?
   - 사용자가 이 카드를 보고 클릭하고 싶어질까?
`;

  return baseIntro + categoryStrategy + commonRules;
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
    ? `\n**Google Search를 사용하여 최신 정보를 검색하세요!** 네이버, 공식 홈페이지, 티켓 사이트 등을 참고하여 정확한 정보만 추출하세요.`
    : `${ticketSection}${officialSection}${placeSection}${blogSection}`;

  return `당신은 이벤트 정보 추출 전문가입니다. ${useGoogleSearch ? '웹 검색을 통해' : '주어진 정보에서'} 구조화된 데이터를 추출해주세요.

# 이벤트 정보
- 제목: ${eventTitle}
- 카테고리: ${category}
- 이벤트 연도: ${yearTokens}

# 기존 개요 (참고용)
${overview ? `\`\`\`
${overview}
\`\`\`

**📌 참고**: 위 개요는 이전에 생성된 것입니다. 새로운 검색 결과를 바탕으로 **overview_raw (상세)와 overview (간결)를 모두 새로 작성**하세요.` : '없음 (검색 결과를 바탕으로 작성)'}

**🔥 중요 작업 순서**:
1. **먼저 overview_raw 작성**: 검색 결과에서 확인된 사실 정보만 종합 (날짜, 시간, 출연진, 할인, 시설 등 객관적 세부사항만 포함)
2. **overview_raw를 참고해서 특화 필드 추출**:
   - 공연 → cast, genre, duration_minutes, intermission, discounts, crew 등
   - 전시 → artists, genre, facilities, docent_tour, special_programs 등
   - 축제 → organizer, program_highlights, food_and_booths, scale_text, parking_tips 등
   - 행사 → target_audience, capacity, registration 등
   - 팝업 → brands, is_fnb, fnb_items (F&B인 경우 시그니처 메뉴 필수!), goods_items, photo_zone, waiting_hint 등
3. **overview (사용자용) 작성**: overview_raw의 핵심 사실만 2-3문장으로 재정리 (주관적 수식어, 마케팅 톤, 정서적 표현 절대 금지)

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

**🚨 가장 중요한 원칙: 각 필드에 딱 맞는 값만 추출**
- ✅ **address**: "서울특별시 종로구 삼청로 30" (주소만!)
- ❌ **address**: "서울특별시 종로구 삼청로 30 국립현대미술관 서울" (장소명 포함 금지!)
- ✅ **venue**: "국립현대미술관 서울" (장소명만!)
- ❌ **venue**: "서울특별시 종로구 삼청로 30 국립현대미술관 서울" (주소 포함 금지!)
- ✅ **price_min**: 15000 (숫자만!)
- ❌ **price_min**: "15,000원" (문자열 금지!)
- **각 필드는 그 필드에 맞는 정확한 값만 포함해야 합니다**
- **절대로 다른 필드의 정보를 섞지 마세요**

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
   - ⚠️ **장소명만** 추출 (주소는 포함하지 마세요)
   - 장소 정보 섹션의 place_name 또는 title 사용
   - 예: "롯데월드몰", "인사동 갤러리", "잠실 롯데타워", "국립현대미술관 서울"

3. **address**: 주소 (도로명주소 우선)
   - ⚠️ **주소만** 추출 (장소명은 포함하지 마세요)
   - 장소 정보 섹션의 roadAddress 또는 address 사용
   - 예시:
     - ✅ 올바름: "서울특별시 종로구 삼청로 30"
     - ❌ 잘못됨: "서울특별시 종로구 삼청로 30 국립현대미술관 서울" (장소명 포함 금지!)
   - 건물명은 제외하고 도로명 주소만 추출

4. **overview_raw**: 내부용 개요 (상세 정보, AI 특화 필드 추출용)
   - 검색 결과에서 확인된 **사실 정보만** 5-7문장으로 종합
   - 날짜, 시간, 출연진, 할인, 시설 등 객관적 정보만 포함
   - **금지**: 검색 결과에 없는 정보 추가, 주관적 평가("깊은 감동", "특별한"), 미래 예측("~할 예정")
   - 예: "2026년 2월 18일 롯데콘서트홀에서 제13회 실내악스케치 공연이 개최됩니다. 리움챔버오케스트라와 한국피아노협회가 주최하며 초등학생 이상 관람 가능합니다. 약 100분간의 러닝타임 동안 인터미션 10분이 포함되어 있습니다."

${buildOverviewGuideline(category)}

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

8. **external_links**: 외부 링크 ⭐⭐⭐ **매우 중요! 반드시 index만 사용!**

   🚫 **절대 금지: URL 문자열(http://, https://) 직접 출력!**
   - ❌ \`"official": "https://www.example.com"\` → 절대 안됨!
   - ❌ URL을 직접 생성하거나 추측하지 말 것!

   ✅ **반드시 검색결과 index 번호만 사용하세요:**
   - 위 검색 결과 목록의 \`[N]\` 번호가 index입니다
   - \`"official_index": N\` — 공식/상세 페이지가 있는 검색결과 index
   - \`"ticket_index": N\` — 예매/티켓 링크가 있는 검색결과 index (없으면 null)
   - \`"reservation_index": N\` — 예약 링크가 있는 검색결과 index (없으면 null)
   - 해당하는 검색결과가 없으면 반드시 **null**로 반환

   **판단 기준:**
   - 🎫 티켓 섹션 결과 → \`ticket_index\`로 지정
   - 🏛️ 공식 섹션 + \`/view\`, \`/detail\`, \`?id=\` 패턴 URL → \`official_index\`로 지정
   - 📍 장소(place) 결과 → \`official_index\` 후보 (상세 섹션 없을 때)

9. **age_restriction**: 연령 제한
10. **derived_tags**: 추천 태그 (5~8개)
   - **동행 대상** 1개 필수 (데이트/가족/친구/혼자/아이와함께 등)
   - **분위기** 1-2개 (힙한/감성적인/조용한/활기찬/몽환적인/웅장한 등)
   - **경험** 1-2개 (사진맛집/체험형/힐링/몰입형/인터랙티브/도슨트 등)
   - ⭐ **이벤트 고유 키워드** 1-3개 필수 — 장르·주제·소재·작가 등 이 이벤트만의 특징
     예: 수묵화, 미디어아트, 팝아트, 클래식, 발레, 국악, 도예, 빛, 자연, 역사, 치유
   - 나쁜 예: ["데이트", "힙한", "사진맛집", "실내", "주말추천"] ← 모든 이벤트에 동일
   - 좋은 예: ["데이트", "미디어아트", "빛", "몰입형", "인터랙티브", "사진맛집"]
11. **parking_info, public_transport_info, accessibility_info**

---

**응답 형식**: 반드시 아래 JSON 형식으로만 응답하세요.

⚠️ **특수 문자와 따옴표 처리**:
- 문자열 내부에 따옴표(")가 필요하면 **반드시 이스케이프** (\`\"\`)하세요
- 《, 》, ', " 등 **특수 문자**가 포함된 경우 주의!
- 문자열이 **반드시 닫혀야 함** (Unterminated string 금지!)
- 예시:
  - ✅ "미술은행 20주년 특별전 《돌아온 미래》"
  - ✅ "작가와의 대화 \"아트토크\""
  - ❌ "미술은행 20주년 특별전 《돌아온 미래 (따옴표 안 닫힘!)

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
  "external_links": { "official_index": 2, "ticket_index": null, "reservation_index": null },
  "age_restriction": "전체관람가",
  "derived_tags": ["데이트", "미디어아트", "빛", "몰입형", "인터랙티브", "사진맛집"],
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
  "overview": "브로드웨이 원작 뮤지컬 공연이에요. 조승우, 홍광호, 김소현이 출연하며 만 8세 이상 관람 가능해요.",
  "opening_hours": { "notes": "화~금 19:30, 토 14:00/18:00, 일 15:00" },
  "price_min": 60000,
  "price_max": 150000,
  "external_links": { "official_index": 2, "ticket_index": 0, "reservation_index": null },
  "age_restriction": "만 8세 이상",
  "derived_tags": ["데이트", "뮤지컬", "감성적인", "브로드웨이", "고급스러운", "공연관람"],
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
### 🏪 팝업 카테고리 응답 형식 (F&B 강화):
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
  "external_links": { "official_index": 2, "ticket_index": null, "reservation_index": null },
  "age_restriction": "전체관람가",
  "derived_tags": ["친구", "베이글", "힙한", "사진맛집", "브런치", "한정기간"],
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

**팝업 추출 가이드**:
1. **type 판별**: 
   - "디저트", "카페", "베이커리", "음식점" 키워드 → type: "fnb"
   - "콜라보", "협업", "X", "×" 키워드 + 브랜드 2개 이상 → type: "collab"
   - 그 외 → type: "general"
2. **fnb_items (F&B 팝업만)**: 
   - **signature_menu**: 블로그에서 가장 많이 언급된 메뉴 (필수!)
   - **soldout_time_avg**: "품절", "조기 소진" 키워드에서 시간 추출 (필수!)
   - **purchase_limit**: "1인 N개", "구매 제한" 키워드 확인 (필수!)
3. **collab_description (콜라보 팝업만)**: **"브랜드 A와 브랜드 B의 협업"을 명확히 강조**, 콜라보 배경, 한정 아이템 언급 (예: "노티드와 산리오 캐릭터즈의 첫 공식 콜라보레이션으로, 시나모롤 테마 디저트 제공")
4. **photo_zone_desc**: 포토존의 특징과 **정확한 위치**를 함께 추출 (예: "대형 곰인형 포토존 (2층 입구)")
5. **waiting_hint**: **level과 text 모두 추출!** "웨이팅", "대기", "줄서기", "오픈런", "평일", "주말", "시간" 키워드 확인 후 구체적인 시간대/요일 정보를 text에 포함
` : category === '축제' ? `
### 🎪 축제 카테고리 응답 형식:
\`\`\`json
{
  "start_date": "2026-03-15",
  "end_date": "2026-03-20",
  "venue": "여의도 한강공원",
  "address": "서울특별시 영등포구 여의동로 330",
  "overview_raw": "2026년 3월 15일부터 3월 20일까지 여의도 한강공원에서 벚꽃축제가 열립니다. 서울시 관광재단 주최로 개막식 불꽃놀이, K-POP 공연, LED 등불 전시가 진행됩니다. 푸드트럭 20개, 체험 부스 10개가 운영되며, 작년 50만 명이 방문했습니다. 행사장 주차는 불가능하며 인근 공영주차장 이용을 권장합니다. 입장은 무료입니다.",
  "overview": "여의도 한강공원에서 열리는 벚꽃 축제예요. 개막식 불꽃놀이, K-POP 공연, LED 등불 전시가 진행되며 푸드트럭과 체험 부스도 즐길 수 있어요.",
  "opening_hours": { "weekday": "10:00-22:00", "weekend": "10:00-23:00" },
  "price_min": 0,
  "price_max": 0,
  "external_links": { "official_index": 2, "ticket_index": null, "reservation_index": null },
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
  "event_display": null,
  "source_indexes": {
    "start_date": [2],
    "price_min": [3],
    "festival_display.organizer": [0]
  }
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
  "overview": "스타트업 채용 박람회로, 대학생과 취준생을 대상으로 20개 기업이 참여해요. 사전 등록이 필요하며 현장 등록은 불가해요.",
  "opening_hours": { "weekday": "14:00-18:00" },
  "price_min": 0,
  "price_max": 0,
  "external_links": { "official_index": 2, "ticket_index": null, "reservation_index": 4 },
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
      "url_index": 4,
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
  "overview": "어린이들을 위한 가족 뮤지컬로, 고전 동화를 현대적으로 재해석한 작품이에요.",
  "opening_hours": { "weekday": "10:00-18:00", "weekend": "10:00-20:00", "closed": "월요일" },
  "price_min": 0,
  "price_max": 0,
  "external_links": { "official_index": 2, "ticket_index": 0, "reservation_index": null },
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
  category === '팝업' ? '**exhibition_display/performance_display/festival_display/event_display는 모두 null**, **popup_display는 반드시 객체로 채워주세요!** is_fnb 필드 필수!' :
  category === '축제' ? '**exhibition_display/performance_display/popup_display/event_display는 모두 null**, **festival_display는 반드시 객체로 채워주세요!**' :
  category === '행사' ? '**exhibition_display/performance_display/popup_display/festival_display는 모두 null**, **event_display는 반드시 객체로 채워주세요!**' :
  '카테고리에 맞는 display 필드를 채워주세요'
}

3. 정보가 부족하더라도 **빈 값(null, [], {})으로라도 필드를 포함**하세요!
4. ${category === '팝업' ? '**팝업 카테고리는 is_fnb 필드가 필수입니다!** F&B 팝업이면 signature_menu를 반드시 추출하세요!' : ''}

5. 🔥🔥🔥 **출처 index 필수 작성! (매우 중요!)** 🔥🔥🔥
   - **source_indexes** 객체에 각 필드의 근거가 된 검색결과 index 배열을 명시하세요
   - URL 문자열 절대 금지! 오직 검색결과 [N] 번호만 사용!
   - **필수 포함 필드**: start_date, end_date, venue, address, price_min, price_max, opening_hours 등
   - 예: "source_indexes": { "start_date": [0, 2], "price_min": [0], "venue": [3] }
   - 근거 검색결과가 없으면 빈 배열 [] 또는 해당 키 생략`;
}

// ⚠️ DEPRECATED: extractEventInfo 함수는 더 이상 사용되지 않습니다.
// extractEventInfoEnhanced를 사용하세요.

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
    logGeminiUsage(response, GEMINI_MODEL, 'extraction');
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
      console.warn('[AI] JSON parse error, attempting recovery:', parseError);
      let fixedJson = jsonText.replace(/,(\s*[}\]])/g, '$1');
      fixedJson = fixedJson.replace(
        /("(?:[^"\\]|\\.)+")\s*:\s*("(?:[^"\\]|\\.)*")(?:\s*,\s*"(?:[^"\\]|\\.)*"(?!\s*:))+/g,
        (match: string, key: string) => {
          const keyStr = key.slice(1, -1);
          const allStrings: string[] = [];
          const strRe = /"((?:[^"\\]|\\.)*)"/g;
          strRe.lastIndex = match.indexOf(':') + 1;
          let m: RegExpExecArray | null;
          while ((m = strRe.exec(match)) !== null) {
            allStrings.push(m[1]);
          }
          return `"${keyStr}": "${allStrings.join(' ')}"`;
        }
      );
      fixedJson = fixedJson.replace(/,\s*$/, '') + '}';
      try {
        extracted = JSON.parse(fixedJson);
        console.log('[AI] JSON recovery succeeded');
      } catch {
        console.error('[AI] JSON recovery failed');
        return null;
      }
    }

    extracted = unwrapSourcedFields(extracted) as AIExtractedInfo;

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
  },
  address?: string,  // 🆕 주소 추가 (주차장 검색용)
  venue?: string     // 🆕 장소명 추가 (주차장 검색용)
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
        tools: [{ googleSearch: {} } as any],
        generationConfig: {
          temperature: 0.05,
          // @ts-ignore
          thinkingConfig: { thinkingBudget: 0 },
        } as any,
      });
      console.log('[AI] 🔍 Using Gemini 2.5 Flash with Google Search Grounding');
    }

    const result = await currentModel.generateContent(prompt);
    const response = await result.response;
    // useGoogleSearch=false이면 실제 grounding 없음 → 'extraction'으로 기록 (grounding query fee 과계산 방지)
    logGeminiUsage(response, 'gemini-2.5-flash', useGoogleSearch ? 'grounding' : 'extraction', {
      groundingQueries: useGoogleSearch ? 1 : 0,
    });
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
      
      // 1단계: 표준 trailing comma 제거 (배열/객체 내부 포함)
      let fixedJson = jsonText.replace(/,(\s*[}\]])/g, '$1');
      
      // 2단계: Gemini가 "evidence": "val1", "val2", "val3" 처럼 다중 문자열을 value로 반환할 때 하나로 합침
      //         "key": "val1", "val2" (where "val2" is NOT followed by :) → "key": "val1 val2"
      fixedJson = fixedJson.replace(
        /("(?:[^"\\]|\\.)+")\s*:\s*("(?:[^"\\]|\\.)*")(?:\s*,\s*"(?:[^"\\]|\\.)*"(?!\s*:))+/g,
        (match: string, key: string) => {
          const keyStr = key.slice(1, -1);
          const allStrings: string[] = [];
          const strRe = /"((?:[^"\\]|\\.)*)"/g;
          strRe.lastIndex = match.indexOf(':') + 1;
          let m: RegExpExecArray | null;
          while ((m = strRe.exec(match)) !== null) {
            allStrings.push(m[1]);
          }
          return `"${keyStr}": "${allStrings.join(' ')}"`;
        }
      );
      
      // 3단계: 맨 끝 trailing comma + 닫는 괄호 누락 보정
      fixedJson = fixedJson.replace(/,\s*$/, '');
      
      // 4단계: 닫는 괄호 균형 맞추기
      const openBraces = (fixedJson.match(/{/g) || []).length;
      const closeBraces = (fixedJson.match(/}/g) || []).length;
      if (openBraces > closeBraces) {
        fixedJson += '}'.repeat(openBraces - closeBraces);
        console.log('[AI] Added missing closing braces:', openBraces - closeBraces);
      }
      
      // 5단계: 닫는 대괄호 균형 맞추기
      const openBrackets = (fixedJson.match(/\[/g) || []).length;
      const closeBrackets = (fixedJson.match(/]/g) || []).length;
      if (openBrackets > closeBrackets) {
        fixedJson += ']'.repeat(openBrackets - closeBrackets);
        console.log('[AI] Added missing closing brackets:', openBrackets - closeBrackets);
      }
      
      // 6단계: 따옴표가 제대로 닫히지 않은 문자열 수정
      // 전체 JSON에서 닫히지 않은 따옴표 찾기
      let inString = false;
      let escaped = false;
      let lastUnterminatedStringStart = -1;
      
      for (let i = 0; i < fixedJson.length; i++) {
        const char = fixedJson[i];
        
        if (escaped) {
          escaped = false;
          continue;
        }
        
        if (char === '\\') {
          escaped = true;
          continue;
        }
        
        if (char === '"') {
          if (inString) {
            inString = false;
            lastUnterminatedStringStart = -1;
          } else {
            inString = true;
            lastUnterminatedStringStart = i;
          }
        }
      }
      
      // 문자열이 닫히지 않았으면 닫아줌
      if (inString && lastUnterminatedStringStart >= 0) {
        // 마지막 따옴표 이후 줄바꿈이나 쉼표가 있으면 그 전에 닫아줌
        const remaining = fixedJson.slice(lastUnterminatedStringStart + 1);
        const breakPos = remaining.search(/[\n,}]/);
        
        if (breakPos >= 0) {
          const insertPos = lastUnterminatedStringStart + 1 + breakPos;
          fixedJson = fixedJson.slice(0, insertPos) + '"' + fixedJson.slice(insertPos);
          console.log('[AI] Added missing closing quote at position', insertPos);
        } else {
          // 끝까지 닫히지 않았으면 맨 끝에 추가
          fixedJson += '"';
          console.log('[AI] Added missing closing quote at end');
        }
      }
      
      try {
        extracted = JSON.parse(fixedJson);
        console.log('[AI] JSON recovery succeeded');
      } catch (recoveryError) {
        console.error('[AI] JSON recovery failed:', recoveryError);
        console.error('[AI] Failed JSON (first 500 chars):', fixedJson.slice(0, 500));
        return null;
      }
    }

    // Gemini가 모든 필드를 { value, source, evidence, url, confidence } 객체로 감싸서 반환하는 경우 언래핑
    extracted = unwrapSourcedFields(extracted) as AIExtractedInfo;

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

    return postProcessExtractedInfo(extracted, address, venue);
  } catch (error: any) {
    console.error('[AI] Enhanced extraction error:', {
      title: eventTitle,
      error: error.message,
    });
    return null;
  }
}

/**
 * unknown 타입에서 URL 문자열을 안전하게 추출한다.
 *
 * Gemini가 { url, link, href, ... } 형태의 object 또는 array를 반환할 때를 처리한다.
 * - string  → 그대로 반환
 * - object  → url / link / href / value 키에서 첫 번째 string 추출
 * - array   → 첫 번째 요소를 재귀 처리
 * - 그 외   → null
 */
/**
 * Gemini가 모든 필드를 { value, source, evidence, url, confidence } 객체로 감싸서 반환할 때 언래핑.
 * 재귀적으로 처리하여 중첩 객체도 처리.
 */
function unwrapSourcedFields(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(unwrapSourcedFields);
  if (typeof obj !== 'object') return obj;

  const record = obj as Record<string, unknown>;

  // { value: X, source: ..., evidence: ..., confidence: ... } 패턴이면 value만 추출
  const hasValue = 'value' in record;
  const hasSourceInfo = 'source' in record || 'evidence' in record || 'confidence' in record;
  if (hasValue && hasSourceInfo && Object.keys(record).length <= 6) {
    console.log('[AI] 🔄 Unwrapping sourced field (value extracted)');
    return unwrapSourcedFields(record['value']);
  }

  // 🆕 { source, evidence, confidence, url } 패턴 (value 없음) → evidence를 값으로 사용
  // AI가 실수로 source 정보만 반환했을 때 복구
  if (!hasValue && hasSourceInfo && 'evidence' in record) {
    const keys = Object.keys(record);
    const isSourceOnlyObject = keys.every(k => ['source', 'evidence', 'confidence', 'url', 'reason'].includes(k));
    if (isSourceOnlyObject) {
      console.warn('[AI] 🔄 Unwrapping source-only object, using evidence as value:', JSON.stringify(record).slice(0, 100));
      return record['evidence'];
    }
  }

  // 일반 객체: 각 필드를 재귀 처리
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    result[key] = unwrapSourcedFields(value);
  }
  return result;
}

function asUrlString(val: unknown): string | null {
  if (val == null) return null;
  if (typeof val === 'string') return val;
  if (Array.isArray(val)) return asUrlString(val[0]);
  if (typeof val === 'object') {
    const obj = val as Record<string, unknown>;
    for (const key of ['url', 'link', 'href', 'value', 'src']) {
      if (typeof obj[key] === 'string') return obj[key] as string;
    }
    console.warn('[AI] asUrlString: object without url/link/href key:', JSON.stringify(obj).slice(0, 120));
  }
  return null;
}

/**
 * unknown 타입에서 일반 텍스트 문자열을 안전하게 추출한다.
 *
 * - string / number / boolean → String() 변환
 * - object / array            → null (텍스트로 쓸 수 없는 구조는 무시)
 */
function asString(val: unknown): string | null {
  if (val == null) return null;
  if (typeof val === 'string') return val;
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  if (typeof val !== 'string') {
    console.warn('[AI] asString: expected string but got', typeof val, '–', JSON.stringify(val).slice(0, 120));
  }
  return null;
}

/**
 * 숫자 안전 추출: Gemini가 object/string으로 반환해도 숫자로 변환
 */
function asNumber(val: unknown): number | null {
  if (val == null) return null;
  if (typeof val === 'number') return isNaN(val) ? null : val;
  if (typeof val === 'string') {
    const n = parseFloat(val.replace(/[^\d.]/g, ''));
    return isNaN(n) ? null : n;
  }
  if (typeof val === 'object') {
    console.warn('[AI] asNumber: expected number but got object –', JSON.stringify(val).slice(0, 120));
  }
  return null;
}

/**
 * URL 정제: HTML 태그에서 순수 URL만 추출
 *
 * url 파라미터는 unknown을 받아 asUrlString으로 먼저 문자열화한다.
 * (Gemini가 object를 반환해도 안전하게 처리)
 */
function cleanUrl(url: unknown): string | null {
  const str = asUrlString(url);
  if (!str || typeof str !== 'string') return null;

  // HTML 태그 제거: <a href="URL"> → URL
  const hrefMatch = str.match(/href=["']([^"']+)["']/);
  if (hrefMatch) {
    return hrefMatch[1];
  }

  // 이미 깨끗한 URL이면 그대로 반환
  if (str.startsWith('http://') || str.startsWith('https://')) {
    return str.trim();
  }

  return null;
}

/**
 * AI 추출 결과 후처리: URL 정제 + 주차장 정보 보강
 */
async function postProcessExtractedInfo(
  extracted: AIExtractedInfo,
  address?: string,
  venue?: string
): Promise<AIExtractedInfo> {
  // price_min/price_max: 숫자여야 함 (Gemini가 object/string으로 반환할 때 방어)
  if (extracted.price_min !== undefined && extracted.price_min !== null) {
    const n = asNumber(extracted.price_min as unknown);
    if (n === null) console.warn('[AI] price_min is not a number, dropping:', JSON.stringify(extracted.price_min).slice(0, 80));
    extracted.price_min = n ?? undefined;
  }
  if (extracted.price_max !== undefined && extracted.price_max !== null) {
    const n = asNumber(extracted.price_max as unknown);
    if (n === null) console.warn('[AI] price_max is not a number, dropping:', JSON.stringify(extracted.price_max).slice(0, 80));
    extracted.price_max = n ?? undefined;
  }

  // URL 정제
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

  // parking_available: boolean이 아니면 무시 (Gemini가 object/string으로 반환할 때 방어)
  if (extracted.parking_available !== undefined && extracted.parking_available !== null) {
    if (typeof extracted.parking_available !== 'boolean') {
      const raw = extracted.parking_available as unknown;
      console.warn('[AI] parking_available is not boolean, got:', typeof raw, JSON.stringify(raw).slice(0, 80));
      // 문자열 "true"/"false" 처리
      if (raw === 'true' || raw === true) extracted.parking_available = true;
      else if (raw === 'false' || raw === false) extracted.parking_available = false;
      else extracted.parking_available = undefined;
    }
  }

  // 🆕 1단계: AI가 parking_info를 제공했다면 parking_available도 자동 설정
  // asString()으로 먼저 문자열화 — Gemini가 object를 반환해도 안전하게 처리
  const parkingInfoStr = asString(extracted.parking_info as unknown);
  // 항상 정규화: string → string, object/array → undefined (객체를 DB에 그대로 넣지 않도록)
  extracted.parking_info = parkingInfoStr ?? undefined;

  if (parkingInfoStr && parkingInfoStr.trim() !== '') {
    // parking_info가 있는데 parking_available이 없으면, 내용을 분석해서 자동 설정
    if (extracted.parking_available === undefined || extracted.parking_available === null) {
      // "공식", "건물", "센터", "시설" 등의 키워드가 있고 "근처", "인근" 등이 없으면 공식 주차장으로 간주
      const hasOfficialKeywords = /공식|건물|센터 주차|시설 주차|전용 주차/.test(parkingInfoStr);
      const hasNearbyKeywords = /근처|인근|도보|근방|주변|공영주차장/.test(parkingInfoStr);

      if (hasOfficialKeywords && !hasNearbyKeywords) {
        extracted.parking_available = true; // 공식 주차장
        console.log('[AI] 🚗 Detected official parking from parking_info → parking_available=true');
      } else {
        extracted.parking_available = false; // 근처 주차장 또는 불명확
        console.log('[AI] 🚗 Detected nearby/unofficial parking from parking_info → parking_available=false');
      }
    }

    // sources에 parking_available 정보 추가 (없을 경우)
    if (extracted.sources && extracted.sources['parking_info'] && !extracted.sources['parking_available']) {
      extracted.sources['parking_available'] = {
        source: extracted.sources['parking_info'].source || 'AI 분석',
        evidence: `주차 정보 내용 기반 자동 판단`,
        reason: extracted.parking_available
          ? '공식 주차장 키워드 확인 (건물/센터/시설 주차장)'
          : '근처 주차장 또는 공영주차장으로 판단',
        url: extracted.sources['parking_info'].url || undefined,
        confidence: 7
      };
    }
  }

  // 🆕 2단계: 주차장 정보 보강 (주소가 있고, 주차 정보가 없거나 불완전할 때)
  const needsParkingInfo = address && (!parkingInfoStr || parkingInfoStr.trim() === '');
  
  if (needsParkingInfo) {
    console.log('[AI] 🚗 Attempting to enrich parking info from Naver Place API...');
    try {
      const { searchNearbyParking } = await import('./naverApi.js');
      const parkingResults = await searchNearbyParking(address, venue || extracted.venue);
      
      if (parkingResults && parkingResults.length > 0) {
        console.log(`[AI] 🚗 Found ${parkingResults.length} nearby parking locations`);
        
        // 가장 가까운 주차장 선택 (첫 번째 결과)
        const nearestParking = parkingResults[0];
        const cleanTitle = nearestParking.title.replace(/<[^>]*>/g, '');
        const parkingAddress = nearestParking.roadAddress || nearestParking.address;
        
        // 🔄 공식 주차장이 아니므로 parking_available은 false로 설정
        if (extracted.parking_available === undefined || extracted.parking_available === null) {
          extracted.parking_available = false; // 근처 주차장만 있음 = 공식 주차장 없음
        }
        
        const currentParkingInfoStr = asString(extracted.parking_info as unknown);
        if (!currentParkingInfoStr || currentParkingInfoStr.trim() === '') {
          extracted.parking_info = `건물 내 주차장 없음, 근처 ${cleanTitle} 이용 가능 (${parkingAddress})`;
          console.log('[AI] 🚗 Parking info enriched:', extracted.parking_info);
        }
        
        // sources에 주차장 정보 추가
        if (!extracted.sources) {
          extracted.sources = {};
        }
        
        if (!extracted.sources['parking_available']) {
          extracted.sources['parking_available'] = {
            source: '네이버 플레이스',
            evidence: `건물 공식 주차장 정보 없음, ${parkingResults.length}개의 근처 주차장 확인`,
            reason: '공식 주차장이 없어 근처 공영주차장을 대안으로 제시 (parking_available=false)',
            url: `https://map.naver.com/v5/search/${encodeURIComponent(cleanTitle)}`, // 검색 링크로 변경
            confidence: 7
          };
        }
        
        if (!extracted.sources['parking_info']) {
          extracted.sources['parking_info'] = {
            source: '네이버 플레이스',
            evidence: `${cleanTitle} 확인`,
            reason: '주소 기반 네이버 플레이스 검색 결과',
            url: `https://map.naver.com/v5/search/${encodeURIComponent(address + ' 주차장')}`, // 지도 검색 링크
            confidence: 7
          };
        }
      } else {
        console.log('[AI] 🚗 No nearby parking found');
        // 주차장을 못 찾았을 때
        if (extracted.parking_available === undefined || extracted.parking_available === null) {
          extracted.parking_available = false;
        }
        if (!asString(extracted.parking_info as unknown)?.trim()) {
          extracted.parking_info = '주차 정보 없음, 대중교통 이용 권장';
        }
      }
    } catch (parkingError: any) {
      console.error('[AI] 🚗 Parking search failed:', parkingError.message);
    }
  }

  // ===== Overview 검증 (SSOT 원칙) =====
  if (extracted.overview) {
    const overviewValidation = validateOverview(extracted.overview, extracted.overview_raw);

    if (process.env.NODE_ENV === 'development') {
      console.log('[OVERVIEW][RAW] Length:', extracted.overview_raw?.length || 0);
      console.log('[OVERVIEW][FINAL] Length:', extracted.overview.length);
      if (!overviewValidation.isValid) {
        console.warn('[OVERVIEW][GUARD] ⚠️ Violations detected:', {
          count: overviewValidation.violations.length,
          types: overviewValidation.violations.map(v => `${v.type}:${v.severity}`).join(', '),
          tokens: overviewValidation.violations.flatMap(v => v.matchedText).join(', '),
        });
      } else {
        console.log('[OVERVIEW][GUARD] ✅ Passed validation');
      }
    }

    if (!overviewValidation.isValid) {
      const criticalViolations = overviewValidation.violations.filter(v => v.severity === 'critical');

      if (criticalViolations.length > 0) {
        // Critical 위반 (날짜/시간/가격) → 토큰만 제거하고 overview 유지
        const sanitized = sanitizeOverview(extracted.overview!);
        if (sanitized && sanitized.length >= 10) {
          console.warn('[OVERVIEW][GUARD] 🔧 Critical violations - Tokens removed, overview kept:', criticalViolations.map(v => v.type));
          extracted.overview = sanitized;
        } else {
          // 제거 후 너무 짧으면 null 처리
          console.error('[OVERVIEW][GUARD] 🚨 Critical violations - Overview nullified (too short after sanitize):', criticalViolations.map(v => v.type));
          extracted.overview = undefined;
        }

        // sources에 위반 정보 기록
        if (!extracted.sources) extracted.sources = {};
        extracted.sources['overview_validation'] = {
          source: 'VALIDATION_SANITIZED',
          evidence: `Critical violations removed: ${criticalViolations.map(v => v.pattern).join(', ')}`,
          reason: 'Forbidden tokens stripped from overview',
          confidence: 50,
        };
      } else {
        // High 위반만 있으면 경고만
        console.warn('[OVERVIEW][GUARD] ⚠️ High severity violations - keeping overview but logging');
        if (!extracted.sources) extracted.sources = {};
        extracted.sources['overview_quality'] = {
          source: 'VALIDATION_WARNING',
          evidence: `Quality issues: ${overviewValidation.violations.map(v => v.pattern).join(', ')}`,
          reason: 'Contains quality issues but no SSOT violations',
          confidence: 0,
        };
      }
    }
  }

  return extracted;
}

/**
 * 🆕 개별 함수: 주소 기반 주차장 정보 보강
 */
export async function enrichParkingInfo(
  address: string,
  venue?: string
): Promise<{ parking_available: boolean; parking_info: string; sources?: any } | null> {
  console.log('[AI] 🚗 Enriching parking info for address:', address);
  
  try {
    const { searchNearbyParking } = await import('./naverApi.js');
    const parkingResults = await searchNearbyParking(address, venue);
    
    if (parkingResults && parkingResults.length > 0) {
      console.log(`[AI] 🚗 Found ${parkingResults.length} nearby parking locations`);
      
      const nearestParking = parkingResults[0];
      const cleanTitle = nearestParking.title.replace(/<[^>]*>/g, '');
      const parkingAddress = nearestParking.roadAddress || nearestParking.address;
      
      return {
        parking_available: false, // 근처 주차장만 있음 = 공식 주차장 없음
        parking_info: `건물 내 주차장 없음, 근처 ${cleanTitle} 이용 가능 (${parkingAddress})`,
        sources: {
          parking_available: {
            source: '네이버 플레이스',
            evidence: `건물 공식 주차장 정보 없음, ${parkingResults.length}개의 근처 주차장 확인`,
            reason: '공식 주차장이 없어 근처 공영주차장을 대안으로 제시 (parking_available=false)',
            url: `https://map.naver.com/v5/search/${encodeURIComponent(cleanTitle)}`,
            confidence: 7
          },
          parking_info: {
            source: '네이버 플레이스',
            evidence: `${cleanTitle} 확인`,
            reason: '주소 기반 네이버 플레이스 검색 결과',
            url: `https://map.naver.com/v5/search/${encodeURIComponent(address + ' 주차장')}`,
            confidence: 7
          }
        }
      };
    }
    
    return {
      parking_available: false,
      parking_info: '주차 정보 없음, 대중교통 이용 권장'
    };
  } catch (error: any) {
    console.error('[AI] 🚗 Parking enrichment failed:', error.message);
    return null;
  }
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
    logGeminiUsage(response, GEMINI_MODEL, 'seed');
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
    logGeminiUsage(response, GEMINI_MODEL, 'normalize');
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
    logGeminiUsage(response, GEMINI_MODEL, 'tags');
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

/**
 * Overview sanitizer - Critical 위반 토큰(날짜/시간/가격)만 제거하고 나머지 텍스트 유지
 * null 처리 대신 가능한 한 overview를 살리기 위해 사용
 */
function sanitizeOverview(overview: string): string {
  let text = overview;

  // 날짜/시간 패턴 제거
  text = text
    .replace(/\d{4}년\s*/g, '')
    .replace(/\d{1,2}월\s*/g, '')
    .replace(/\d{1,2}일\s*/g, '')
    .replace(/약\s*\d+분/g, '')
    .replace(/약\s*\d+시간/g, '')
    .replace(/\d+:\d+/g, '')
    .replace(/오전|오후|AM|PM/g, '')
    .replace(/부터|까지/g, '');

  // 가격 패턴 제거
  text = text
    .replace(/무료/g, '')
    .replace(/유료/g, '')
    .replace(/\d+,?\d*원/g, '')
    .replace(/₩/g, '');

  // URL 제거
  text = text.replace(/https?:\/\/[^\s]+/g, '');

  // 정리: 연속 공백, 문장 앞뒤 공백, 빈 괄호 등
  text = text
    .replace(/\(\s*\)/g, '')       // 빈 괄호
    .replace(/\[\s*\]/g, '')       // 빈 대괄호
    .replace(/,\s*,/g, ',')        // 연속 쉼표
    .replace(/\s{2,}/g, ' ')       // 연속 공백
    .trim();

  return text;
}

/**
 * Overview 검증 함수 - SSOT 원칙 준수 확인
 *
 * 날짜/시간/가격/주소/링크는 각 전용 필드가 관리하므로 overview에 포함 금지.
 *
 * @param overview - 검증할 overview 문자열 (사용자 노출 버전)
 * @param overview_raw - 참고용 내부 overview (더 느슨하게 검증)
 * @returns 검증 결과 객체
 */
export function validateOverview(
  overview: string | null | undefined,
  overview_raw?: string | null | undefined
): {
  isValid: boolean;
  sanitized: string | null;
  violations: Array<{
    type: string;
    pattern: string;
    matchedText: string[];
    severity: 'critical' | 'high' | 'medium';
    guidance: string;
  }>;
  reasonCode?: string;
  reasonMessage?: string;
} {
  const violations: Array<{
    type: string;
    pattern: string;
    matchedText: string[];
    severity: 'critical' | 'high' | 'medium';
    guidance: string;
  }> = [];

  if (!overview || overview.trim() === '') {
    return {
      isValid: true,
      sanitized: null,
      violations: [],
      reasonCode: 'EMPTY',
      reasonMessage: 'Overview is empty (acceptable)',
    };
  }

  // ===== OVERVIEW (사용자 노출) 검증 =====

  // 1. 날짜/시간 토큰 검사 (CRITICAL - SSOT 위반)
  const dateTimePatterns = [
    { regex: /\d{4}년/g, name: '연도 (예: 2026년)' },
    { regex: /\d{1,2}월/g, name: '월 (예: 3월)' },
    { regex: /\d{1,2}일/g, name: '일 (예: 18일)' },
    { regex: /약\s*\d+분/g, name: '분 (예: 약 100분)' },
    { regex: /약\s*\d+시간/g, name: '시간 (예: 약 2시간)' },
    { regex: /\d+:\d+/g, name: '시각 (예: 14:00)' },
    { regex: /오전|오후|AM|PM/g, name: '오전/오후' },
    { regex: /부터|까지/g, name: '기간 표현' },
  ];

  for (const pattern of dateTimePatterns) {
    const matches = overview.match(pattern.regex);
    if (matches) {
      violations.push({
        type: 'DATE_TIME_TOKEN',
        pattern: pattern.name,
        matchedText: matches,
        severity: 'critical',
        guidance: `날짜/시간은 start_date, end_date, opening_hours 필드가 관리합니다. Overview에서 제거 필수.`,
      });
    }
  }

  // 2. 가격 토큰 검사 (CRITICAL - SSOT 위반)
  const pricePatterns = [
    { regex: /무료/g, name: '무료' },
    { regex: /유료/g, name: '유료' },
    { regex: /\d+,?\d*원/g, name: '가격 (예: 15,000원)' },
    { regex: /₩/g, name: '원화 기호' },
  ];

  for (const pattern of pricePatterns) {
    const matches = overview.match(pattern.regex);
    if (matches) {
      violations.push({
        type: 'PRICE_TOKEN',
        pattern: pattern.name,
        matchedText: matches,
        severity: 'critical',
        guidance: `가격은 price_min, price_max, is_free 필드가 관리합니다. Overview에서 제거 필수.`,
      });
    }
  }

  // 3. 주소 토큰 검사 (HIGH - SSOT 위반)
  const addressPatterns = [
    { regex: /[서울특별시|부산광역시|대구광역시|인천광역시|경기도]/g, name: '시/도' },
    { regex: /[가-힣]+구\s+[가-힣]+로\s+\d+/g, name: '도로명주소' },
    { regex: /지번|도로명/g, name: '주소 용어' },
  ];

  for (const pattern of addressPatterns) {
    const matches = overview.match(pattern.regex);
    if (matches && matches.length > 1) {
      // 장소명 1개는 허용, 상세 주소 패턴은 금지
      violations.push({
        type: 'ADDRESS_TOKEN',
        pattern: pattern.name,
        matchedText: matches,
        severity: 'high',
        guidance: `상세 주소는 address 필드가 관리합니다. Overview에는 장소명만 포함하세요.`,
      });
    }
  }

  // 4. URL 토큰 검사 (HIGH - SSOT 위반)
  const urlMatches = overview.match(/https?:\/\/[^\s]+/g);
  if (urlMatches) {
    violations.push({
      type: 'URL_TOKEN',
      pattern: 'HTTP/HTTPS URL',
      matchedText: urlMatches,
      severity: 'high',
      guidance: `URL은 external_links 필드가 관리합니다. Overview에서 제거 필수.`,
    });
  }

  // 5. 마케팅 톤 검사 (HIGH - 품질)
  const marketingMatches = overview.match(/만나보세요|경험해보세요|놓치지 마세요|초대합니다|즐겨보세요/g);
  if (marketingMatches) {
    violations.push({
      type: 'MARKETING_TONE',
      pattern: '마케팅 호출',
      matchedText: marketingMatches,
      severity: 'high',
      guidance: `마케팅 톤은 제거하고 객관적 설명으로 변경하세요.`,
    });
  }

  // 6. 주관적 수식어 검사 (HIGH - 품질)
  const subjectiveMatches = overview.match(/특별한|아름다운|감동적인|매력적인|화려한|웅장한|향연|감성|힐링/g);
  if (subjectiveMatches) {
    violations.push({
      type: 'SUBJECTIVE_DESCRIPTOR',
      pattern: '주관적 형용사',
      matchedText: subjectiveMatches,
      severity: 'high',
      guidance: `주관적 형용사는 제거하고 객관적 사실로 변경하세요.`,
    });
  }

  // 7. 길이 검사 (MEDIUM)
  if (overview.length < 20) {
    violations.push({
      type: 'LENGTH_VIOLATION',
      pattern: '너무 짧음 (< 20자)',
      matchedText: [overview],
      severity: 'medium',
      guidance: `Overview는 최소 20자 이상 권장합니다.`,
    });
  }

  if (overview.length > 500) {
    violations.push({
      type: 'LENGTH_VIOLATION',
      pattern: '너무 김 (> 500자)',
      matchedText: [`${overview.substring(0, 50)}...`],
      severity: 'medium',
      guidance: `Overview는 최대 500자 이내 권장합니다. (현재: ${overview.length}자)`,
    });
  }

  // ===== 결과 반환 =====

  const criticalViolations = violations.filter(v => v.severity === 'critical');
  const highViolations = violations.filter(v => v.severity === 'high');
  const isValid = criticalViolations.length === 0 && highViolations.length === 0;

  return {
    isValid,
    sanitized: isValid ? overview : null,
    violations,
    reasonCode: violations.length > 0 ? 'CONTAINS_FORBIDDEN_TOKENS' : undefined,
    reasonMessage: violations.length > 0
      ? `Overview contains ${violations.length} violation(s): ${violations.map(v => v.type).join(', ')}`
      : undefined,
  };
}

// ============================================================
// 캡션 파싱 (팝업 이벤트 자동 채우기용)
// ============================================================

export interface CaptionParseResult {
  // 캡션에서 추출된 필드 (신뢰도 높음 — 캡션에 명시된 사실 정보)
  title?: string;
  start_date?: string;       // YYYY-MM-DD
  end_date?: string;         // YYYY-MM-DD
  venue?: string;            // 장소명 (상호명/건물명)
  address?: string;          // 도로명 주소만
  opening_hours?: {
    weekday?: string;
    weekend?: string;
    holiday?: string;
    closed?: string;
    notes?: string;
  };
  is_free?: boolean;
  price_info?: string;
  price_min?: number;
  price_max?: number;
  instagram_url?: string;
  source_tags?: string[];    // 해시태그 기반
  // 팝업 전용
  popup_brand?: string;
  popup_type?: 'fnb' | 'collab' | 'general';
  is_fnb?: boolean;
  has_photo_zone?: boolean;
  goods_items?: string[];
  signature_menu?: string[];
  public_transport_info?: string;

  // 추출에 사용된 캡션 내 근거 필드 목록
  extracted_fields: string[];
}

/**
 * 팝업 캡션 텍스트를 Gemini로 파싱하여 구조화된 필드 반환
 * 네이버 검색 없이 캡션 텍스트만으로 추출 → 정확도 우선
 */
export async function parseCaptionText(captionText: string): Promise<CaptionParseResult> {
  if (!model) {
    throw new Error('Gemini API가 초기화되지 않았습니다.');
  }

  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

  const prompt = `당신은 팝업스토어 정보를 정확하게 추출하는 전문가입니다.
아래 캡션 텍스트에서 정보를 추출하여 JSON으로 반환하세요.

**최우선 원칙: 캡션에 명시된 사실 정보만 추출. 추론·추측·생성 절대 금지.**
- 캡션에 없는 정보는 해당 필드를 null로 반환
- 오늘 날짜 기준: ${today}
- 연도가 생략된 날짜(예: "02. 23")는 오늘 날짜 기준으로 가장 가까운 미래 날짜로 해석
  예) 오늘이 2026-03-01이고 캡션에 "02. 23 ~ 03. 15"이면 → start_date: "2026-02-23", end_date: "2026-03-15"

---

**캡션 텍스트:**
${captionText}

---

**추출 규칙:**

1. **title**: 팝업의 공식 이름 (브랜드명 포함). 캡션 상단 제목 줄에서 추출.
   예) "귤메달 X 프리카 팝업"

2. **start_date / end_date**: YYYY-MM-DD 형식. 날짜 범위 표현 파싱.
   - "26. 02. 23(월) ~ 26. 03. 15(일)" → "2026-02-23", "2026-03-15"
   - "2월 23일 ~ 3월 15일" → 연도는 오늘 기준으로 가장 가까운 미래 날짜
   - 종료일 없으면 null

3. **venue**: 장소명(상호명)만. 주소 포함 금지.
   - "서울 성동구 연무장13길 4 프리카 성수" → venue: "프리카 성수"
   - "롯데월드몰 1층" → venue: "롯데월드몰"

4. **address**: 도로명 주소만. 장소명·층수 포함 금지.
   - "서울 성동구 연무장13길 4 프리카 성수" → address: "서울 성동구 연무장13길 4"
   - 주소가 없으면 null

5. **opening_hours**: 운영시간. 패턴별 분리.
   - "매일 11:00~19:00" → weekday: "11:00~19:00", weekend: "11:00~19:00"
   - "평일 11~19시, 주말 12~20시" → weekday: "11:00~19:00", weekend: "12:00~20:00"
   - 정보 없으면 null

6. **is_free**: 무료 여부. "무료입장", "입장 무료" → true. 가격 정보 있으면 false. 언급 없으면 null.

7. **price_info**: 가격 텍스트 그대로. 없으면 null.
   예) "성인 15,000원 / 청소년 10,000원"

8. **price_min / price_max**: 숫자(원 단위). 없으면 null.

9. **instagram_url**: "@계정명" 형태면 "https://instagram.com/계정명"으로 변환. 없으면 null.

10. **source_tags**: 해시태그(#) 목록. # 제거하고 텍스트만.
    예) ["성수", "팝업", "귤메달"]

11. **popup_brand**: 팝업을 여는 브랜드명. 콜라보면 메인 브랜드.
    예) "귤메달"

12. **popup_type**: "fnb"(F&B 음식/음료), "collab"(브랜드 콜라보), "general"(일반).
    F&B 카테고리 표시나 음식/음료 언급 있으면 "fnb".

13. **is_fnb**: F&B 팝업 여부. "F&B" 카테고리 표시나 음식/음료 중심이면 true.

14. **has_photo_zone**: "포토존", "포토스팟", "사진" 언급 있으면 true. 없으면 null.

15. **goods_items**: 굿즈/상품 목록. 없으면 null.

16. **signature_menu**: 시그니처 메뉴/대표 음식 목록. 없으면 null.
    예) ["시그니처 감귤 아이스크림", "감귤 캔디"]

17. **public_transport_info**: 대중교통 안내 텍스트. 없으면 null.

---

반드시 아래 JSON 형식으로만 응답하세요. 다른 텍스트 없이 JSON만:

{
  "title": string | null,
  "start_date": string | null,
  "end_date": string | null,
  "venue": string | null,
  "address": string | null,
  "opening_hours": { "weekday": string | null, "weekend": string | null, "holiday": string | null, "closed": string | null, "notes": string | null } | null,
  "is_free": boolean | null,
  "price_info": string | null,
  "price_min": number | null,
  "price_max": number | null,
  "instagram_url": string | null,
  "source_tags": string[] | null,
  "popup_brand": string | null,
  "popup_type": "fnb" | "collab" | "general" | null,
  "is_fnb": boolean | null,
  "has_photo_zone": boolean | null,
  "goods_items": string[] | null,
  "signature_menu": string[] | null,
  "public_transport_info": string | null
}`;

  const result = await model.generateContent(prompt);
  logGeminiUsage(result.response, GEMINI_MODEL, 'caption');
  const text = result.response.text().trim();

  // JSON 블록 추출
  const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/) || text.match(/\{[\s\S]*\}/);
  const jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : text;

  let parsed: any;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error(`캡션 파싱 실패: Gemini 응답이 JSON이 아닙니다. 응답: ${text.substring(0, 200)}`);
  }

  // 추출된 필드 목록 (null이 아닌 필드)
  const fieldMap: Record<string, string> = {
    title: 'title',
    start_date: 'start_date',
    end_date: 'end_date',
    venue: 'venue',
    address: 'address',
    opening_hours: 'opening_hours',
    is_free: 'is_free',
    price_info: 'price_info',
    price_min: 'price_min',
    price_max: 'price_max',
    instagram_url: 'instagram_url',
    source_tags: 'source_tags',
    popup_brand: 'popup_brand',
    popup_type: 'popup_type',
    is_fnb: 'is_fnb',
    has_photo_zone: 'has_photo_zone',
    goods_items: 'goods_items',
    signature_menu: 'signature_menu',
    public_transport_info: 'public_transport_info',
  };

  const extractedFields: string[] = [];
  Object.keys(fieldMap).forEach((key) => {
    const val = parsed[key];
    if (val !== null && val !== undefined) {
      if (Array.isArray(val) && val.length === 0) return;
      if (typeof val === 'object' && !Array.isArray(val)) {
        const hasValue = Object.values(val).some(v => v !== null && v !== undefined);
        if (hasValue) extractedFields.push(key);
      } else {
        extractedFields.push(key);
      }
    }
  });

  return {
    title: parsed.title ?? undefined,
    start_date: parsed.start_date ?? undefined,
    end_date: parsed.end_date ?? undefined,
    venue: parsed.venue ?? undefined,
    address: parsed.address ?? undefined,
    opening_hours: parsed.opening_hours ?? undefined,
    is_free: parsed.is_free ?? undefined,
    price_info: parsed.price_info ?? undefined,
    price_min: parsed.price_min ?? undefined,
    price_max: parsed.price_max ?? undefined,
    instagram_url: parsed.instagram_url ?? undefined,
    source_tags: parsed.source_tags ?? undefined,
    popup_brand: parsed.popup_brand ?? undefined,
    popup_type: parsed.popup_type ?? undefined,
    is_fnb: parsed.is_fnb ?? undefined,
    has_photo_zone: parsed.has_photo_zone ?? undefined,
    goods_items: parsed.goods_items ?? undefined,
    signature_menu: parsed.signature_menu ?? undefined,
    public_transport_info: parsed.public_transport_info ?? undefined,
    extracted_fields: extractedFields,
  };
}

