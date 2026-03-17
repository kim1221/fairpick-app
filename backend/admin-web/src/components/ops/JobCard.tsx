import type { SchedulerJob } from '../../types/ops';
import JobStatusBadge from './JobStatusBadge';
import RunNowButton from './RunNowButton';
import { fmtRelative } from '../../utils/time';

const BORDER_LEFT: Record<string, string> = {
  success:         'border-l-green-500',
  partial_success: 'border-l-yellow-500',
  failed:          'border-l-red-500',
  running:         'border-l-blue-500',
  stale:           'border-l-orange-400',
  never_run:       'border-l-gray-300',
};

/** stale / failed 잡은 카드 배경을 살짝 강조 */
const BG_HIGHLIGHT: Record<string, string> = {
  failed: 'bg-red-50',
  stale:  'bg-orange-50',
};

function fmtDuration(ms: number | null): string {
  if (!ms || ms <= 0) return '—';
  if (ms < 60_000) return `${(ms / 1000).toFixed(0)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
}


interface JobCardProps {
  job: SchedulerJob;
  onOpenDetail?: (job: SchedulerJob) => void;
  onRunNow?: (jobName: string) => Promise<void>;
}

export default function JobCard({ job, onOpenDetail, onRunNow }: JobCardProps) {
  const status = job.lastExecution?.status ?? 'never_run';
  const borderClass = BORDER_LEFT[status] ?? BORDER_LEFT.never_run;
  const bgClass = BG_HIGHLIGHT[status] ?? '';

  return (
    <div
      className={`card border-l-4 ${borderClass} ${bgClass} flex flex-col gap-3 transition-shadow hover:shadow-md`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-semibold text-gray-900 text-sm truncate">{job.label}</div>
          <div className="text-xs text-gray-500 mt-0.5 leading-snug">{job.description}</div>
        </div>
        <div className="shrink-0">
          <JobStatusBadge status={status} size="sm" />
        </div>
      </div>

      {/* Schedule */}
      <div className="text-xs text-gray-500 flex items-center gap-2">
        <span className="font-mono bg-gray-100 px-1.5 py-0.5 rounded">{job.schedule}</span>
        {job.scheduleDayOfWeek !== null && (
          <span className="text-gray-400">월요일만</span>
        )}
      </div>

      {/* Counts */}
      {job.lastExecution ? (
        <div className="grid grid-cols-3 gap-1 text-center bg-white/70 rounded-lg p-2 border border-gray-100">
          <div>
            <div className="text-[10px] text-gray-400">항목</div>
            <div className="text-sm font-semibold text-gray-700 tabular-nums">
              {job.lastExecution.totalCount.toLocaleString()}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-gray-400">성공</div>
            <div className="text-sm font-semibold text-green-600 tabular-nums">
              {job.lastExecution.successCount.toLocaleString()}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-gray-400">실패</div>
            <div
              className={`text-sm font-semibold tabular-nums ${
                job.lastExecution.failedCount > 0 ? 'text-red-500' : 'text-gray-400'
              }`}
            >
              {job.lastExecution.failedCount.toLocaleString()}
            </div>
          </div>
        </div>
      ) : (
        <div className="text-xs text-gray-400 text-center py-2 bg-gray-50 rounded-lg">
          실행 기록 없음
        </div>
      )}

      {/* Timestamp */}
      <div className="flex justify-between items-center text-xs text-gray-400">
        <span>마지막: {fmtRelative(job.lastExecution?.startedAt ?? null)}</span>
        {job.lastExecution?.durationMs != null && (
          <span className="font-mono">{fmtDuration(job.lastExecution.durationMs)}</span>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between pt-1 border-t border-gray-100 mt-auto">
        <button
          onClick={() => onOpenDetail?.(job)}
          className="text-xs text-primary-600 hover:text-primary-700 font-medium transition-colors"
        >
          상세 보기 →
        </button>
        {onRunNow && (
          <RunNowButton
            jobName={job.name}
            jobLabel={job.label}
            onRun={onRunNow}
            disabled={job.isRunning}
            variant="ghost"
          />
        )}
      </div>
    </div>
  );
}
