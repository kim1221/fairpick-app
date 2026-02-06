import { useQuery } from '@tanstack/react-query';
import { adminApi } from '../services/api';

export default function DashboardPage() {
  const { data: stats, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: adminApi.getDashboard,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-bold text-gray-900">대시보드</h2>
        <p className="text-gray-600 mt-2">실시간 통계 및 최근 활동을 확인하세요</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="card">
          <div className="text-sm font-medium text-gray-600 mb-1">전체 이벤트</div>
          <div className="text-4xl font-bold text-primary-600">{stats?.totalEvents || 0}</div>
        </div>

        <div className="card">
          <div className="text-sm font-medium text-gray-600 mb-1">Featured</div>
          <div className="text-4xl font-bold text-purple-600">{stats?.featuredCount || 0}</div>
        </div>

        <div className="card">
          <div className="text-sm font-medium text-gray-600 mb-1">업데이트 (24h)</div>
          <div className="text-4xl font-bold text-green-600">{stats?.recentUpdatedCount || 0}</div>
        </div>

        <div className="card">
          <div className="text-sm font-medium text-gray-600 mb-1">신규 (24h)</div>
          <div className="text-4xl font-bold text-orange-600">{stats?.recentNewCount || 0}</div>
        </div>
      </div>

      {/* Recent Logs */}
      <div className="card">
        <h3 className="text-xl font-bold text-gray-900 mb-6">최근 수집 로그</h3>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  시작 시간
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  타입
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  상태
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  항목 수
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  성공
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  실패
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {stats?.recentLogs && stats.recentLogs.length > 0 ? (
                stats.recentLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 text-sm text-gray-900">
                      {new Date(log.started_at).toLocaleString('ko-KR')}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-700">{log.type}</td>
                    <td className="px-6 py-4 text-sm">
                      <span
                        className={`badge ${
                          log.status === 'success' ? 'badge-green' : 'badge-red'
                        }`}
                      >
                        {log.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-700">{log.items_count || 0}</td>
                    <td className="px-6 py-4 text-sm text-gray-700">{log.success_count || 0}</td>
                    <td className="px-6 py-4 text-sm text-gray-700">{log.failed_count || 0}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-gray-500">
                    최근 로그가 없습니다
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}


