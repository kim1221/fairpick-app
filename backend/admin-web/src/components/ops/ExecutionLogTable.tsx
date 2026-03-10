import type { CollectionLog } from '../../types';
import type { JobExecution } from '../../types/ops';
import { mapLogToExecution } from '../../services/opsApi';
import JobStatusBadge from './JobStatusBadge';

interface ExecutionLogTableProps {
  logs: CollectionLog[];
  /** true = 대시보드 미리보기 (6행 제한) */
  preview?: boolean;
  /** 행 클릭 시 상세 패널 열기 */
  onSelectExecution?: (execution: JobExecution) => void;
}

function fmtDuration(ms: number | null): string {
  if (ms === null || ms < 0) return '—';
  if (ms < 1_000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
}

export default function ExecutionLogTable({
  logs,
  preview = false,
  onSelectExecution,
}: ExecutionLogTableProps) {
  const displayLogs = preview ? logs.slice(0, 6) : logs;
  const clickable = !!onSelectExecution;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 border-b border-gray-200">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">시간</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">소스</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">타입</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">상태</th>
            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">항목</th>
            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">성공</th>
            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">실패</th>
            <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">소요</th>
            {clickable && <th className="w-6" />}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {displayLogs.length > 0 ? (
            displayLogs.map((log) => {
              const exec = mapLogToExecution(log);
              const isWarn = exec.status === 'partial_success' || exec.status === 'failed';
              return (
                <tr
                  key={log.id}
                  onClick={() => onSelectExecution?.(exec)}
                  className={`transition-colors ${
                    clickable ? 'cursor-pointer hover:bg-primary-50' : 'hover:bg-gray-50'
                  } ${isWarn ? 'bg-red-50/40' : ''}`}
                >
                  <td className="px-4 py-3 text-gray-700 whitespace-nowrap font-mono text-xs">
                    {new Date(log.started_at).toLocaleString('ko-KR', {
                      month: '2-digit',
                      day: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </td>
                  <td className="px-4 py-3 text-gray-900 font-medium">{log.source || '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{log.type || '—'}</td>
                  <td className="px-4 py-3">
                    <JobStatusBadge status={exec.status} size="sm" />
                  </td>
                  <td className="px-4 py-3 text-right text-gray-700 tabular-nums">
                    {(log.items_count ?? 0).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right text-green-700 tabular-nums">
                    {(log.success_count ?? 0).toLocaleString()}
                  </td>
                  <td className={`px-4 py-3 text-right tabular-nums ${
                    (log.failed_count ?? 0) > 0 ? 'text-red-600 font-semibold' : 'text-gray-400'
                  }`}>
                    {(log.failed_count ?? 0).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-500 font-mono text-xs">
                    {fmtDuration(exec.durationMs)}
                  </td>
                  {clickable && (
                    <td className="px-2 py-3 text-gray-300 text-base">›</td>
                  )}
                </tr>
              );
            })
          ) : (
            <tr>
              <td
                colSpan={clickable ? 9 : 8}
                className="px-4 py-8 text-center text-gray-400"
              >
                실행 기록이 없습니다
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
