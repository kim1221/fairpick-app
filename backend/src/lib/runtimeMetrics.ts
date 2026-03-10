/**
 * runtimeMetrics.ts
 *
 * Express 요청 지표를 in-memory 슬라이딩 윈도우로 수집합니다.
 * - 5분 / 1시간 버킷
 * - 응답시간, 5xx 에러율, 최근 에러 샘플
 *
 * 설계:
 * - 각 요청을 타임스탬프+지연시간+상태코드로 ring buffer에 기록
 * - 집계 시점에 오래된 항목을 필터링하여 슬라이딩 윈도우 구현
 * - 최대 6,000개 항목 유지 (1시간 동안 100 req/s 기준)
 */

export interface RequestRecord {
  ts: number;       // Unix ms
  ms: number;       // 응답시간 (ms)
  status: number;   // HTTP 상태 코드
  method: string;   // GET/POST/...
  path: string;     // /events, /admin/... (URL 파라미터 제거)
}

export interface ErrorSample {
  ts: number;
  status: number;
  method: string;
  path: string;
  message?: string;
}

// ─────────────────────────────────────────────────────────────
// Ring Buffer
// ─────────────────────────────────────────────────────────────

const MAX_RECORDS = 6_000;
const records: RequestRecord[] = [];

const MAX_ERROR_SAMPLES = 20;
const errorSamples: ErrorSample[] = [];

export function recordRequest(rec: RequestRecord): void {
  records.push(rec);
  if (records.length > MAX_RECORDS) {
    records.splice(0, records.length - MAX_RECORDS);
  }

  if (rec.status >= 500) {
    errorSamples.push({
      ts:     rec.ts,
      status: rec.status,
      method: rec.method,
      path:   rec.path,
    });
    if (errorSamples.length > MAX_ERROR_SAMPLES) {
      errorSamples.splice(0, errorSamples.length - MAX_ERROR_SAMPLES);
    }
  }
}

export function addErrorSampleMessage(path: string, message: string): void {
  // findLast는 ES2023+에서만 지원 — 역방향 순회로 대체
  for (let i = errorSamples.length - 1; i >= 0; i--) {
    const s = errorSamples[i];
    if (s.path === path && !s.message) {
      s.message = message.slice(0, 200);
      break;
    }
  }
}

// ─────────────────────────────────────────────────────────────
// 집계
// ─────────────────────────────────────────────────────────────

export interface WindowMetrics {
  totalRequests: number;
  errors5xx: number;
  error5xxRate: number;      // 0-100 (%)
  avgResponseMs: number | null;
  p95ResponseMs: number | null;
}

function windowMetrics(windowMs: number): WindowMetrics {
  const cutoff = Date.now() - windowMs;
  const window = records.filter((r) => r.ts >= cutoff);

  const totalRequests = window.length;
  const errors5xx = window.filter((r) => r.status >= 500).length;
  const error5xxRate = totalRequests > 0 ? (errors5xx / totalRequests) * 100 : 0;

  if (totalRequests === 0) {
    return { totalRequests: 0, errors5xx: 0, error5xxRate: 0, avgResponseMs: null, p95ResponseMs: null };
  }

  const sortedMs = window.map((r) => r.ms).sort((a, b) => a - b);
  const avgResponseMs = Math.round(sortedMs.reduce((s, v) => s + v, 0) / sortedMs.length);
  const p95ResponseMs = sortedMs[Math.floor(sortedMs.length * 0.95)] ?? null;

  return { totalRequests, errors5xx, error5xxRate: Math.round(error5xxRate * 10) / 10, avgResponseMs, p95ResponseMs };
}

export interface RuntimeMetrics {
  window5m: WindowMetrics;
  window1h: WindowMetrics;
  recentErrors: ErrorSample[];
  lastErrorAt: string | null;
}

export function getRuntimeMetrics(): RuntimeMetrics {
  const recentErrors = [...errorSamples].reverse();
  const lastError = recentErrors[0];

  return {
    window5m: windowMetrics(5 * 60 * 1000),
    window1h: windowMetrics(60 * 60 * 1000),
    recentErrors: recentErrors.slice(0, 10),
    lastErrorAt: lastError ? new Date(lastError.ts).toISOString() : null,
  };
}
