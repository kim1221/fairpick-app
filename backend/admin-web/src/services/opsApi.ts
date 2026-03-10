import api from './api';
import type { CollectionLog } from '../types';
import type { JobExecution, JobStatus, OpsSystemStatus, RunJobResult, SchedulerJob } from '../types/ops';

// ──────────────────────────────────────────────────────────────
// Static scheduler job definitions (mirrors backend/src/scheduler.ts)
// ──────────────────────────────────────────────────────────────

interface StaticJobDef {
  name: string;
  label: string;
  description: string;
  schedule: string;
  scheduleHour: number;
  scheduleMinute: number;
  scheduleDayOfWeek: number | null;
  expectedIntervalHours: number;
  /** log source/type 키워드 — 로그 매칭에 사용 */
  sourceKeywords: string[];
}

const STATIC_JOB_DEFS: StaticJobDef[] = [
  {
    name: 'cleanup',
    label: '정리 작업',
    description: 'Auto-unfeature · Soft delete',
    schedule: '매일 01:00',
    scheduleHour: 1,
    scheduleMinute: 0,
    scheduleDayOfWeek: null,
    expectedIntervalHours: 24,
    sourceKeywords: ['cleanup', 'auto-unfeature'],
  },
  {
    name: 'metadata',
    label: '메타데이터 업데이트',
    description: 'is_ending_soon · popularity_score',
    schedule: '매일 02:00',
    scheduleHour: 2,
    scheduleMinute: 0,
    scheduleDayOfWeek: null,
    expectedIntervalHours: 24,
    sourceKeywords: ['metadata', 'update-metadata'],
  },
  {
    name: 'auto-featured-score',
    label: '추천 점수 계산',
    description: 'featured_score 자동 계산',
    schedule: '매일 02:15',
    scheduleHour: 2,
    scheduleMinute: 15,
    scheduleDayOfWeek: null,
    expectedIntervalHours: 24,
    sourceKeywords: ['featured-score', 'auto-featured'],
  },
  {
    name: 'buzz-score',
    label: 'Buzz Score',
    description: '사용자 행동 기반 인기도',
    schedule: '매일 02:30',
    scheduleHour: 2,
    scheduleMinute: 30,
    scheduleDayOfWeek: null,
    expectedIntervalHours: 24,
    sourceKeywords: ['buzz', 'buzz-score'],
  },
  {
    name: 'geo-refresh-03',
    label: '데이터 수집 파이프라인',
    description: 'KOPIS · Culture · TourAPI + AI',
    schedule: '매일 03:00',
    scheduleHour: 3,
    scheduleMinute: 0,
    scheduleDayOfWeek: null,
    expectedIntervalHours: 24,
    sourceKeywords: ['geo-refresh', 'kopis', 'cultural', 'tour', 'collect', 'geoRefresh'],
  },
  {
    name: 'price-info',
    label: '가격 정보 백필',
    description: 'API payload에서 가격 추출',
    schedule: '매일 03:30',
    scheduleHour: 3,
    scheduleMinute: 30,
    scheduleDayOfWeek: null,
    expectedIntervalHours: 24,
    sourceKeywords: ['price', 'price-info'],
  },
  {
    name: 'phase2-internal-fields',
    label: 'Internal Fields 생성',
    description: '추천 알고리즘용 metadata.internal',
    schedule: '매일 04:15',
    scheduleHour: 4,
    scheduleMinute: 15,
    scheduleDayOfWeek: null,
    expectedIntervalHours: 24,
    sourceKeywords: ['phase2', 'internal-fields', 'enrich-internal'],
  },
  {
    name: 'embed-new-events',
    label: '벡터 임베딩',
    description: '신규 이벤트 임베딩 생성',
    schedule: '매일 05:00',
    scheduleHour: 5,
    scheduleMinute: 0,
    scheduleDayOfWeek: null,
    expectedIntervalHours: 24,
    sourceKeywords: ['embed', 'embedding'],
  },
  {
    name: 'ai-popup-discovery',
    label: 'AI 팝업 발굴',
    description: '팝업 신규 발굴 + DB 중복 체크',
    schedule: '매일 08:00',
    scheduleHour: 8,
    scheduleMinute: 0,
    scheduleDayOfWeek: null,
    expectedIntervalHours: 24,
    sourceKeywords: ['popup-discovery', 'ai-popup'],
  },
  {
    name: 'end-soon-notifications',
    label: '종료 알림 발송',
    description: '찜한 이벤트 D-3 알림',
    schedule: '매일 09:00',
    scheduleHour: 9,
    scheduleMinute: 0,
    scheduleDayOfWeek: null,
    expectedIntervalHours: 24,
    sourceKeywords: ['end-soon', 'notification'],
  },
  {
    name: 'ai-hot-rating',
    label: 'AI Hot Rating',
    description: '전시/공연/축제 핫함 평가',
    schedule: '매주 월 09:00',
    scheduleHour: 9,
    scheduleMinute: 0,
    scheduleDayOfWeek: 1,
    expectedIntervalHours: 168,
    sourceKeywords: ['hot-rating', 'ai-hot'],
  },
  {
    name: 'collect-15',
    label: '오후 경량 수집',
    description: '수집 + 중복제거 (geo/AI 생략)',
    schedule: '매일 15:00',
    scheduleHour: 15,
    scheduleMinute: 0,
    scheduleDayOfWeek: null,
    expectedIntervalHours: 24,
    sourceKeywords: ['collect-15', 'light-collect'],
  },
];

// ──────────────────────────────────────────────────────────────
// Adapter: CollectionLog → JobExecution
// ──────────────────────────────────────────────────────────────

function deriveJobStatus(log: CollectionLog): JobStatus {
  if (log.status === 'running') return 'running';
  if (log.status === 'failed') return 'failed';
  if (log.status === 'partial') return 'partial_success';  // collect/index.ts 호환
  if (log.status === 'success') {
    return (log.failed_count ?? 0) > 0 ? 'partial_success' : 'success';
  }
  return 'failed';
}

export function mapLogToExecution(log: CollectionLog): JobExecution {
  const endedAt = log.completed_at ?? null;
  const durationMs =
    endedAt
      ? new Date(endedAt).getTime() - new Date(log.started_at).getTime()
      : null;

  const jobName = log.scheduler_job_name ?? log.source ?? log.type ?? 'unknown';

  return {
    id: log.id,
    jobName,
    jobLabel: log.scheduler_job_name ?? [log.source, log.type].filter(Boolean).join(' · '),
    status: deriveJobStatus(log),
    startedAt: log.started_at,
    endedAt,
    durationMs,
    totalCount: log.items_count ?? 0,
    successCount: log.success_count ?? 0,
    failedCount: log.failed_count ?? 0,
    skippedCount: log.skipped_count ?? 0,
    summary: null,
    errorMessage: log.error_message ?? null,
    steps: [],
    failedItems: [],
  };
}

// ──────────────────────────────────────────────────────────────
// Matcher: find most recent log matching a job definition
// ──────────────────────────────────────────────────────────────

function findLatestLogForJob(
  jobDef: StaticJobDef,
  logs: CollectionLog[]
): CollectionLog | null {
  const byTime = (a: CollectionLog, b: CollectionLog) =>
    new Date(b.started_at).getTime() - new Date(a.started_at).getTime();

  // 1순위: scheduler_job_name exact match (geo-refresh-03/collect-15 충돌 방지)
  const byName = logs.filter((log) => log.scheduler_job_name === jobDef.name);
  if (byName.length > 0) return byName.sort(byTime)[0];

  // 2순위: 레거시 로그 — source+type keyword match
  const keywords = jobDef.sourceKeywords.map((k) => k.toLowerCase());
  const byKeyword = logs.filter((log) => {
    const haystack = `${log.source ?? ''} ${log.type ?? ''}`.toLowerCase();
    return keywords.some((kw) => haystack.includes(kw));
  });
  return byKeyword.sort(byTime)[0] ?? null;
}

// ──────────────────────────────────────────────────────────────
// Stale detection
// ──────────────────────────────────────────────────────────────

function resolveEffectiveStatus(
  jobDef: StaticJobDef,
  lastLog: CollectionLog | null
): JobStatus {
  if (!lastLog) return 'never_run';
  if (lastLog.status === 'running') return 'running';

  const ageMs = Date.now() - new Date(lastLog.started_at).getTime();
  const thresholdMs = jobDef.expectedIntervalHours * 2 * 60 * 60 * 1000;
  if (ageMs > thresholdMs) return 'stale';

  return deriveJobStatus(lastLog);
}

// ──────────────────────────────────────────────────────────────
// Main: merge static job defs with live log data
// ──────────────────────────────────────────────────────────────

export function mergeJobsWithLogs(logs: CollectionLog[], currentlyRunning: string[] = []): SchedulerJob[] {
  const runningSet = new Set(currentlyRunning);
  return STATIC_JOB_DEFS.map((def) => {
    const lastLog = findLatestLogForJob(def, logs);
    const lastExecution = lastLog ? mapLogToExecution(lastLog) : null;
    const effectiveStatus = resolveEffectiveStatus(def, lastLog);

    if (lastExecution && effectiveStatus === 'stale') {
      lastExecution.status = 'stale';
    }

    // 서버 메모리(runningJobs Set) 기준 override — DB 반영 지연 보정
    const isRunning = runningSet.has(def.name) || effectiveStatus === 'running';
    if (isRunning && lastExecution && lastExecution.status !== 'running') {
      lastExecution.status = 'running';
    }

    return {
      name: def.name,
      label: def.label,
      description: def.description,
      schedule: def.schedule,
      scheduleHour: def.scheduleHour,
      scheduleMinute: def.scheduleMinute,
      scheduleDayOfWeek: def.scheduleDayOfWeek,
      expectedIntervalHours: def.expectedIntervalHours,
      lastExecution,
      isRunning,
    };
  });
}

// ──────────────────────────────────────────────────────────────
// System status aggregation
// ──────────────────────────────────────────────────────────────

export function deriveSystemStatus(jobs: SchedulerJob[]): OpsSystemStatus {
  let healthyJobs = 0;
  let warningJobs = 0;
  let failedJobs = 0;

  for (const job of jobs) {
    const status = job.lastExecution?.status ?? 'never_run';
    if (status === 'success') {
      healthyJobs++;
    } else if (status === 'partial_success' || status === 'stale' || status === 'running') {
      warningJobs++;
    } else {
      failedJobs++; // failed, never_run
    }
  }

  let overall: 'healthy' | 'warning' | 'error';
  if (failedJobs > 0) overall = 'error';
  else if (warningJobs > 0) overall = 'warning';
  else overall = 'healthy';

  const pipelineJob = jobs.find((j) => j.name === 'geo-refresh-03');

  return {
    overall,
    totalJobs: jobs.length,
    healthyJobs,
    warningJobs,
    failedJobs,
    lastPipelineRun: pipelineJob?.lastExecution?.startedAt ?? null,
    lastPipelineStatus: pipelineJob?.lastExecution?.status ?? null,
  };
}

// ──────────────────────────────────────────────────────────────
// 원격 API 함수
// ──────────────────────────────────────────────────────────────

/**
 * 실행 상세 조회 — GET /admin/ops/executions/:logId
 */
export async function getExecutionDetail(logId: string): Promise<JobExecution | null> {
  try {
    const res = await api.get<JobExecution>(`/admin/ops/executions/${logId}`);
    return res.data;
  } catch (err: unknown) {
    const status = (err as { response?: { status: number } }).response?.status;
    if (status === 404) return null;
    throw err;
  }
}

/**
 * 잡 즉시 실행 — POST /admin/ops/jobs/:jobName/run
 */
export async function runJobNow(jobName: string): Promise<RunJobResult> {
  const res = await api.post<RunJobResult>(`/admin/ops/jobs/${jobName}/run`);
  return res.data;
}

/**
 * 실행 재시도 — POST /admin/ops/executions/:logId/retry (stub)
 */
export async function retryExecution(logId: string): Promise<RunJobResult> {
  const res = await api.post<RunJobResult>(`/admin/ops/executions/${logId}/retry`);
  return res.data;
}
