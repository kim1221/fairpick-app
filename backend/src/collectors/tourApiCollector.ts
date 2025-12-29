import axios from 'axios';
import { config } from '../config';
import { mapTourApiItem, TourApiItem } from '../mappers/tourApiMapper';
import { upsertEvent, pool, upsertRawTourEvent } from '../db';

const TOUR_API_URL = 'https://apis.data.go.kr/B551011/KorService2/searchFestival2';

/**
 * DB에 해당 external_id가 존재하는지 확인
 */
async function existsInDB(externalId: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM events WHERE source = 'KTO' AND external_id = $1 LIMIT 1`,
    [externalId],
  );
  return result.rows.length > 0;
}
const DETAIL_IMAGE_URL = 'https://apis.data.go.kr/B551011/KorService2/detailImage2';
const DETAIL_COMMON_URL = 'https://apis.data.go.kr/B551011/KorService2/detailCommon2';
const DETAIL_INTRO_URL = 'https://apis.data.go.kr/B551011/KorService2/detailIntro2';

async function fetchDetailImage(contentId: string): Promise<string | null> {
  if (!config.tourApiKey) {
    return null;
  }

  try {
    const params = {
      serviceKey: config.tourApiKey,
      contentId,
      MobileOS: 'ETC',
      MobileApp: 'FairpickCollector',
      _type: 'json',
      imageYN: 'Y',
    };

    const response = await axios.get(DETAIL_IMAGE_URL, { params });
    const items = response.data?.response?.body?.items?.item ?? [];
    
    if (!items || items.length === 0) {
      return null;
    }

    // Convert single item to array
    const imageList = Array.isArray(items) ? items : [items];
    
    // Try to find poster-like image (usually the first or largest one)
    // Priority: originimgurl (high-res) > smallimageurl
    for (const img of imageList) {
      if (img.originimgurl) {
        return img.originimgurl;
      }
    }
    
    // Fallback to smallimageurl if no originimgurl
    if (imageList[0]?.smallimageurl) {
      return imageList[0].smallimageurl;
    }
    
    return null;
  } catch (error) {
    console.warn(`[TourAPI] Failed to fetch detail image for ${contentId}`);
    return null;
  }
}

let detailCommonLoggedOnce = false;

function safeJoin(parts: Array<unknown>): string {
  return parts
    .map((p) => (typeof p === 'string' ? p.trim() : ''))
    .filter(Boolean)
    .join(' · ');
}

async function fetchDetailText(
  contentId: string,
  contentTypeId?: string,
): Promise<{ text: string; homepage?: string; eventplace?: string; overview?: string } | null> {
  if (!config.tourApiKey) {
    return null;
  }

  try {
    // KorService2의 detailCommon2는 파라미터가 다름 - 최소한만 사용
    const commonParams = {
      serviceKey: config.tourApiKey,
      contentId,
      MobileOS: 'ETC',
      MobileApp: 'FairpickCollector',
      _type: 'json',
    };

    const commonRes = await axios.get(DETAIL_COMMON_URL, { params: commonParams });
    const commonItem = commonRes.data?.response?.body?.items?.item;
    const common = Array.isArray(commonItem) ? commonItem[0] : commonItem;
    
    // 디버그: detailCommon2 응답 전체 확인 (처음 1개만)
    if (!detailCommonLoggedOnce) {
      console.log(`[TourAPI DEBUG] detailCommon2 full response:`, JSON.stringify(commonRes.data, null, 2)?.slice(0, 2000));
      detailCommonLoggedOnce = true;
    }
    
    const homepage = typeof common?.homepage === 'string' && common.homepage.trim() ? common.homepage.trim() : undefined;

    let introText = '';
    let eventplace: string | undefined;
    if (contentTypeId) {
      const introParams = {
        serviceKey: config.tourApiKey,
        contentId,
        contentTypeId,
        MobileOS: 'ETC',
        MobileApp: 'FairpickCollector',
        _type: 'json',
      };
      const introRes = await axios.get(DETAIL_INTRO_URL, { params: introParams });
      const introItem = introRes.data?.response?.body?.items?.item;
      const intro = Array.isArray(introItem) ? introItem[0] : introItem;
      if (intro) {
        // eventplace 추출
        eventplace = typeof intro.eventplace === 'string' && intro.eventplace.trim() ? intro.eventplace.trim() : undefined;
        introText = safeJoin([
          intro.eventplace ? `장소:${intro.eventplace}` : '',
          intro.program ? `프로그램:${intro.program}` : '',
          intro.subevent ? `부대행사:${intro.subevent}` : '',
          intro.usetimefestival ? `이용요금:${intro.usetimefestival}` : '',
          intro.playtime ? `시간:${intro.playtime}` : '',
          intro.bookingplace ? `예약:${intro.bookingplace}` : '',
          intro.placeinfo ? `안내:${intro.placeinfo}` : '',
          intro.agelimit ? `대상:${intro.agelimit}` : '',
          intro.sponsor1 ? `주최:${intro.sponsor1}` : '',
          intro.sponsor1tel ? `문의:${intro.sponsor1tel}` : '',
        ]);
      }
    }

    const commonText = common
      ? safeJoin([
          common.overview ? `소개:${common.overview}` : '',
          common.homepage ? `홈페이지:${common.homepage}` : '',
          common.tel ? `문의:${common.tel}` : '',
          common.addr1 ? `주소:${common.addr1}` : '',
        ])
      : '';

    const merged = safeJoin([commonText, introText]);
    const overview = typeof common?.overview === 'string' && common.overview.trim() ? common.overview.trim() : undefined;
    return merged ? { text: merged, homepage, eventplace, overview } : null;
  } catch (error) {
    return null;
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 위치 정보 파싱
 */
function parseLocation(item: TourApiItem): {
  address?: string;
  lat?: number;
  lng?: number;
} {
  const address = item.addr1?.trim() || undefined;
  // TourAPI: mapy = latitude, mapx = longitude
  const lat = item.mapy ? parseFloat(item.mapy) : undefined;
  const lng = item.mapx ? parseFloat(item.mapx) : undefined;

  return {
    address: address || undefined,
    lat: lat && !isNaN(lat) ? lat : undefined,
    lng: lng && !isNaN(lng) ? lng : undefined,
  };
}

async function fetchDetailTextWithRetry(
  contentId: string,
  contentTypeId?: string,
): Promise<{ text: string; homepage?: string; eventplace?: string; overview?: string } | null> {
  // TourAPI는 과호출 시 간헐적으로 5xx/빈 응답이 발생할 수 있어 간단한 재시도를 둡니다.
  const maxAttempts = 2;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await fetchDetailText(contentId, contentTypeId);
    if (result?.text) {
      return result;
    }
    // 다음 시도 전 짧은 대기(백오프)
    if (attempt < maxAttempts) {
      await sleep(150 * attempt);
    }
  }
  return null;
}

async function fetchTourApiEvents() {
  if (!config.tourApiKey) {
    console.warn('[TourAPI] Missing TOUR_API_KEY. Skip fetching.');
    return;
  }

  try {
    const baseParams = {
      serviceKey: config.tourApiKey,
      MobileOS: 'ETC',
      MobileApp: 'FairpickCollector',
      _type: 'json',
      eventStartDate: '20250101', // 2025년 시작부터
      arrange: 'R', // 최신 수정순으로 정렬 (증분 수집용)
      numOfRows: 100, // 페이지당 100개
    };

    // 증분 수집: 최신순으로 가져오다가 연속 N개가 이미 있으면 중단
    const CONSECUTIVE_EXISTS_THRESHOLD = 10;
    let consecutiveExistsCount = 0;
    let currentPage = 1;
    let totalCount = 0;
    let processedCount = 0;
    let successCount = 0;
    let skippedCount = 0;
    let detailTextSuccess = 0;
    let detailTextFailed = 0;

    console.log('[TourAPI] Starting incremental collection (newest first)...');

    while (true) {
      console.log(`[TourAPI] Fetching page ${currentPage}...`);
      const response = await axios.get(TOUR_API_URL, {
        params: { ...baseParams, pageNo: currentPage },
      });

      const body = response.data?.response?.body;
      totalCount = body?.totalCount ?? 0;
      const items: TourApiItem[] = Array.isArray(body?.items?.item)
        ? body.items.item
        : body?.items?.item
        ? [body.items.item]
        : [];

      if (items.length === 0) {
        console.log(`[TourAPI] No more items on page ${currentPage}.`);
        break;
      }

      console.log(`[TourAPI] Page ${currentPage}: ${items.length} events (total in API: ${totalCount})`);

      for (const item of items) {
        processedCount++;

      // 먼저 기본 필터(기간/지역 등)를 통과한 이벤트만 상세 API를 호출합니다.
      const mappedBeforeDetail = mapTourApiItem(item);
      if (!mappedBeforeDetail) {
        continue;
      }

      // 상세 텍스트(프로그램/부대행사/이용요금/예약 등) 보강 → 태그 품질 향상
      // 요청 사이에 아주 짧은 텀을 둬서 안정성을 높입니다.
      await sleep(50);
      const detail = await fetchDetailTextWithRetry(item.contentid, item.contenttypeid);
      if (detail?.text) {
        item.detailText = detail.text;
        // detailCommon2의 homepage를 원본 item.homepage보다 우선(HTML/링크가 더 잘 들어있는 편)
        if (detail.homepage) {
          item.homepage = detail.homepage;
          // 디버그: homepage가 들어온 경우 로그
          console.log(`[TourAPI] ${item.title} - homepage: ${detail.homepage.slice(0, 80)}`);
        }
        // detailIntro2의 eventplace 주입
        if (detail.eventplace) {
          item.eventplace = detail.eventplace;
        }
        // detailCommon2의 overview 주입 (원본 searchFestival2에는 overview가 없으므로)
        if (detail.overview) {
          item.overview = detail.overview;
        }
        detailTextSuccess += 1;
      } else {
        detailTextFailed += 1;
      }

      // detailText가 주입된 상태로 한 번 더 매핑(태그 품질 반영)
      const mapped = mapTourApiItem(item);
      if (!mapped) {
        continue;
      }

      // Fetch high-resolution detail image
      const detailImage = await fetchDetailImage(item.contentid);
      if (detailImage) {
        // Use high-res image for both thumbnail and detail
        mapped.thumbnailUrl = detailImage;
        mapped.detailImageUrl = detailImage;
      }

      // Raw 테이블에는 항상 UPSERT (exists 여부와 무관)
      try {
        const location = parseLocation(item);

        await upsertRawTourEvent({
          sourceEventId: item.contentid,
          sourceUrl: mapped.detailLink,
          payload: item as unknown as Record<string, unknown>,
          title: mapped.title,
          startAt: mapped.startDate,
          endAt: mapped.endDate,
          venue: mapped.venue,
          region: mapped.region,
          mainCategory: mapped.category,
          subCategory: item.cat2 || item.cat3,
          imageUrl: mapped.thumbnailUrl,
          address: location.address,
          lat: location.lat,
          lng: location.lng,
        });
        console.log(`[TourAPI] Raw upserted: contentid=${item.contentid}${location.address ? ' (위치 포함)' : ''}`);
      } catch (error) {
        console.error(`[TourAPI] Failed to upsert raw: ${item.contentid}`, error);
      }

      // 증분 체크: 이미 events 테이블에 있는지 확인
      const exists = await existsInDB(item.contentid);
      if (exists) {
        consecutiveExistsCount++;
        skippedCount++;

        // 연속으로 N개가 이미 있으면 수집 중단 (이후는 모두 기존 데이터)
        if (consecutiveExistsCount >= CONSECUTIVE_EXISTS_THRESHOLD) {
          console.log(`[TourAPI] Found ${CONSECUTIVE_EXISTS_THRESHOLD} consecutive existing items. Stopping incremental collection.`);
          break;
        }
        continue; // events 테이블 저장은 skip
      }

      // 새 데이터 발견 → 연속 카운트 리셋
      consecutiveExistsCount = 0;

      // events 테이블 저장 (새로운 이벤트만)
      await upsertEvent({
          ...mapped,
          tags: mapped.tags ?? [],
        });

        successCount += 1;
        console.log(`[TourAPI] Saved: ${mapped.title}`);
      }

      // 증분 수집 중단 조건 확인
      if (consecutiveExistsCount >= CONSECUTIVE_EXISTS_THRESHOLD) {
        break;
      }

      currentPage += 1;

      // 안전장치: 최대 50페이지까지만 (5000건)
      if (currentPage > 50) {
        console.log('[TourAPI] Reached max pages (50). Stopping.');
        break;
      }

      // 페이지 간 딜레이
      await sleep(100);
    }

    console.info(`[TourAPI] Incremental collection complete!`);
    console.info(`  - Processed: ${processedCount}`);
    console.info(`  - New items saved: ${successCount}`);
    console.info(`  - Skipped (already exists): ${skippedCount}`);
    console.info(`  - Detail text: success=${detailTextSuccess}, failed=${detailTextFailed}`);
  } catch (error) {
    console.error('[TourAPI] Collector failed:', error);
  }
}

function getToday() {
  const now = new Date();
  const y = now.getFullYear();
  const m = `${now.getMonth() + 1}`.padStart(2, '0');
  const d = `${now.getDate()}`.padStart(2, '0');
  return `${y}${m}${d}`;
}

fetchTourApiEvents().then(() => process.exit(0));

