import { pool } from '../src/db';
import {
  searchNaverBlog,
  searchNaverWeb,
  stripHtmlTags,
} from '../src/lib/naverApi';
import { calculateStructuralScore } from '../src/lib/hotScoreCalculator';

type SampleBucket = 'noise' | 'normal';

interface SampleEvent {
  bucket: SampleBucket;
  id: string;
  title: string;
  main_category: string;
  venue: string | null;
  region: string | null;
  start_at: Date;
  end_at: Date;
  source: string | null;
  lat: number | null;
  lng: number | null;
  image_url: string | null;
  external_links: Record<string, unknown> | null;
  is_featured: boolean | null;
}

interface RowResult {
  bucket: SampleBucket;
  eventId: string;
  title: string;
  oldConsensus: number;
  newConsensus: number;
  consensusDelta: number;
  oldStructural: number;
  newStructural: number;
  structuralDelta: number;
  oldFinalLight: number;
  newFinalLight: number;
  finalLightDelta: number;
  blogItems: number;
  webItems: number;
  sampledOld: number;
  sampledNew: number;
}

const NOISE_REGEX =
  '(후기|리뷰|다녀|중고|당근|주식|환율|날씨|운세|\\[.*\\]|&lt;|&gt;)';
const TOP_N = 12;
const SOURCE_CAP = 6;
const PASS_THRESHOLD = 45;
const API_DELAY_MS = 500;

function parseLimitArg(): number {
  const raw = process.argv.find((arg) => arg.startsWith('--limit='));
  const parsed = raw ? Number(raw.split('=')[1]) : 10;
  if (!Number.isFinite(parsed) || parsed <= 0) return 10;
  return Math.min(parsed, 30);
}

function normalizeText(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, '\'')
    .toLowerCase()
    .replace(/[^\w가-힣\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getEventYears(event: SampleEvent): number[] {
  const years = [
    new Date(event.start_at).getFullYear(),
    new Date(event.end_at).getFullYear(),
    new Date().getFullYear(),
  ].filter((year) => Number.isFinite(year));

  return Array.from(new Set(years));
}

function normalizeSearchTitle(title: string): string {
  return normalizeText(title)
    .replace(/^\[[^\]]+\]\s*/g, '')
    .replace(/\s*\[[^\]]+\]$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractSearchTokens(value: string): string[] {
  return normalizeText(value)
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function getPrimaryVenueToken(venue: string): string {
  const tokens = extractSearchTokens(venue).filter(
    (token) => !/홀|관|점|층|로비/.test(token)
  );
  return tokens.slice(0, 2).join(' ');
}

function getCategoryKeyword(category: string): string {
  const map: Record<string, string> = {
    공연: '공연',
    전시: '전시회',
    축제: '축제',
    팝업: '팝업스토어',
    행사: '행사',
  };
  return map[category] || '이벤트';
}

function buildConsensusQuery(event: SampleEvent): string {
  const title = normalizeSearchTitle(event.title);
  const quotedTitle = `"${title}"`;
  const yearToken = getEventYears(event).slice(0, 2).join(' ');
  const venueToken = getPrimaryVenueToken(event.venue || '');
  return [quotedTitle, venueToken, yearToken].filter(Boolean).join(' ').trim();
}

function getPositiveKeywords(category: string): string[] {
  switch (category) {
    case '전시':
      return [
        '전시',
        '전시회',
        '미술관',
        '박물관',
        '아트',
        '갤러리',
        '뮤지엄',
        '기간',
        '운영시간',
        '관람',
        '입장료',
      ];
    case '공연':
      return ['공연', '공연장', '티켓', '좌석', '공연시간', '러닝타임', '출연진'];
    case '축제':
      return ['축제', '행사', '프로그램', '일정', '개최', '진행', '참여'];
    case '팝업':
      return ['팝업', '팝업스토어', '운영', '위치', '오픈', '기간', '매장'];
    case '행사':
      return ['행사', '신청', '접수', '모집', '참가', '등록', '선착순'];
    default:
      return ['이벤트', '일정', '장소', '시간'];
  }
}

function oldIsEventLike(item: any, event: SampleEvent): boolean {
  const title = stripHtmlTags(item.title || '').toLowerCase();
  const description = stripHtmlTags(item.description || '').toLowerCase();
  const text = `${title} ${description}`;

  const hardDropKeywords = [
    '판매종료',
    '공연종료',
    '전시종료',
    '마감되었습니다',
    '종료되었습니다',
  ];
  for (const keyword of hardDropKeywords) {
    if (text.includes(keyword)) return false;
  }

  let score = 0;

  if (/후기|리뷰|다녀왔어요|다녀옴/.test(text)) {
    score -= event.main_category === '전시' ? 10 : 30;
  }

  for (const keyword of getPositiveKeywords(event.main_category)) {
    if (text.includes(keyword)) score += 20;
  }

  if (/예매|예약|신청|티켓|입장권/.test(text)) {
    score += 30;
  }

  return score > 0;
}

function scoreEventSnippet(item: any, event: SampleEvent): number {
  const title = normalizeText(stripHtmlTags(item.title || ''));
  const description = normalizeText(stripHtmlTags(item.description || ''));
  const text = `${title} ${description}`.trim();

  if (!text) return 0;

  const hardDropKeywords = [
    '판매종료',
    '공연종료',
    '전시종료',
    '마감되었습니다',
    '종료되었습니다',
  ];
  for (const keyword of hardDropKeywords) {
    if (text.includes(keyword)) return 0;
  }

  let score = 0;

  const titleTokens = extractSearchTokens(event.title);
  const titleMatched = titleTokens.filter((token) => text.includes(token)).length;
  if (titleTokens.length > 0) {
    score += (titleMatched / titleTokens.length) * 40;
  }

  const yearTokens = getEventYears(event).map(String);
  const yearMatched = yearTokens.filter((token) => text.includes(token)).length;
  score += Math.min(20, yearMatched * 10);

  const placeTokens = extractSearchTokens(`${event.venue || ''} ${event.region || ''}`);
  const placeMatched = placeTokens.filter((token) => text.includes(token)).length;
  if (placeTokens.length > 0) {
    score += Math.min(20, (placeMatched / placeTokens.length) * 20);
  }

  const positiveKeywords = getPositiveKeywords(event.main_category);
  const positiveMatched = positiveKeywords.filter((keyword) => text.includes(keyword)).length;
  score += Math.min(20, positiveMatched * 8);

  if (text.includes(getCategoryKeyword(event.main_category))) {
    score += 10;
  }

  if (/예매|예약|신청|티켓|입장권/.test(text)) {
    score += 15;
  }

  if (/후기|리뷰|다녀왔어요|다녀옴/.test(text)) {
    score -= event.main_category === '전시' ? 8 : 18;
  }

  if (/중고|당근|부동산|구인|주식|환율|날씨|운세/.test(text)) {
    score -= 30;
  }

  return Math.max(0, Math.min(100, score));
}

function buildBalancedSnippetSet(
  blogItems: any[],
  webItems: any[],
  maxItems: number
): any[] {
  const blogCapped = blogItems.slice(0, SOURCE_CAP);
  const webCapped = webItems.slice(0, SOURCE_CAP);
  const merged: any[] = [];

  const maxLen = Math.max(blogCapped.length, webCapped.length);
  for (let i = 0; i < maxLen && merged.length < maxItems; i += 1) {
    if (i < blogCapped.length) merged.push(blogCapped[i]);
    if (merged.length >= maxItems) break;
    if (i < webCapped.length) merged.push(webCapped[i]);
  }

  return merged;
}

function calculateOldStructural(event: SampleEvent): number {
  const venue = (event.venue || '').toLowerCase();
  let venueScore = 50;

  if (/예술의전당|세종문화회관|국립|시립|구립|도립/.test(venue)) {
    venueScore = 100;
  } else if (
    /더현대|롯데백화점|신세계백화점|현대백화점|코엑스|스타필드|ifc몰|잠실/.test(
      venue
    )
  ) {
    venueScore = 90;
  } else if (/갤러리|아트센터|문화센터|극장|콘서트홀|미술관|박물관/.test(venue)) {
    venueScore = 80;
  } else if (/성수|한남|연남|이태원|을지로|압구정|청담|가로수길|삼청동/.test(venue)) {
    venueScore = 70;
  }

  const durationDays =
    (new Date(event.end_at).getTime() - new Date(event.start_at).getTime()) /
    (1000 * 60 * 60 * 24);
  let durationScore = 60;
  if (durationDays < 1) durationScore = 30;
  else if (durationDays <= 7) durationScore = 60;
  else if (durationDays <= 30) durationScore = 80;
  else if (durationDays <= 90) durationScore = 100;
  else if (durationDays <= 180) durationScore = 80;

  const source = (event.source || '').toLowerCase();
  let sourceScore = 50;
  if (source.includes('kopis') || source.includes('문화포털') || source.includes('한국관광공사')) {
    sourceScore = 100;
  } else if (source.includes('admin') || source.includes('manual')) {
    sourceScore = 90;
  } else if (source.includes('interpark') || source.includes('yes24')) {
    sourceScore = 80;
  }

  return Math.round(venueScore * 0.4 + durationScore * 0.3 + sourceScore * 0.3);
}

function toMarkdownTable(rows: RowResult[]): string {
  const head =
    '| bucket | eventId | title | oldConsensus | newConsensus | cDelta | oldFinalLight | newFinalLight | fDelta | blogItems | webItems | sampledOld | sampledNew |';
  const sep =
    '|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|';
  const body = rows
    .map((row) =>
      `| ${row.bucket} | ${row.eventId} | ${row.title.replace(/\|/g, ' ')} | ${row.oldConsensus} | ${row.newConsensus} | ${row.consensusDelta} | ${row.oldFinalLight} | ${row.newFinalLight} | ${row.finalLightDelta} | ${row.blogItems} | ${row.webItems} | ${row.sampledOld} | ${row.sampledNew} |`
    )
    .join('\n');
  return `${head}\n${sep}\n${body}`;
}

function summarize(rows: RowResult[]): Record<string, number> {
  const group = (bucket: SampleBucket) => rows.filter((row) => row.bucket === bucket);
  const avg = (nums: number[]) =>
    nums.length === 0 ? 0 : Number((nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(2));

  const noise = group('noise');
  const normal = group('normal');
  const noiseAvgConsensus = avg(noise.map((r) => r.newConsensus));
  const normalAvgConsensus = avg(normal.map((r) => r.newConsensus));
  const noiseAvgFinal = avg(noise.map((r) => r.newFinalLight));
  const normalAvgFinal = avg(normal.map((r) => r.newFinalLight));

  return {
    sampleNoise: noise.length,
    sampleNormal: normal.length,
    avgNoiseConsensus: noiseAvgConsensus,
    avgNormalConsensus: normalAvgConsensus,
    separationConsensus: Number((normalAvgConsensus - noiseAvgConsensus).toFixed(2)),
    avgNoiseFinalLight: noiseAvgFinal,
    avgNormalFinalLight: normalAvgFinal,
    separationFinalLight: Number((normalAvgFinal - noiseAvgFinal).toFixed(2)),
  };
}

async function main() {
  const limit = parseLimitArg();
  const sampleSql = `
    WITH noise AS (
      SELECT
        'noise'::text AS bucket,
        id,
        title,
        main_category,
        venue,
        region,
        start_at,
        end_at,
        (sources->0->>'source') AS source,
        lat,
        lng,
        image_url,
        external_links,
        is_featured
      FROM canonical_events
      WHERE end_at >= CURRENT_DATE
        AND is_deleted = false
        AND (title ~ $1)
      ORDER BY updated_at DESC
      LIMIT $2
    ),
    normal AS (
      SELECT
        'normal'::text AS bucket,
        id,
        title,
        main_category,
        venue,
        region,
        start_at,
        end_at,
        (sources->0->>'source') AS source,
        lat,
        lng,
        image_url,
        external_links,
        is_featured
      FROM canonical_events
      WHERE end_at >= CURRENT_DATE
        AND is_deleted = false
        AND NOT (title ~ $1)
      ORDER BY updated_at DESC
      LIMIT $2
    )
    SELECT * FROM noise
    UNION ALL
    SELECT * FROM normal;
  `;

  const sample = await pool.query<SampleEvent>(sampleSql, [NOISE_REGEX, limit]);
  const results: RowResult[] = [];

  for (const event of sample.rows) {
    const query = buildConsensusQuery(event);

    const [blogResult, webResult] = await Promise.allSettled([
      searchNaverBlog({ query, display: 30, sort: 'sim' }),
      searchNaverWeb({ query, display: 30 }),
    ]);

    const blogItems = blogResult.status === 'fulfilled' ? blogResult.value.items : [];
    const webItems = webResult.status === 'fulfilled' ? webResult.value.items : [];

    const oldSampled = [...blogItems, ...webItems].slice(0, TOP_N);
    const oldPass = oldSampled.filter((item) => oldIsEventLike(item, event)).length;
    const oldConsensus =
      oldSampled.length > 0 ? Math.round((oldPass / oldSampled.length) * 100) : 0;

    const newSampled = buildBalancedSnippetSet(blogItems, webItems, TOP_N);
    const newScores = newSampled.map((item) => scoreEventSnippet(item, event));
    const passCount = newScores.filter((score) => score >= PASS_THRESHOLD).length;
    const passRatio = newSampled.length > 0 ? passCount / newSampled.length : 0;
    const avgRuleScore =
      newSampled.length > 0
        ? newScores.reduce((a, b) => a + b, 0) / newSampled.length
        : 0;
    let newConsensus = avgRuleScore * 0.65 + passRatio * 100 * 0.35;
    if (passCount === 0) newConsensus *= 0.4;
    else if (newSampled.length > 0 && newSampled.length < 4) newConsensus *= 0.8;
    newConsensus = Math.round(Math.max(0, Math.min(100, newConsensus)));

    const oldStructural = calculateOldStructural(event);
    const newStructural = calculateStructuralScore(event).total;
    const oldFinalLight = Math.round(oldConsensus * 0.5 + oldStructural * 0.5);
    const newFinalLight = Math.round(newConsensus * 0.5 + newStructural * 0.5);

    results.push({
      bucket: event.bucket,
      eventId: event.id,
      title: event.title,
      oldConsensus,
      newConsensus,
      consensusDelta: newConsensus - oldConsensus,
      oldStructural,
      newStructural,
      structuralDelta: newStructural - oldStructural,
      oldFinalLight,
      newFinalLight,
      finalLightDelta: newFinalLight - oldFinalLight,
      blogItems: blogItems.length,
      webItems: webItems.length,
      sampledOld: oldSampled.length,
      sampledNew: newSampled.length,
    });

    await new Promise((resolve) => setTimeout(resolve, API_DELAY_MS));
  }

  const sorted = [...results].sort(
    (a, b) =>
      a.bucket.localeCompare(b.bucket) ||
      b.finalLightDelta - a.finalLightDelta ||
      a.eventId.localeCompare(b.eventId)
  );
  const summary = summarize(sorted);

  console.log('## Buzz Noise Suppression Verification');
  console.log(`- sampleLimitPerBucket: ${limit}`);
  console.log(toMarkdownTable(sorted));
  console.log('\n## Summary');
  console.log(JSON.stringify(summary, null, 2));

  await pool.end();
}

main().catch(async (error) => {
  console.error('[verify-buzz-noise-suppression] failed:', error);
  await pool.end();
  process.exit(1);
});
