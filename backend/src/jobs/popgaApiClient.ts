import axios, { AxiosRequestConfig } from 'axios';

export const POPGA_WEB_BASE = 'https://popga.co.kr';
export const POPGA_API_BASE = `${POPGA_WEB_BASE}/api`;
export const POPGA_SUCCESS_CODE = 20_000_000;

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_COUNT = 1_000;
// Popga는 현재 totalElements에 비공개/제외 레코드 1건을 포함해 실제 content보다 1 크게 보고한다.
// 실측 가능한 이 1건만 경고 후 허용하고, 그보다 큰 차이는 누락으로 간주한다.
const MAX_REPORTED_COUNT_DRIFT = 1;

export const POPGA_API_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'application/json',
  'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
  Referer: `${POPGA_WEB_BASE}/list/popup`,
  Origin: POPGA_WEB_BASE,
};

export interface PopgaSpot {
  id: string | number;
  title: string;
  [key: string]: unknown;
}

export interface PopgaPage {
  content: PopgaSpot[];
  page: {
    size: number;
    number: number;
    totalElements: number;
    totalPages: number;
  };
}

export type PopgaHttpGet = (
  url: string,
  config?: AxiosRequestConfig,
) => Promise<{ data: unknown }>;

export class PopgaApiContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PopgaApiContractError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readNonNegativeInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new PopgaApiContractError(`팝가 응답의 ${field} 값이 올바르지 않습니다.`);
  }
  return value;
}

function assertSuccessfulEnvelope(body: unknown, label: string): Record<string, unknown> {
  if (!isRecord(body)) {
    throw new PopgaApiContractError(`${label} 응답이 JSON 객체가 아닙니다.`);
  }

  const result = body.result;
  if (!isRecord(result) || result.code !== POPGA_SUCCESS_CODE) {
    const code = isRecord(result) ? String(result.code ?? 'missing') : 'missing';
    const desc = isRecord(result) ? String(result.desc ?? '설명 없음') : 'result 없음';
    throw new PopgaApiContractError(`${label} 실패 (code=${code}, desc=${desc})`);
  }

  if (!isRecord(body.data)) {
    throw new PopgaApiContractError(`${label} 성공 응답에 data 객체가 없습니다.`);
  }
  return body.data;
}

export function parsePopgaListResponse(body: unknown, expectedPage?: number): PopgaPage {
  const data = assertSuccessfulEnvelope(body, '팝가 목록 API');
  if (!Array.isArray(data.content)) {
    throw new PopgaApiContractError('팝가 목록 API의 data.content가 배열이 아닙니다.');
  }
  if (!isRecord(data.page)) {
    throw new PopgaApiContractError('팝가 목록 API의 data.page가 없습니다.');
  }

  const page = {
    size: readNonNegativeInteger(data.page.size, 'page.size'),
    number: readNonNegativeInteger(data.page.number, 'page.number'),
    totalElements: readNonNegativeInteger(data.page.totalElements, 'page.totalElements'),
    totalPages: readNonNegativeInteger(data.page.totalPages, 'page.totalPages'),
  };

  if (page.size === 0 && page.totalElements > 0) {
    throw new PopgaApiContractError('팝가 목록 API가 항목은 있다고 했지만 page.size가 0입니다.');
  }
  if (expectedPage !== undefined && page.number !== expectedPage) {
    throw new PopgaApiContractError(
      `팝가 목록 API 페이지 불일치 (요청=${expectedPage}, 응답=${page.number})`,
    );
  }
  if (page.totalPages > MAX_PAGE_COUNT) {
    throw new PopgaApiContractError(
      `팝가 목록 API 페이지 수가 안전 한도(${MAX_PAGE_COUNT})를 넘었습니다: ${page.totalPages}`,
    );
  }
  if (page.totalElements > 0 && data.content.length === 0) {
    throw new PopgaApiContractError(
      `팝가 목록 API가 ${page.totalElements}건을 보고했지만 page=${page.number}가 비어 있습니다.`,
    );
  }
  if (data.content.length > page.size) {
    throw new PopgaApiContractError(
      `팝가 목록 API content(${data.content.length})가 page.size(${page.size})보다 큽니다.`,
    );
  }

  const content = data.content.map((item, index) => {
    if (!isRecord(item) || (typeof item.id !== 'string' && typeof item.id !== 'number')) {
      throw new PopgaApiContractError(`팝가 목록 page=${page.number}의 ${index + 1}번째 항목에 id가 없습니다.`);
    }
    if (typeof item.title !== 'string' || item.title.trim() === '') {
      throw new PopgaApiContractError(
        `팝가 목록 page=${page.number}의 id=${String(item.id)} 항목에 title이 없습니다.`,
      );
    }
    return item as PopgaSpot;
  });

  return { content, page };
}

export function parsePopgaDetailResponse(body: unknown, expectedId?: string | number): PopgaSpot {
  const data = assertSuccessfulEnvelope(body, '팝가 상세 API');
  if (typeof data.id !== 'string' && typeof data.id !== 'number') {
    throw new PopgaApiContractError('팝가 상세 API 응답에 id가 없습니다.');
  }
  if (typeof data.title !== 'string' || data.title.trim() === '') {
    throw new PopgaApiContractError(`팝가 상세 API id=${String(data.id)} 응답에 title이 없습니다.`);
  }
  if (expectedId !== undefined && String(data.id) !== String(expectedId)) {
    throw new PopgaApiContractError(
      `팝가 상세 API ID 불일치 (요청=${String(expectedId)}, 응답=${String(data.id)})`,
    );
  }
  return data as PopgaSpot;
}

export function buildPopgaListUrl(page: number, size = DEFAULT_PAGE_SIZE): string {
  const url = new URL(`${POPGA_API_BASE}/spots/search`);
  url.searchParams.set('periodTypes[0]', 'IN_PROGRESS');
  url.searchParams.set('periodTypes[1]', 'READY');
  url.searchParams.set('size', String(size));
  url.searchParams.set('sorts[0].order', 'activated_at');
  url.searchParams.set('page', String(page));
  return url.toString();
}

const defaultGet: PopgaHttpGet = (url, config) => axios.get(url, config);

// 목록은 등록이 활발해 순회 도중 총계·페이지 경계가 바뀌는 것이 정상 동작이다.
// 형태 위반(파싱 실패)은 여전히 즉시 실패하지만, 이런 동적 변동은 실패 대신
// 같은 런에서 한 번 더 순회해 합집합으로 수집한다(2026-07-15~ 5일 연속 전면 실패 교훈).
const MAX_LIST_CRAWLS = 2;

async function crawlPopgaListOnce(
  get: PopgaHttpGet,
  pageSize: number,
  pageDelayMs: number,
  byId: Map<string, PopgaSpot>,
): Promise<boolean> {
  const seenIds = new Set<string>();
  let drifted = false;
  let pageNumber = 0;
  let expectedTotal: number | null = null;
  let totalPages = 1;
  let collected = 0;

  do {
    const response = await get(buildPopgaListUrl(pageNumber, pageSize), {
      timeout: 15_000,
      headers: POPGA_API_HEADERS,
    });
    const parsed = parsePopgaListResponse(response.data, pageNumber);

    if (expectedTotal === null) {
      expectedTotal = parsed.page.totalElements;
      totalPages = parsed.page.totalPages;
    } else if (
      parsed.page.totalElements !== expectedTotal ||
      parsed.page.totalPages !== totalPages
    ) {
      console.warn(
        `[popga-collector] 목록 총계가 순회 중 변경됨 (${expectedTotal}→${parsed.page.totalElements}건, ` +
        `${totalPages}→${parsed.page.totalPages}p). 최신 값 기준으로 계속 진행합니다.`,
      );
      drifted = true;
      expectedTotal = parsed.page.totalElements;
      totalPages = parsed.page.totalPages;
    }

    for (const item of parsed.content) {
      const id = String(item.id);
      if (seenIds.has(id)) {
        // 순회 중 새 항목이 앞에 끼어들면 같은 항목이 두 페이지에 걸쳐 나온다 — 누락이 아니므로 건너뛴다.
        drifted = true;
        continue;
      }
      seenIds.add(id);
      byId.set(id, item);
      collected += 1;
    }

    console.log(
      `[popga-collector] 목록 page=${pageNumber + 1}/${totalPages}, 이번 ${parsed.content.length}건 (누계 ${byId.size}건)`,
    );

    pageNumber += 1;
    if (pageNumber < totalPages && pageDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, pageDelayMs));
    }
  } while (pageNumber < totalPages);

  const countDrift = (expectedTotal ?? 0) - collected;
  if (countDrift > MAX_REPORTED_COUNT_DRIFT) {
    console.warn(
      `[popga-collector] 목록 총계보다 ${countDrift}건 적게 수집됨 ` +
      `(API=${expectedTotal}, 수집=${collected}). 순회 중 목록 변동으로 보고 재순회를 검토합니다.`,
    );
    drifted = true;
  } else if (countDrift !== 0) {
    console.warn(
      `[popga-collector] 목록 총계와 수집 수의 경미한 오차 ` +
      `(API=${expectedTotal}, 수집=${collected}). Popga의 비공개 레코드 오차로 처리합니다.`,
    );
  }
  return drifted;
}

export async function fetchPopgaEventList(options: {
  get?: PopgaHttpGet;
  pageSize?: number;
  pageDelayMs?: number;
} = {}): Promise<PopgaSpot[]> {
  const get = options.get ?? defaultGet;
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const pageDelayMs = options.pageDelayMs ?? 300;

  const byId = new Map<string, PopgaSpot>();
  for (let attempt = 1; attempt <= MAX_LIST_CRAWLS; attempt += 1) {
    const drifted = await crawlPopgaListOnce(get, pageSize, pageDelayMs, byId);
    if (!drifted) break;
    if (attempt < MAX_LIST_CRAWLS) {
      console.warn(
        `[popga-collector] 순회 중 목록 변동 감지 — 누락 방지를 위해 한 번 더 순회합니다 (${attempt + 1}/${MAX_LIST_CRAWLS}).`,
      );
      if (pageDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, pageDelayMs));
      }
    } else {
      console.warn(
        `[popga-collector] 재순회 후에도 목록이 계속 변합니다. 지금까지 수집한 ${byId.size}건으로 진행합니다.`,
      );
    }
  }
  return [...byId.values()];
}

export async function fetchPopgaSpotDetail(
  popgaId: string | number,
  get: PopgaHttpGet = defaultGet,
): Promise<PopgaSpot> {
  const response = await get(`${POPGA_API_BASE}/spots/${encodeURIComponent(String(popgaId))}`, {
    timeout: 15_000,
    headers: POPGA_API_HEADERS,
  });
  return parsePopgaDetailResponse(response.data, popgaId);
}
