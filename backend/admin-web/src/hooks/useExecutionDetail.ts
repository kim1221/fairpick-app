import { useQuery } from '@tanstack/react-query';
import { getExecutionDetail } from '../services/opsApi';

/**
 * 특정 실행 기록의 상세 조회.
 * logId가 null이면 비활성화. 실 API 연동 후 getExecutionDetail 구현을 채울 것.
 */
export function useExecutionDetail(logId: string | null) {
  return useQuery({
    queryKey: ['executionDetail', logId] as const,
    queryFn: () => getExecutionDetail(logId!),
    enabled: !!logId,
    staleTime: 5 * 60_000,
  });
}
