import { useQuery } from '@tanstack/react-query';
import { adminApi } from '../services/api';

/**
 * 서버 헬스 — 30초 간격 갱신
 */
export function useAdminHealth() {
  return useQuery({
    queryKey: ['admin-health'],
    queryFn: adminApi.getAdminHealth,
    refetchInterval: 30_000,
    staleTime: 15_000,
    retry: 1,
  });
}

/**
 * 외부 API 상태 — 5분 간격 갱신 (백엔드 캐시와 동기)
 */
export function useApiHealth() {
  return useQuery({
    queryKey: ['api-health'],
    queryFn: adminApi.getApiHealth,
    refetchInterval: 5 * 60 * 1000,
    staleTime: 4 * 60 * 1000,
    retry: 1,
  });
}
