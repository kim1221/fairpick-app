import type { JobStep } from '../../types/ops';

const STEP_ICON: Record<JobStep['status'], string> = {
  success: '✓',
  failed:  '✕',
  skipped: '○',
};

const STEP_COLOR: Record<JobStep['status'], string> = {
  success: 'text-green-600',
  failed:  'text-red-500',
  skipped: 'text-gray-400',
};

function fmtMs(ms: number | null): string {
  if (!ms || ms <= 0) return '';
  if (ms < 1_000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
}

interface JobStepListProps {
  steps: JobStep[];
}

export default function JobStepList({ steps }: JobStepListProps) {
  if (steps.length === 0) {
    return <p className="text-xs text-gray-400 py-3 text-center">단계 정보 없음</p>;
  }

  return (
    <ul className="space-y-2">
      {steps.map((step, i) => (
        <li key={i} className="flex items-start gap-3 text-sm">
          <span className={`mt-0.5 w-4 shrink-0 font-mono ${STEP_COLOR[step.status]}`}>
            {STEP_ICON[step.status]}
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span className={`font-medium ${STEP_COLOR[step.status]}`}>{step.name}</span>
              <div className="flex items-center gap-2 shrink-0 text-xs text-gray-400 font-mono">
                {step.count > 0 && <span>{step.count.toLocaleString()}건</span>}
                {step.durationMs != null && <span>{fmtMs(step.durationMs)}</span>}
              </div>
            </div>
            {step.detail && (
              <p className="text-xs text-gray-500 mt-0.5 leading-snug">{step.detail}</p>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
