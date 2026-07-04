/**
 * 동네(구/동) 한글 → 라틴 로마자 매핑.
 * 개봉 태그의 큰 콘덴스드 글자(목적지)로 쓰인다. Anton은 한글 글리프가 없으므로
 * 반드시 라틴만 반환한다. 맵에 없으면 'SEOUL' 폴백.
 */

// 긴 키가 먼저 매칭되도록 항목 순서를 길이 우선으로 관리한다.
const REGION_MAP: Record<string, string> = {
  // 성동/성수
  성수: 'SEONGSU',
  성수동: 'SEONGSU',
  성동구: 'SEONGDONG',
  성동: 'SEONGDONG',
  // 마포/홍대/합정/연남
  홍대: 'HONGDAE',
  홍익: 'HONGDAE',
  합정: 'HAPJEONG',
  연남: 'YEONNAM',
  연남동: 'YEONNAM',
  망원: 'MANGWON',
  상수: 'SANGSU',
  마포구: 'MAPO',
  마포: 'MAPO',
  // 용산/이태원/한남
  이태원: 'ITAEWON',
  한남: 'HANNAM',
  한남동: 'HANNAM',
  용산구: 'YONGSAN',
  용산: 'YONGSAN',
  // 강남권
  강남구: 'GANGNAM',
  강남: 'GANGNAM',
  압구정: 'APGUJEONG',
  청담: 'CHEONGDAM',
  삼성: 'SAMSEONG',
  역삼: 'YEOKSAM',
  신사: 'SINSA',
  서초구: 'SEOCHO',
  서초: 'SEOCHO',
  // 송파/잠실
  잠실: 'JAMSIL',
  송파구: 'SONGPA',
  송파: 'SONGPA',
  // 종로/중구 도심
  종로구: 'JONGNO',
  종로: 'JONGNO',
  삼청: 'SAMCHEONG',
  삼청동: 'SAMCHEONG',
  익선: 'IKSEON',
  인사동: 'INSADONG',
  광화문: 'GWANGHWAMUN',
  을지로: 'EULJIRO',
  명동: 'MYEONGDONG',
  중구: 'JUNG-GU',
  // 서대문/신촌
  신촌: 'SINCHON',
  서대문구: 'SEODAEMUN',
  서대문: 'SEODAEMUN',
  // 영등포/여의도
  여의도: 'YEOUIDO',
  영등포구: 'YEONGDEUNGPO',
  영등포: 'YEONGDEUNGPO',
  문래: 'MULLAE',
  // 노들섬/한강
  노들섬: 'NODEUL',
  노들: 'NODEUL',
  // 광진/성수 인근
  건대: 'KONKUK',
  광진구: 'GWANGJIN',
  광진: 'GWANGJIN',
  // 동대문
  동대문구: 'DONGDAEMUN',
  동대문: 'DONGDAEMUN',
  // 은평/서북
  은평구: 'EUNPYEONG',
  은평: 'EUNPYEONG',
  // 관악/동작
  관악구: 'GWANAK',
  관악: 'GWANAK',
  동작구: 'DONGJAK',
  동작: 'DONGJAK',
  노량진: 'NORYANGJIN',
  // 강서/양천
  강서구: 'GANGSEO',
  강서: 'GANGSEO',
  양천구: 'YANGCHEON',
  // 경기 주요
  성남: 'SEONGNAM',
  판교: 'PANGYO',
  분당: 'BUNDANG',
  수원: 'SUWON',
  일산: 'ILSAN',
  고양: 'GOYANG',
  인천: 'INCHEON',
  부산: 'BUSAN',
  대구: 'DAEGU',
  광주: 'GWANGJU',
  대전: 'DAEJEON',
  // 시/도 폴백
  서울: 'SEOUL',
  서울시: 'SEOUL',
  서울특별시: 'SEOUL',
};

const REGION_KEYS = Object.keys(REGION_MAP).sort((a, b) => b.length - a.length);

/**
 * 지역 문자열을 라틴 로마자 목적지 이름으로 변환한다.
 * - 순수 라틴/영문 입력이면 대문자로 그대로 사용
 * - 맵의 키를 포함하면 그 로마자 반환(긴 키 우선)
 * - 그 외 전부 'SEOUL' 폴백
 */
export function romanizeRegion(region: string | null): string {
  if (!region) return 'SEOUL';
  const raw = region.trim();
  if (!raw) return 'SEOUL';

  // 이미 라틴 알파벳으로만 이루어졌으면 대문자로 사용(공백 제거).
  if (/^[A-Za-z][A-Za-z\s.-]*$/.test(raw)) {
    const latin = raw.replace(/[^A-Za-z]/g, '').toUpperCase();
    return latin || 'SEOUL';
  }

  for (const key of REGION_KEYS) {
    if (raw.includes(key)) return REGION_MAP[key] ?? 'SEOUL';
  }

  return 'SEOUL';
}
