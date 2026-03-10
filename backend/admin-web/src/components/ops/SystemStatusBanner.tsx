import type { OpsSystemStatus } from '../../types/ops';

const BANNER_CONFIG = {
  healthy: {
    bg: 'bg-green-50 border-green-200',
    icon: '✅',
    title: '모든 시스템 정상',
    titleColor: 'text-green-800',
    subColor: 'text-green-600',
    monoColor: 'text-green-500',
  },
  warning: {
    bg: 'bg-yellow-50 border-yellow-200',
    icon: '⚠️',
    title: '일부 주의 필요',
    titleColor: 'text-yellow-800',
    subColor: 'text-yellow-700',
    monoColor: 'text-yellow-600',
  },
  error: {
    bg: 'bg-red-50 border-red-200',
    icon: '🚨',
    title: '장애 감지됨',
    titleColor: 'text-red-800',
    subColor: 'text-red-700',
    monoColor: 'text-red-500',
  },
} as const;

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  if (h >= 24) return `${Math.floor(h / 24)}일 전`;
  if (h > 0) return `${h}시간 ${m}분 전`;
  return `${m}분 전`;
}

interface SystemStatusBannerProps {
  status: OpsSystemStatus;
}

export default function SystemStatusBanner({ status }: SystemStatusBannerProps) {
  const cfg = BANNER_CONFIG[status.overall];
  return (
    <div className={`border rounded-xl px-5 py-4 flex items-center justify-between gap-4 ${cfg.bg}`}>
      <div className="flex items-center gap-3">
        <span className="text-2xl leading-none">{cfg.icon}</span>
        <div>
          <div className={`font-semibold text-base leading-tight ${cfg.titleColor}`}>
            {cfg.title}
          </div>
          <div className={`text-sm mt-0.5 ${cfg.subColor}`}>
            <span>{status.healthyJobs}/{status.totalJobs} 정상</span>
            {status.warningJobs > 0 && <span> · {status.warningJobs} 주의</span>}
            {status.failedJobs > 0 && <span> · {status.failedJobs} 실패</span>}
            {status.lastPipelineRun ? (
              <span> · 마지막 파이프라인 {formatRelativeTime(status.lastPipelineRun)}</span>
            ) : (
              <span> · 파이프라인 실행 기록 없음</span>
            )}
          </div>
        </div>
      </div>
      {status.lastPipelineRun && (
        <div className={`text-xs font-mono shrink-0 ${cfg.monoColor}`}>
          {new Date(status.lastPipelineRun).toLocaleString('ko-KR')}
        </div>
      )}
    </div>
  );
}
