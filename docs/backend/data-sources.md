# 데이터 소스 & 매핑 계획 (초안)

## 1. 공식 API 목록

| 소스 | 엔드포인트 예시 | 인증/쿼터 | 비고 |
| --- | --- | --- | --- |
| 한국관광공사 TourAPI | `GET https://apis.data.go.kr/B551011/KorService1/searchFestival1` | 인증키 필요, 일일 쿼터 존재 | 전국 행사, `areaCode`/`cat3` 통해 지역/카테고리 |
| 서울시 공공데이터(문화행사) | `GET https://openapi.seoul.go.kr:8088/{KEY}/json/culturalEventInfo/1/1000/` | 인증키 필요, 10,000건 제한 | 서울 지역 특화, GCODE가 ID |
| 롯데월드/코엑스 제휴 API | 제휴 후 제공 URL (예: `https://partner.lotte.com/api/events`) | OAuth2 / Token | 기관별 필드 다름, 제휴 계약 필요 |
| 기타 공공 API | 지자체/박람회 등 | 인증 방식 다양 | 필요 시 추가 |
| 크롤링 대상 | 아래 목록 참고 | robots.txt 확인, 요청 주기 제한 | HTML 파싱 필요 |

#### 추천 크롤링 대상 목록

- **네이버 공연·전시 카테고리**
  - 공연: `https://search.naver.com/search.naver?where=nexearch&sm=tab_jum&query=공연`
  - 전시: `https://search.naver.com/search.naver?where=nexearch&sm=tab_jum&query=전시`
  - 정적 HTML 구조를 사용하며 `.list_event_item` 등 selector로 추출 가능
- **네이버 플레이스 행사 (지역별)**
  - 예: `https://m.place.naver.com/place/list?type=perform&x=...`
  - 네이버 지도 API 기반, 지역 좌표별 호출 필요
- **구글 이벤트(구글 아트앤컬처/공연 캘린더)**
  - 예: `https://artsandculture.google.com/event`
  - 국제 행사 포함, 구조화된 JSON-LD 스니펫 활용 가능
- **코엑스 공식 일정**
  - `https://www.coexcenter.com/calendar` (전시/박람회)
- **롯데월드 어드벤처 이벤트**
  - `https://adventure.lotteworld.com/kor/companion/event/list.do`
- **세빛섬/63빌딩 등 특정 장소 이벤트**
  - 예: `https://www.somesevit.co.kr/event`
- **문화체육관광부 문화포털**
  - `https://www.mcst.go.kr/kor/s_culture/culture/cultureList.jsp`

> 위 URL들은 예시이며, 실제 사용 전 robots.txt 및 이용 약관을 확인하고 요청 주기/헤더 등을 준수해야 함.

## 2. 필드 매핑 가이드

### 한국관광공사 TourAPI

| 공통 필드 | TourAPI 필드 | 변환 규칙 |
| --- | --- | --- |
| `id` | `contentid` | `kto-{contentid}` |
| `title` | `title` | 그대로 |
| `description` | `overview` | HTML 제거, 120자 내로 자르기 |
| `periodText` | `eventstartdate`, `eventenddate` | `YYYY.MM.DD ~ YYYY.MM.DD` |
| `startDate`/`endDate` | `eventstartdate`, `eventenddate` | `YYYY-MM-DD` |
| `region` | `areacode` + `sigungucode` | 지역 코드 → 한글 |
| `category` | `cat3` | 미리 정의한 매핑 테이블 |
| `thumbnailUrl` | `firstimage` | 없으면 제외 |
| `detailImageUrl` | `firstimage2` | 없으면 썸네일 사용 |
| `detailLink` | `homepage` | URL 파싱 |
| `source` | - | `"KTO"` |
| `updatedAt` | `modifiedtime` | ISO8601 |

### 서울시 문화행사 API

| 공통 필드 | 서울시 필드 | 변환 규칙 |
| --- | --- | --- |
| `id` | `GCODE` | `seoul-{GCODE}` |
| `title` | `TITLE` | 그대로 |
| `description` | `CONTENT` | HTML 제거 |
| `periodText` | `DATE` | 이미 기간 형태 |
| `startDate`/`endDate` | `DATE` 파싱 | 날짜 범위 파싱 |
| `region` | 고정 `"서울"` | |
| `category` | `CODENAME` | 분류 매핑 (공연/전시 등) |
| `thumbnailUrl` | `MAIN_IMG` | |
| `detailLink` | `ORG_LINK` | |
| `detailImageUrl` | `MAIN_IMG` | |
| `tags` | `USE_TRGT` 등 | 연령/테마를 태그로 변환 |
| `source` | - | `"SeoulOpenAPI"` |

### 제휴 API (예: 롯데월드)

- 제휴 계약에 따라 응답 필드 확인 후 별도 매핑 테이블 작성
- OAuth Token 갱신 방식, 레이트 리밋 명시

### 크롤링 대상 (코엑스 등)

- HTML 구조 파악 → CSS Selector 지정 (예: `.schedule-item`)
- 이미지/링크는 절대 URL로 변환
- Update 주기: 1일 1회 (변경 감지 시만 업데이트)
- robots.txt 준수, 요청 간 2초 이상 간격

## 3. 유니크 키 규칙

- `source` + `externalId` 조합으로 unique index 생성
- ID 생성 예
  - KTO: `kto-{contentid}`
  - 서울시: `seoul-{GCODE}`
  - 제휴 API: `{source}-{partnerEventId}`

## 4. 수집 스케줄 (초안)

| 소스 | 주기 | 비고 |
| --- | --- | --- |
| TourAPI | 1시간 | 업데이트 타임 기반 |
| 서울시 공공데이터 | 1일 1회 (00:30) | max 1000건씩 읽어오기 |
| 제휴 API | 30분 | 웹훅 지원 시 즉시 |
| 크롤링 | 1일 2회 | 변경 감지 시만 DB 업데이트 |

## 5. 실패/재시도 전략

- HTTP 오류 발생 시 3회 재시도 (지수 백오프)
- 파싱 실패 데이터는 `failed_imports` 테이블에 저장 후 수동 확인
- 경고/에러 로그는 Slack 알림

## 6. TODO

- [ ] 각 소스별 인증 키 발급 및 보안 저장소에 등록
- [ ] 지역/카테고리 코드 매핑 테이블 세부 정의
- [ ] 크롤링 대상 robots.txt 최종 확인

