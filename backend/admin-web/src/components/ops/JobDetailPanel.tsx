import { useState } from 'react';
import type { SchedulerJob } from '../../types/ops';
import JobStatusBadge from './JobStatusBadge';
import JobMetricRow from './JobMetricRow';
import JobStepList from './JobStepList';
import RunNowButton from './RunNowButton';

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function fmtDuration(ms: number | null): string {
  if (!ms || ms <= 0) return '—';
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
}

interface JobDetailPanelProps {
  open: boolean;
  onClose: () => void;
  job: SchedulerJob | null;
  onRunNow?: (jobName: string) => Promise<void>;
}

export default function JobDetailPanel({
  open,
  onClose,
  job,
  onRunNow,
}: JobDetailPanelProps) {
  const execution = job?.lastExecution ?? null;
  const [copied, setCopied] = useState(false);

  const handleCopyLog = () => {
    if (!execution || !job) return;
    const lines = [
      `Job:      ${job.label}`,
      `Schedule: ${job.schedule}`,
      `Status:   ${execution.status}`,
      `Started:  ${fmtDateTime(execution.startedAt)}`,
      `Ended:    ${fmtDateTime(execution.endedAt)}`,
      `Duration: ${fmtDuration(execution.durationMs)}`,
      `Total: ${execution.totalCount}  Success: ${execution.successCount}  Failed: ${execution.failedCount}  Skipped: ${execution.skippedCount}`,
      execution.summary ? `Summary: ${execution.summary}` : null,
      execution.errorMessage ? `Error: ${execution.errorMessage}` : null,
    ].filter(Boolean);
    navigator.clipboard.writeText(lines.join('\n')).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  };

  return (
    <>
      {/* Dim overlay */}
      <div
        className={`fixed inset-0 bg-black/20 z-40 transition-opacity duration-300 ${
          open ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
      />

      {/* Slide panel */}
      <div
        className={`fixed inset-y-0 right-0 w-[480px] max-w-full bg-white shadow-2xl z-50 flex flex-col
          transition-transform duration-300 ease-out
          ${open ? 'translate-x-0' : 'translate-x-full'}`}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-5 border-b border-gray-200 shrink-0">
          <div className="min-w-0">
            <div className="font-semibold text-gray-900 text-base truncate">
              {job?.label ?? '실행 상세'}
            </div>
            {job?.description && (
              <div className="text-xs text-gray-500 mt-0.5">{job.description}</div>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="닫기"
            className="ml-4 shrink-0 text-gray-400 hover:text-gray-700 transition-colors text-2xl leading-none -mr-1 -mt-1"
          >
            ×
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto">
          {!execution ? (
            <div className="flex items-center justify-center h-48 text-sm text-gray-400">
              실행 기록이 없습니다
            </div>
          ) : (
            <div className="px-6 py-5 space-y-5">

              {/* Status + schedule */}
              <div className="flex items-center justify-between gap-3">
                <JobStatusBadge status={execution.status} />
                {job && (
                  <span className="text-xs font-mono text-gray-400 bg-gray-100 px-2 py-1 rounded">
                    {job.schedule}
                  </span>
                )}
              </div>

              {/* Timing grid */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-gray-50 rounded-lg p-3">
                  <div className="text-[10px] text-gray-400 uppercase mb-1">시작</div>
                  <div className="text-xs font-mono text-gray-700">
                    {fmtDateTime(execution.startedAt)}
                  </div>
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                  <div className="text-[10px] text-gray-400 uppercase mb-1">종료</div>
                  <div className="text-xs font-mono text-gray-700">
                    {fmtDateTime(execution.endedAt)}
                  </div>
                </div>
              </div>
              {execution.durationMs != null && (
                <p className="text-xs text-gray-500 text-right -mt-3">
                  소요:{' '}
                  <span className="font-mono font-medium">
                    {fmtDuration(execution.durationMs)}
                  </span>
                </p>
              )}

              {/* Metrics */}
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase mb-2">처리 결과</p>
                <JobMetricRow
                  items={[
                    { label: '전체',  value: execution.totalCount,   colorClass: 'text-gray-700' },
                    { label: '성공',  value: execution.successCount,  colorClass: 'text-green-600' },
                    { label: '실패',  value: execution.failedCount,   colorClass: execution.failedCount > 0 ? 'text-red-500' : 'text-gray-400' },
                    { label: '스킵',  value: execution.skippedCount,  colorClass: 'text-gray-400' },
                  ]}
                />
              </div>

              {/* Optional extra metrics */}
              {execution.metrics && Object.keys(execution.metrics).length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase mb-2">상세 메트릭</p>
                  <JobMetricRow
                    items={[
                      ...(execution.metrics.created   != null ? [{ label: '생성',    value: execution.metrics.created,   colorClass: 'text-blue-600' }] : []),
                      ...(execution.metrics.updated   != null ? [{ label: '업데이트', value: execution.metrics.updated,   colorClass: 'text-indigo-600' }] : []),
                      ...(execution.metrics.enriched  != null ? [{ label: 'AI보완',  value: execution.metrics.enriched,  colorClass: 'text-purple-600' }] : []),
                      ...(execution.metrics.embedded  != null ? [{ label: '임베딩',  value: execution.metrics.embedded,  colorClass: 'text-cyan-600' }] : []),
                      ...(execution.metrics.deleted   != null ? [{ label: '삭제',    value: execution.metrics.deleted,   colorClass: 'text-red-400' }] : []),
                    ]}
                  />
                </div>
              )}

              {/* Summary */}
              {execution.summary && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase mb-1.5">요약</p>
                  <div className="text-sm text-gray-700 bg-gray-50 rounded-lg px-3 py-2.5 leading-relaxed">
                    {execution.summary}
                  </div>
                </div>
              )}

              {/* Error */}
              {execution.errorMessage && (
                <div>
                  <p className="text-xs font-semibold text-red-500 uppercase mb-1.5">오류</p>
                  <pre className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 font-mono leading-relaxed whitespace-pre-wrap break-all">
                    {execution.errorMessage}
                  </pre>
                </div>
              )}

              {/* Steps */}
              {execution.steps.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase mb-2">실행 단계</p>
                  <JobStepList steps={execution.steps} />
                </div>
              )}

              {/* Failed items */}
              {execution.failedItems.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-red-500 uppercase mb-2">
                    실패 항목 ({execution.failedItems.length}건)
                  </p>
                  <ul className="space-y-1.5">
                    {execution.failedItems.slice(0, 20).map((item) => (
                      <li
                        key={item.id}
                        className="text-xs bg-red-50 border border-red-100 rounded px-3 py-2"
                      >
                        <div className="font-medium text-red-700 truncate">{item.title}</div>
                        <div className="text-red-500 mt-0.5">{item.reason}</div>
                      </li>
                    ))}
                    {execution.failedItems.length > 20 && (
                      <li className="text-xs text-gray-400 text-center py-1">
                        외 {execution.failedItems.length - 20}건 더 있음
                      </li>
                    )}
                  </ul>
                </div>
              )}

            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="shrink-0 border-t border-gray-200 px-6 py-4 flex items-center justify-between gap-3">
          <button
            onClick={handleCopyLog}
            disabled={!execution}
            className={`text-xs transition-colors disabled:opacity-30 flex items-center gap-1.5 ${
              copied ? 'text-green-600' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {copied ? '✓ 복사됨' : '📋 로그 복사'}
          </button>
          {job && onRunNow && (
            <RunNowButton
              jobName={job.name}
              jobLabel={job.label}
              onRun={onRunNow}
              disabled={job.isRunning}
            />
          )}
        </div>
      </div>
    </>
  );
}
