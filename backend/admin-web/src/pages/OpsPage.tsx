import { useState } from 'react';
import type { JobExecution, SchedulerJob } from '../types/ops';
import { useJobStatus } from '../hooks/useJobStatus';
import { runJobNow } from '../services/opsApi';
import SystemStatusBanner from '../components/ops/SystemStatusBanner';
import JobCard from '../components/ops/JobCard';
import ExecutionLogTable from '../components/ops/ExecutionLogTable';
import JobDetailPanel from '../components/ops/JobDetailPanel';

type Tab = 'schedule' | 'history';

// 주의 필요 상태 판단
const ALERT_STATUSES = new Set(['failed', 'stale', 'never_run']);

interface RunFeedback {
  jobName: string;
  type: 'success' | 'error';
  msg: string;
}

export default function OpsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('schedule');
  const [selectedJob, setSelectedJob] = useState<SchedulerJob | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [runFeedback, setRunFeedback] = useState<RunFeedback | null>(null);

  const { jobs, logs, systemStatus, isLoading, dataUpdatedAt, refetch, isFetching } =
    useJobStatus();

  // ── Panel handlers ──────────────────────────────────────────

  const openPanel = (job: SchedulerJob) => {
    setSelectedJob(job);
    setPanelOpen(true);
  };

  const closePanel = () => {
    setPanelOpen(false);
    // keep selectedJob to avoid flicker during close animation
  };

  // execution row 클릭 시: 일치하는 job을 찾아 패널 열기
  const handleSelectExecution = (exec: JobExecution) => {
    const matched = jobs.find((j) => j.lastExecution?.id === exec.id);
    if (matched) {
      openPanel(matched);
    } else {
      // job 매칭 안 되면 임시 job 객체 생성
      setSelectedJob({
        name: exec.jobName,
        label: exec.jobLabel || exec.jobName,
        description: '',
        schedule: '—',
        scheduleHour: 0,
        scheduleMinute: 0,
        scheduleDayOfWeek: null,
        expectedIntervalHours: 24,
        lastExecution: exec,
        isRunning: exec.status === 'running',
      });
      setPanelOpen(true);
    }
  };

  // ── Run now ─────────────────────────────────────────────────

  const handleRunNow = async (jobName: string) => {
    try {
      const result = await runJobNow(jobName);
      setRunFeedback({ jobName, type: 'success', msg: result.message ?? '실행 요청 완료' });
      void refetch();
      setTimeout(() => setRunFeedback(null), 4000);
    } catch (err: unknown) {
      const res = (err as { response?: { status?: number; data?: { message?: string } } }).response;
      let msg = '실행 요청 실패';
      if (res?.status === 409) msg = '이미 실행 중입니다';
      else if (res?.status === 404) msg = '알 수 없는 잡 이름';
      else if (err instanceof Error) msg = err.message;
      setRunFeedback({ jobName, type: 'error', msg });
      setTimeout(() => setRunFeedback(null), 5000);
    }
  };

  // ── Derived ─────────────────────────────────────────────────

  const alertJobs = jobs.filter((j) => ALERT_STATUSES.has(j.lastExecution?.status ?? 'never_run'));
  const normalJobs = jobs.filter((j) => !ALERT_STATUSES.has(j.lastExecution?.status ?? 'never_run'));

  const updatedAt = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString('ko-KR', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    : null;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600" />
      </div>
    );
  }

  return (
    <>
      <div className="space-y-6">
        {/* Title row */}
        <div className="flex items-end justify-between">
          <div>
            <h2 className="text-3xl font-bold text-gray-900">운영 센터</h2>
            <p className="text-gray-600 mt-1">스케줄러 현황 및 실행 이력</p>
          </div>
          <div className="flex items-center gap-3">
            {updatedAt && (
              <span className="text-xs text-gray-400 font-mono">갱신 {updatedAt}</span>
            )}
            <button
              onClick={() => void refetch()}
              disabled={isFetching}
              className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              {isFetching ? (
                <span className="animate-spin w-3.5 h-3.5 border border-current border-t-transparent rounded-full" />
              ) : (
                <span>↺</span>
              )}
              새로고침
            </button>
          </div>
        </div>

        {/* System status */}
        <SystemStatusBanner status={systemStatus} />

        {/* Run now 피드백 */}
        {runFeedback && (
          <div
            className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium ${
              runFeedback.type === 'success'
                ? 'bg-green-50 border border-green-200 text-green-800'
                : 'bg-red-50 border border-red-200 text-red-800'
            }`}
          >
            <span>{runFeedback.type === 'success' ? '✓' : '✕'}</span>
            <span className="font-mono text-xs text-current opacity-60">[{runFeedback.jobName}]</span>
            <span>{runFeedback.msg}</span>
            <button
              onClick={() => setRunFeedback(null)}
              className="ml-auto text-current opacity-40 hover:opacity-70"
              aria-label="닫기"
            >×</button>
          </div>
        )}

        {/* Tabs */}
        <div className="border-b border-gray-200">
          <nav className="-mb-px flex gap-6">
            {([
              ['schedule', '📅 스케줄러 현황'],
              ['history',  '📋 실행 이력'],
            ] as [Tab, string][]).map(([tab, label]) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab
                    ? 'border-primary-600 text-primary-700'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {label}
              </button>
            ))}
          </nav>
        </div>

        {/* ── Tab: 스케줄러 현황 ── */}
        {activeTab === 'schedule' && (
          <div className="space-y-6">
            {/* 주의 필요 섹션 */}
            {alertJobs.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-red-600 mb-3 flex items-center gap-2">
                  <span>⚠ 주의 필요</span>
                  <span className="text-xs font-normal text-red-400">({alertJobs.length}건)</span>
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {alertJobs.map((job) => (
                    <JobCard
                      key={job.name}
                      job={job}
                      onOpenDetail={openPanel}
                      onRunNow={handleRunNow}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* 정상 잡 그리드 */}
            <div>
              {alertJobs.length > 0 && (
                <h3 className="text-sm font-semibold text-gray-500 mb-3">
                  정상 운행 ({normalJobs.length}건)
                </h3>
              )}
              {normalJobs.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {normalJobs.map((job) => (
                    <JobCard
                      key={job.name}
                      job={job}
                      onOpenDetail={openPanel}
                      onRunNow={handleRunNow}
                    />
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-400">정상 상태 잡 없음</p>
              )}
            </div>

            {/* 요약 footer */}
            <p className="text-xs text-gray-400">
              총 {jobs.length}개 잡 ·{' '}
              <span className="text-green-600">{systemStatus.healthyJobs} 정상</span>
              {systemStatus.warningJobs > 0 && (
                <> · <span className="text-yellow-600">{systemStatus.warningJobs} 주의</span></>
              )}
              {systemStatus.failedJobs > 0 && (
                <> · <span className="text-red-600">{systemStatus.failedJobs} 실패/미실행</span></>
              )}
            </p>
          </div>
        )}

        {/* ── Tab: 실행 이력 ── */}
        {activeTab === 'history' && (
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-gray-900">최근 실행 이력</h3>
              <span className="text-xs text-gray-400">{logs.length}건 · 행 클릭 시 상세</span>
            </div>
            <ExecutionLogTable
              logs={logs}
              onSelectExecution={handleSelectExecution}
            />
          </div>
        )}
      </div>

      {/* Detail panel (portal-style, outside main layout flow) */}
      <JobDetailPanel
        open={panelOpen}
        onClose={closePanel}
        job={selectedJob}
        onRunNow={handleRunNow}
      />
    </>
  );
}
