import { Link } from 'react-router-dom';
import type { SchedulerJob } from '../../types/ops';

const STATUS_DOT: Record<string, string> = {
  success:         'bg-green-500',
  partial_success: 'bg-yellow-500',
  failed:          'bg-red-500',
  running:         'bg-blue-500 animate-pulse',
  stale:           'bg-orange-400',
  never_run:       'bg-gray-300',
};

interface ScheduleTimelineProps {
  jobs: SchedulerJob[];
}

export default function ScheduleTimeline({ jobs }: ScheduleTimelineProps) {
  const sorted = [...jobs].sort((a, b) => {
    if (a.scheduleHour !== b.scheduleHour) return a.scheduleHour - b.scheduleHour;
    return a.scheduleMinute - b.scheduleMinute;
  });

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-gray-900">오늘 스케줄</h3>
        <Link
          to="/ops"
          className="text-sm text-primary-600 hover:text-primary-700 font-medium"
        >
          운영 센터 →
        </Link>
      </div>
      <div className="flex gap-2.5 overflow-x-auto pb-2">
        {sorted.map((job) => {
          const status = job.lastExecution?.status ?? 'never_run';
          const dotClass = STATUS_DOT[status] ?? STATUS_DOT.never_run;
          const timeStr = `${String(job.scheduleHour).padStart(2, '0')}:${String(job.scheduleMinute).padStart(2, '0')}`;
          return (
            <div
              key={job.name}
              className="flex-shrink-0 w-[7rem] border border-gray-200 rounded-lg p-2.5 bg-white hover:border-primary-300 transition-colors"
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] font-mono text-gray-400">{timeStr}</span>
                <span className={`w-2 h-2 rounded-full shrink-0 ${dotClass}`} />
              </div>
              <div className="text-xs font-medium text-gray-800 leading-snug">
                {job.label}
              </div>
              {job.scheduleDayOfWeek !== null && (
                <div className="text-[10px] text-gray-400 mt-1">월요일만</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
