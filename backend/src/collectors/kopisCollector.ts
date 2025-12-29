import axios from 'axios';
import { v5 as uuidv5 } from 'uuid';
import { parseStringPromise } from 'xml2js';
import { pool, upsertEvent, upsertRawKopisEvent } from '../db';

// KOPIS API 설정
const KOPIS_API_BASE = 'http://www.kopis.or.kr/openApi/restful';
const KOPIS_SERVICE_KEY = 'bbef54b0049c4570b7b1f46f52b6dd8f';
// 유효한 UUID v4 형식의 네임스페이스 (고정값 - 변경 금지)
const KOPIS_NAMESPACE = 'c1d2e3f4-a5b6-47c8-89d0-e1f2a3b4c5d6';

interface KopisItem {
  mt20id: string;    // 공연 ID
  prfnm: string;     // 공연명
  prfpdfrom: string; // 시작일 (YYYY.MM.DD)
  prfpdto: string;   // 종료일 (YYYY.MM.DD)
  fcltynm: string;   // 공연장명
  poster: string;    // 포스터 URL
  area: string;      // 지역
  genrenm: string;   // 장르명
  openrun: string;   // 오픈런 여부
  prfstate: string;  // 공연상태
}

interface KopisDetailItem extends KopisItem {
  mt10id?: string;      // 공연시설 ID
  prfcast?: string;     // 출연진
  prfcrew?: string;     // 제작진
  prfruntime?: string;  // 런타임
  prfage?: string;      // 관람연령
  entrpsnmP?: string;   // 제작사
  pcseguidance?: string; // 티켓가격
  sty?: string;         // 줄거리
  dtguidance?: string;  // 공연시간
  la?: string;          // 위도
  lo?: string;          // 경도
  adres?: string;       // 주소
}

/**
 * 날짜 포맷 변환 (YYYY.MM.DD → YYYY-MM-DD)
 */
function formatDate(dateStr: string): string {
  if (!dateStr) return '';
  return dateStr.replace(/\./g, '-');
}

/**
 * 표시용 날짜 포맷 유지 (YYYY.MM.DD)
 */
function formatDisplayDate(dateStr: string): string {
  return dateStr || '';
}

/**
 * 이미지 URL 정규화 (http → https)
 */
function normalizeImageUrl(url?: string): string {
  const PLACEHOLDER = 'https://via.placeholder.com/600x400/E8ECF0/B0B8C1?text=No+Image';
  
  if (!url || !url.trim()) {
    return PLACEHOLDER;
  }
  
  let normalized = url.trim();
  
  // KOPIS는 http를 사용하지만, iOS 호환을 위해 https로 변환
  // (KOPIS 서버가 https도 지원하는지 확인 필요)
  if (normalized.startsWith('http://')) {
    normalized = normalized.replace('http://', 'https://');
  }
  
  return normalized;
}

/**
 * 지역명 정규화
 */
function normalizeRegion(area: string): string {
  const regionMap: Record<string, string> = {
    '서울특별시': '서울',
    '서울': '서울',
    '경기도': '경기',
    '경기': '경기',
    '인천광역시': '인천',
    '인천': '인천',
    '부산광역시': '부산',
    '부산': '부산',
    '대구광역시': '대구',
    '대구': '대구',
    '광주광역시': '광주',
    '광주': '광주',
    '대전광역시': '대전',
    '대전': '대전',
    '울산광역시': '울산',
    '울산': '울산',
    '세종특별자치시': '세종',
    '세종': '세종',
    '강원도': '강원',
    '강원특별자치도': '강원',
    '강원': '강원',
    '충청북도': '충북',
    '충북': '충북',
    '충청남도': '충남',
    '충남': '충남',
    '전라북도': '전북',
    '전북특별자치도': '전북',
    '전북': '전북',
    '전라남도': '전남',
    '전남': '전남',
    '경상북도': '경북',
    '경북': '경북',
    '경상남도': '경남',
    '경남': '경남',
    '제주특별자치도': '제주',
    '제주': '제주',
  };

  return regionMap[area] || '서울';
}

/**
 * 장르를 앱 카테고리로 매핑
 */
function mapGenreToCategory(genrenm: string): string {
  const genre = genrenm || '';
  
  // 뮤지컬, 연극, 무용은 '공연'
  if (/뮤지컬|연극|무용|오페라|발레|국악|클래식|콘서트|대중음악|서커스|복합/.test(genre)) {
    return '공연';
  }
  
  return '공연'; // KOPIS는 공연 전문이므로 기본값도 '공연'
}

/**
 * 무료 이벤트 여부 판별
 */
function parseIsFree(pcseguidance?: string): boolean {
  if (!pcseguidance) return false;

  const priceText = pcseguidance.toLowerCase();
  return (
    priceText.includes('무료') ||
    priceText.includes('0원') ||
    priceText.includes('free')
  );
}

/**
 * 위치 정보 파싱
 */
function parseLocation(item: KopisDetailItem): {
  address?: string;
  lat?: number;
  lng?: number;
} {
  const address = item.adres?.trim() || undefined;
  const lat = item.la ? parseFloat(item.la) : undefined;
  const lng = item.lo ? parseFloat(item.lo) : undefined;

  return {
    address: address || undefined,
    lat: lat && !isNaN(lat) ? lat : undefined,
    lng: lng && !isNaN(lng) ? lng : undefined,
  };
}

/**
 * 태그 추출
 */
function extractTags(item: KopisItem | KopisDetailItem, category: string): string[] {
  const tags: string[] = [];

  // 장르 태그
  if (item.genrenm) {
    tags.push(item.genrenm);
  }

  // 오픈런 태그
  if (item.openrun === 'Y') {
    tags.push('오픈런');
  }

  // 상태 태그
  if (item.prfstate === '공연중') {
    tags.push('공연중');
  } else if (item.prfstate === '공연예정') {
    tags.push('공연예정');
  }

  // 제목에서 키워드 추출
  const title = item.prfnm || '';
  const keywords = ['크리스마스', '송년', '신년', '가족', '어린이', '뮤지컬', '콘서트', '리사이틀'];
  for (const keyword of keywords) {
    if (title.includes(keyword) && !tags.includes(keyword)) {
      tags.push(keyword);
    }
  }

  return [...new Set(tags)].slice(0, 4);
}

/**
 * DB에 해당 external_id가 존재하는지 확인 (증분 수집용)
 */
async function existsInDB(externalId: string): Promise<boolean> {
  try {
    const result = await pool.query(
      `SELECT 1 FROM events WHERE source = 'KOPIS' AND external_id = $1 LIMIT 1`,
      [externalId],
    );
    return result.rows.length > 0;
  } catch {
    return false;
  }
}

/**
 * 공연 목록 조회
 */
async function fetchPerformanceList(stdate: string, eddate: string, cpage: number = 1, rows: number = 100): Promise<KopisItem[]> {
  try {
    const response = await axios.get(`${KOPIS_API_BASE}/pblprfr`, {
      params: {
        service: KOPIS_SERVICE_KEY,
        stdate,
        eddate,
        cpage,
        rows,
        // prfstate 생략 시 전체 (공연예정 + 공연중) 조회
      },
    });

    const parsed = await parseStringPromise(response.data);
    const dbs = parsed?.dbs?.db;

    if (!dbs) {
      return [];
    }

    const items = Array.isArray(dbs) ? dbs : [dbs];
    
    return items.map((item: Record<string, string[]>) => ({
      mt20id: item.mt20id?.[0] || '',
      prfnm: item.prfnm?.[0] || '',
      prfpdfrom: item.prfpdfrom?.[0] || '',
      prfpdto: item.prfpdto?.[0] || '',
      fcltynm: item.fcltynm?.[0] || '',
      poster: item.poster?.[0] || '',
      area: item.area?.[0] || '',
      genrenm: item.genrenm?.[0] || '',
      openrun: item.openrun?.[0] || 'N',
      prfstate: item.prfstate?.[0] || '',
    }));
  } catch (error) {
    console.error(`[KOPIS] Failed to fetch list:`, error);
    return [];
  }
}

/**
 * 공연 상세 조회
 */
async function fetchPerformanceDetail(mt20id: string): Promise<KopisDetailItem | null> {
  try {
    const response = await axios.get(`${KOPIS_API_BASE}/pblprfr/${mt20id}`, {
      params: {
        service: KOPIS_SERVICE_KEY,
      },
    });

    const parsed = await parseStringPromise(response.data);
    const db = parsed?.dbs?.db?.[0];

    if (!db) {
      return null;
    }

    return {
      mt20id: db.mt20id?.[0] || mt20id,
      prfnm: db.prfnm?.[0] || '',
      prfpdfrom: db.prfpdfrom?.[0] || '',
      prfpdto: db.prfpdto?.[0] || '',
      fcltynm: db.fcltynm?.[0] || '',
      poster: db.poster?.[0] || '',
      area: db.area?.[0] || '',
      genrenm: db.genrenm?.[0] || '',
      openrun: db.openrun?.[0] || 'N',
      prfstate: db.prfstate?.[0] || '',
      mt10id: db.mt10id?.[0] || '',
      prfcast: db.prfcast?.[0] || '',
      prfcrew: db.prfcrew?.[0] || '',
      prfruntime: db.prfruntime?.[0] || '',
      prfage: db.prfage?.[0] || '',
      entrpsnmP: db.entrpsnmP?.[0] || '',
      pcseguidance: db.pcseguidance?.[0] || '',
      sty: db.sty?.[0] || '',
      dtguidance: db.dtguidance?.[0] || '',
      la: db.la?.[0] || '',
      lo: db.lo?.[0] || '',
      adres: db.adres?.[0] || '',
    };
  } catch (error) {
    console.error(`[KOPIS] Failed to fetch detail for ${mt20id}:`, error);
    return null;
  }
}

/**
 * 메인 수집 함수 (증분 방식)
 */
async function collectKopisEvents() {
  console.log('[KOPIS] Starting incremental collection...');

  // 오늘부터 1년 후까지
  const today = new Date();
  const oneYearLater = new Date(today.getFullYear() + 1, today.getMonth(), today.getDate());
  
  const stdate = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
  const eddate = `${oneYearLater.getFullYear()}${String(oneYearLater.getMonth() + 1).padStart(2, '0')}${String(oneYearLater.getDate()).padStart(2, '0')}`;

  console.log(`[KOPIS] Date range: ${stdate} ~ ${eddate}`);

  // 증분 수집: 연속 N개가 이미 있으면 중단
  const CONSECUTIVE_EXISTS_THRESHOLD = 10;
  let consecutiveExistsCount = 0;
  let cpage = 1;
  let totalCollected = 0;
  let totalSaved = 0;
  let totalSkipped = 0;

  while (true) {
    // prfstate 없이 호출하면 전체(공연예정+공연중) 가져옴
    const items = await fetchPerformanceList(stdate, eddate, cpage, 100);

    if (items.length === 0) {
      console.log(`[KOPIS] No more items on page ${cpage}.`);
      break;
    }

    console.log(`[KOPIS] Page ${cpage}: ${items.length} items`);
    totalCollected += items.length;

    for (const item of items) {
      if (!item.mt20id) {
        totalSkipped++;
        continue;
      }

      // 상세 정보 조회 (raw 저장을 위해 exists 체크 전에 수행)
      await new Promise((resolve) => setTimeout(resolve, 50));
      const detail = await fetchPerformanceDetail(item.mt20id);
      const finalItem = detail || item;

      const region = normalizeRegion(finalItem.area);
      const category = mapGenreToCategory(finalItem.genrenm);
      const imageUrl = normalizeImageUrl(finalItem.poster);

      // 시작일/종료일 변환
      const startDate = formatDate(finalItem.prfpdfrom);
      const endDate = formatDate(finalItem.prfpdto);

      if (!startDate || !endDate) {
        totalSkipped++;
        continue;
      }

      // Raw 테이블에는 항상 UPSERT (exists 여부와 무관)
      try {
        const detailItem = finalItem as KopisDetailItem;
        const isFree = parseIsFree(detailItem.pcseguidance);
        const location = parseLocation(detailItem);

        await upsertRawKopisEvent({
          sourceEventId: item.mt20id,
          sourceUrl: `https://www.kopis.or.kr/por/db/pblprfr/pblprfrView.do?menuId=MNU_00028&mt20Id=${item.mt20id}`,
          payload: finalItem as unknown as Record<string, unknown>,
          title: finalItem.prfnm,
          startAt: startDate,
          endAt: endDate,
          venue: finalItem.fcltynm,
          region,
          mainCategory: category,
          subCategory: finalItem.genrenm,
          imageUrl,
          isFree,
          address: location.address,
          lat: location.lat,
          lng: location.lng,
        });
        console.log(`[KOPIS] Raw upserted: mt20id=${item.mt20id}${isFree ? ' (무료)' : ''}${location.address ? ' (위치 포함)' : ''}`);
      } catch (error) {
        console.error(`[KOPIS] Failed to upsert raw: ${item.mt20id}`, error);
      }

      // 증분 체크: 이미 events 테이블에 있는지 확인
      const exists = await existsInDB(item.mt20id);
      if (exists) {
        consecutiveExistsCount++;
        totalSkipped++;

        if (consecutiveExistsCount >= CONSECUTIVE_EXISTS_THRESHOLD) {
          console.log(`[KOPIS] Found ${CONSECUTIVE_EXISTS_THRESHOLD} consecutive existing items. Stopping.`);
          break;
        }
        continue; // events 테이블 저장은 skip
      }

      // 새 데이터 발견 → 연속 카운트 리셋
      consecutiveExistsCount = 0;

      // events 테이블 저장 (새로운 이벤트만)
      try {
        const id = uuidv5(item.mt20id, KOPIS_NAMESPACE);
        const tags = extractTags(finalItem, category);

        // 줄거리에서 설명 추출
        const detailItem = finalItem as KopisDetailItem;
        const overview = detailItem.sty || '';
        const description = overview.slice(0, 80) || finalItem.prfnm;

        await upsertEvent({
          id,
          source: 'KOPIS',
          externalId: item.mt20id,
          title: finalItem.prfnm.slice(0, 60),
          description,
          overview,
          venue: finalItem.fcltynm.slice(0, 100),
          periodText: `${formatDisplayDate(finalItem.prfpdfrom)} ~ ${formatDisplayDate(finalItem.prfpdto)}`,
          startDate,
          endDate,
          region,
          category,
          tags,
          thumbnailUrl: imageUrl,
          detailImageUrl: imageUrl,
          detailLink: `https://www.kopis.or.kr/por/db/pblprfr/pblprfrView.do?menuId=MNU_00028&mt20Id=${item.mt20id}`,
          updatedAt: new Date().toISOString(),
        });

        totalSaved++;
        console.log(`[KOPIS] Saved: ${finalItem.prfnm}`);
      } catch (error) {
        console.error(`[KOPIS] Failed to save: ${finalItem.prfnm}`, error);
        totalSkipped++;
      }
    }

    // 증분 수집 중단 조건
    if (consecutiveExistsCount >= CONSECUTIVE_EXISTS_THRESHOLD) {
      break;
    }

    // 페이지네이션
    if (items.length < 100) {
      break;
    }

    cpage++;

    // 안전장치: 최대 50페이지
    if (cpage > 50) {
      console.log('[KOPIS] Reached max pages (50). Stopping.');
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  console.log(`[KOPIS] Incremental collection complete!`);
  console.log(`  - Total collected: ${totalCollected}`);
  console.log(`  - New items saved: ${totalSaved}`);
  console.log(`  - Skipped: ${totalSkipped}`);
}

// 실행
collectKopisEvents()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[KOPIS] Fatal error:', err);
    process.exit(1);
  });

