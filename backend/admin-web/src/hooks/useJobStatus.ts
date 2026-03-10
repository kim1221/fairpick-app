import { useQuery } from '@tanstack/react-query';
import { adminApi } from '../services/api';
import { mergeJobsWithLogs, deriveSystemStatus } from '../services/opsApi';

export const OPS_QUERY_KEY = ['dashboard'] as const;

/**
 * 스케줄러 잡 상태 + 시스템 상태를 한 번에 제공.
 * 실행 중인 잡이 있으면 10초, 없으면 60초 간격으로 자동 갱신.
 */
export function useJobStatus() {
  const query = useQuery({
    queryKey: OPS_QUERY_KEY,
    queryFn: adminApi.getDashboard,
    refetchInterval: (q) => {
      const hasRunning =
        (q.state.data?.recentLogs ?? []).some((l) => l.status === 'running');
      return hasRunning ? 10_000 : 60_000;
    },
  });

  const logs = query.data?.recentLogs ?? [];
  const jobs = mergeJobsWithLogs(logs);
  const systemStatus = deriveSystemStatus(jobs);

  return { ...query, logs, jobs, systemStatus };
}
