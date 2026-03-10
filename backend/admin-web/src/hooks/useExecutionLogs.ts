import { useQuery } from '@tanstack/react-query';
import { adminApi } from '../services/api';
import { OPS_QUERY_KEY } from './useJobStatus';

/**
 * 최근 실행 로그만 select해서 반환.
 * useJobStatus와 동일한 queryKey를 공유하므로 추가 네트워크 요청 없음.
 */
export function useExecutionLogs() {
  return useQuery({
    queryKey: OPS_QUERY_KEY,
    queryFn: adminApi.getDashboard,
    select: (data) => data.recentLogs,
  });
}
