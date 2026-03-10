import type { JobStatus } from '../../types/ops';

const STATUS_CONFIG: Record<JobStatus, { label: string; className: string; icon: string }> = {
  success:        { label: '성공',    className: 'bg-green-100 text-green-800',                 icon: '✓' },
  partial_success:{ label: '부분 성공', className: 'bg-yellow-100 text-yellow-800',              icon: '⚠' },
  failed:         { label: '실패',    className: 'bg-red-100 text-red-800',                    icon: '✕' },
  running:        { label: '실행 중', className: 'bg-blue-100 text-blue-800 animate-pulse',    icon: '▶' },
  stale:          { label: '지연',    className: 'bg-orange-100 text-orange-800',               icon: '⏱' },
  never_run:      { label: '미실행',  className: 'bg-gray-100 text-gray-500',                  icon: '—' },
};

interface JobStatusBadgeProps {
  status: JobStatus;
  size?: 'sm' | 'md';
}

export default function JobStatusBadge({ status, size = 'md' }: JobStatusBadgeProps) {
  const cfg = STATUS_CONFIG[status];
  const sizeClass = size === 'sm' ? 'text-xs px-2 py-0.5' : 'text-sm px-2.5 py-1';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-medium ${sizeClass} ${cfg.className}`}
    >
      <span>{cfg.icon}</span>
      {cfg.label}
    </span>
  );
}
