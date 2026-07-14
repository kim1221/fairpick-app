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

export async function fetchPopgaEventList(options: {
  get?: PopgaHttpGet;
  pageSize?: number;
  pageDelayMs?: number;
} = {}): Promise<PopgaSpot[]> {
  const get = options.get ?? defaultGet;
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const pageDelayMs = options.pageDelayMs ?? 300;
  const all: PopgaSpot[] = [];
  const seenIds = new Set<string>();
  let pageNumber = 0;
  let expectedTotal: number | null = null;
  let totalPages = 1;

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
      throw new PopgaApiContractError(
        '팝가 목록이 페이지 순회 중 변경되었습니다. 누락 방지를 위해 다음 실행에서 다시 시도합니다.',
      );
    }

    for (const item of parsed.content) {
      const id = String(item.id);
      if (seenIds.has(id)) {
        throw new PopgaApiContractError(
          `팝가 목록에 id=${id}가 여러 페이지에서 반복됐습니다. 누락 방지를 위해 중단합니다.`,
        );
      }
      seenIds.add(id);
      all.push(item);
    }

    console.log(
      `[popga-collector] 목록 page=${pageNumber + 1}/${totalPages}, 이번 ${parsed.content.length}건 (누계 ${all.length}건)`,
    );

    pageNumber += 1;
    if (pageNumber < totalPages && pageDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, pageDelayMs));
    }
  } while (pageNumber < totalPages);

  const countDrift = (expectedTotal ?? 0) - all.length;
  if (countDrift !== 0 && countDrift <= MAX_REPORTED_COUNT_DRIFT && countDrift > 0) {
    console.warn(
      `[popga-collector] 목록 총계가 content보다 ${countDrift}건 큽니다 ` +
      `(API=${expectedTotal}, 수집=${all.length}). Popga의 비공개 레코드 오차로 처리합니다.`,
    );
  } else if (countDrift !== 0) {
    throw new PopgaApiContractError(
      `팝가 목록 총계 불일치 (API=${expectedTotal ?? 'unknown'}, 수집=${all.length})`,
    );
  }
  return all;
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
