import axios from 'axios';
import {
  getCanonicalEventsWithoutImage,
  updateCanonicalEventImage,
  getRawEventPayload,
} from '../db';

/**
 * URL이 유효한 이미지인지 HEAD 요청으로 확인
 */
async function isValidImageUrl(url: string): Promise<boolean> {
  if (!url || !url.trim()) {
    return false;
  }

  try {
    const response = await axios.head(url, {
      timeout: 5000,
      validateStatus: (status) => status >= 200 && status < 400,
    });

    // Content-Type이 이미지인지 확인
    const contentType = response.headers['content-type'];
    if (contentType && contentType.startsWith('image/')) {
      return true;
    }

    // Content-Type이 없어도 200이면 유효한 것으로 간주
    return response.status === 200;
  } catch (error) {
    return false;
  }
}

/**
 * Payload에서 이미지 URL 추출
 */
function extractImageFromPayload(
  payload: Record<string, unknown>,
  source: string,
): string | null {
  if (!payload) return null;

  // KOPIS: poster 필드
  if (source === 'kopis') {
    const poster = payload.poster as string;
    if (poster && poster.trim()) {
      // http를 https로 변환
      return poster.startsWith('http://') ? poster.replace('http://', 'https://') : poster;
    }
  }

  // Culture: imgUrl > thumbnail 순서
  if (source === 'culture') {
    const imgUrl = payload.imgUrl as string;
    if (imgUrl && imgUrl.trim()) {
      return imgUrl.startsWith('http://') ? imgUrl.replace('http://', 'https://') : imgUrl;
    }

    const thumbnail = payload.thumbnail as string;
    if (thumbnail && thumbnail.trim()) {
      return thumbnail.startsWith('http://') ? thumbnail.replace('http://', 'https://') : thumbnail;
    }
  }

  // Tour: firstimage > firstimage2 순서
  if (source === 'tour') {
    const firstimage = payload.firstimage as string;
    if (firstimage && firstimage.trim()) {
      return firstimage.startsWith('http://') ? firstimage.replace('http://', 'https://') : firstimage;
    }

    const firstimage2 = payload.firstimage2 as string;
    if (firstimage2 && firstimage2.trim()) {
      return firstimage2.startsWith('http://') ? firstimage2.replace('http://', 'https://') : firstimage2;
    }
  }

  return null;
}

/**
 * 이미지 보강 메인 로직
 */
async function enrichImages() {
  console.log('[EnrichImages] Starting image enrichment...');

  // 1. 이미지가 없는 canonical events 조회
  console.log('[EnrichImages] Fetching canonical events without images...');
  const events = await getCanonicalEventsWithoutImage();

  console.log(`[EnrichImages] Found ${events.length} events without images`);

  if (events.length === 0) {
    console.log('[EnrichImages] No events to enrich. Exiting.');
    return;
  }

  let enrichedCount = 0;
  let skippedCount = 0;

  for (const event of events) {
    try {
      const sources = JSON.parse(event.sources) as Array<{
        source: string;
        rawTable: string;
        rawId: string;
        sourceEventId: string;
        sourceUrl: string | null;
        imageUrl: string | null;
        title: string | null;
        startAt: string | null;
        endAt: string | null;
      }>;

      let candidateImageUrl: string | null = null;

      // 2-1. 우선순위 1: source_priority_winner의 imageUrl
      const winnerSource = sources.find(s => s.source === event.source_priority_winner);
      if (winnerSource?.imageUrl) {
        candidateImageUrl = winnerSource.imageUrl;
        console.log(`[EnrichImages] Candidate from winner (${event.source_priority_winner}): ${event.title.slice(0, 30)}`);
      }

      // 2-2. 우선순위 2: sources 내 다른 소스의 imageUrl
      if (!candidateImageUrl) {
        for (const source of sources) {
          if (source.imageUrl) {
            candidateImageUrl = source.imageUrl;
            console.log(`[EnrichImages] Candidate from source (${source.source}): ${event.title.slice(0, 30)}`);
            break;
          }
        }
      }

      // 2-3. 우선순위 3: raw payload에서 추출
      if (!candidateImageUrl) {
        for (const source of sources) {
          const payload = await getRawEventPayload(source.rawTable, source.rawId);
          if (payload) {
            const extractedUrl = extractImageFromPayload(payload, source.source);
            if (extractedUrl) {
              candidateImageUrl = extractedUrl;
              console.log(`[EnrichImages] Candidate from payload (${source.source}): ${event.title.slice(0, 30)}`);
              break;
            }
          }
        }
      }

      // 3. URL 유효성 검사
      if (candidateImageUrl) {
        const isValid = await isValidImageUrl(candidateImageUrl);

        if (isValid) {
          // 4. 업데이트
          await updateCanonicalEventImage(event.id, candidateImageUrl);
          enrichedCount++;
          console.log(`[EnrichImages] ✅ Enriched: ${event.title.slice(0, 40)} -> ${candidateImageUrl.slice(0, 60)}`);
        } else {
          console.log(`[EnrichImages] ❌ Invalid URL: ${event.title.slice(0, 40)} -> ${candidateImageUrl.slice(0, 60)}`);
          skippedCount++;
        }
      } else {
        console.log(`[EnrichImages] ⚠️  No image found: ${event.title.slice(0, 40)}`);
        skippedCount++;
      }

      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    } catch (error) {
      console.error(`[EnrichImages] Error processing event: ${event.title}`, error);
      skippedCount++;
    }
  }

  console.log('[EnrichImages] Image enrichment complete!');
  console.log(`  - Total events: ${events.length}`);
  console.log(`  - Enriched: ${enrichedCount}`);
  console.log(`  - Skipped: ${skippedCount}`);
  console.log(`  - Success rate: ${((enrichedCount / events.length) * 100).toFixed(1)}%`);
}

// 실행
enrichImages()
  .then(() => {
    console.log('[EnrichImages] Job finished successfully');
    process.exit(0);
  })
  .catch((err) => {
    console.error('[EnrichImages] Fatal error:', err);
    process.exit(1);
  });
