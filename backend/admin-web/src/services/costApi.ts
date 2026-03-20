import api from './api';
import type {
  AiCostResponse,
  DbCostResponse,
  StorageCostResponse,
  ApiUsageResponse,
  ManualCostResponse,
  AiPeriod,
} from '../types/cost';

export async function getAiCost(period: AiPeriod = 'this_month'): Promise<AiCostResponse> {
  const res = await api.get<AiCostResponse>('/admin/cost/ai', { params: { period } });
  return res.data;
}

export async function getDbCost(): Promise<DbCostResponse> {
  const res = await api.get<DbCostResponse>('/admin/cost/db');
  return res.data;
}

export async function getStorageCost(): Promise<StorageCostResponse> {
  const res = await api.get<StorageCostResponse>('/admin/cost/storage');
  return res.data;
}

export async function getApiUsage(): Promise<ApiUsageResponse> {
  const res = await api.get<ApiUsageResponse>('/admin/cost/api-usage');
  return res.data;
}

export async function getManualCost(): Promise<ManualCostResponse> {
  const res = await api.get<ManualCostResponse>('/admin/cost/manual');
  return res.data;
}

export async function updateManualCost(key: string, amount_usd: number, note?: string): Promise<void> {
  await api.put(`/admin/cost/manual/${key}`, { amount_usd, note });
}
