import { Link } from 'react-router-dom';
import { useJobStatus } from '../hooks/useJobStatus';
import SystemStatusBanner from '../components/ops/SystemStatusBanner';
import ScheduleTimeline from '../components/ops/ScheduleTimeline';
import ExecutionLogTable from '../components/ops/ExecutionLogTable';

export default function DashboardPage() {
  const { data: stats, isLoading, jobs, logs, systemStatus } = useJobStatus();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600" />
      </div>
    );
  }

  const hasAlert = systemStatus.overall !== 'healthy';

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-bold text-gray-900">대시보드</h2>
        <p className="text-gray-600 mt-2">실시간 통계 및 최근 활동을 확인하세요</p>
      </div>

      {/* System Status */}
      <SystemStatusBanner status={systemStatus} />

      {/* Alert shortcut — 문제 있을 때만 노출 */}
      {hasAlert && (
        <Link
          to="/ops"
          className="flex items-center justify-between px-4 py-3 bg-orange-50 border border-orange-200 rounded-lg text-sm text-orange-800 hover:bg-orange-100 transition-colors"
        >
          <span>
            🔔 잡 {systemStatus.failedJobs > 0 ? `${systemStatus.failedJobs}개 실패` : ''}{systemStatus.warningJobs > 0 ? ` · ${systemStatus.warningJobs}개 주의` : ''} — 운영 센터에서 확인하세요
          </span>
          <span className="text-orange-600">→</span>
        </Link>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="card">
          <div className="text-sm font-medium text-gray-600 mb-1">전체 이벤트</div>
          <div className="text-4xl font-bold text-primary-600">{stats?.totalEvents ?? 0}</div>
        </div>
        <div className="card">
          <div className="text-sm font-medium text-gray-600 mb-1">Featured</div>
          <div className="text-4xl font-bold text-purple-600">{stats?.featuredCount ?? 0}</div>
        </div>
        <div className="card">
          <div className="text-sm font-medium text-gray-600 mb-1">업데이트 (24h)</div>
          <div className="text-4xl font-bold text-green-600">{stats?.recentUpdatedCount ?? 0}</div>
        </div>
        <div className="card">
          <div className="text-sm font-medium text-gray-600 mb-1">신규 (24h)</div>
          <div className="text-4xl font-bold text-orange-600">{stats?.recentNewCount ?? 0}</div>
        </div>
      </div>

      {/* Schedule Timeline */}
      <ScheduleTimeline jobs={jobs} />

      {/* Recent Logs */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-bold text-gray-900">최근 수집 로그</h3>
          <Link
            to="/ops"
            className="text-sm text-primary-600 hover:text-primary-700 font-medium"
          >
            운영 센터 전체 보기 →
          </Link>
        </div>
        <ExecutionLogTable logs={logs} preview />
      </div>
    </div>
  );
}
