/**
 * Fairpick Admin — 운영 센터 타입
 *
 * 2차 구현 시 JobStep, FailedItem은 API 실제 응답에 맞춰 확장
 */

// ── Job 상태 ─────────────────────────────────────────────────────────────────

export type JobStatus =
  | 'success'         // 완전 성공 (failed_count === 0)
  | 'partial_success' // 일부 실패 (failed_count > 0)
  | 'failed'          // 전체 실패
  | 'running'         // 현재 실행 중
  | 'stale'           // 예상 주기 대비 오래됨
  | 'never_run';      // 실행 기록 없음

// ── 실행 단계 (2차 확장용) ────────────────────────────────────────────────────

export interface JobStep {
  name: string;
  status: 'success' | 'failed' | 'skipped';
  count: number;
  durationMs: number | null;
  detail: string | null;
}

// ── 실패 항목 (2차 확장용) ────────────────────────────────────────────────────

export interface FailedItem {
  id: string;
  title: string;
  reason: string;
  eventId: string | null;
}

// ── 상세 메트릭 (2차 확장) ────────────────────────────────────────────────────

export interface ExecutionMetrics {
  created: number;
  updated: number;
  deleted: number;
  skipped: number;
  enriched: number;
  embedded: number;
}

// ── Job 실행 요청 결과 ─────────────────────────────────────────────────────────

export interface RunJobResult {
  success: boolean;
  message: string;
  jobName: string;
  startedAt: string;
}

// ── 실행 기록 ─────────────────────────────────────────────────────────────────

export interface JobExecution {
  id: string;
  jobName: string;
  jobLabel: string;
  status: JobStatus;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  totalCount: number;
  successCount: number;
  failedCount: number;
  skippedCount: number;
  summary: string | null;
  errorMessage: string | null;
  // 상세 정보
  steps: JobStep[];
  failedItems: FailedItem[];
  // 2차: 상세 메트릭 (API 연동 후 채워짐)
  metrics?: Partial<ExecutionMetrics>;
}

// ── 스케줄러 Job 정의 ─────────────────────────────────────────────────────────

export interface SchedulerJob {
  /** log type 또는 job 내부 식별자 */
  name: string;
  /** 화면에 표시되는 이름 */
  label: string;
  /** 한 줄 설명 */
  description: string;
  /** 스케줄 문자열 (표시용) */
  schedule: string;
  /** KST 기준 시 (0-23) — 타임라인 정렬용 */
  scheduleHour: number;
  /** KST 기준 분 (0-59) */
  scheduleMinute: number;
  /** null = 매일, 0-6 = 특정 요일 (0=일) */
  scheduleDayOfWeek: number | null;
  /** stale 판정 기준: 마지막 실행 후 이 시간(h) 이상 경과하면 stale */
  expectedIntervalHours: number;
  /** 가장 최근 실행 기록 (없으면 null) */
  lastExecution: JobExecution | null;
  /** 현재 실행 중 여부 */
  isRunning: boolean;
}

// ── 시스템 전체 상태 ──────────────────────────────────────────────────────────

export interface OpsSystemStatus {
  overall: 'healthy' | 'warning' | 'error';
  totalJobs: number;
  healthyJobs: number;
  warningJobs: number;
  failedJobs: number;
  lastPipelineRun: string | null;
  lastPipelineStatus: JobStatus | null;
}
