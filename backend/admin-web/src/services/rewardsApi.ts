import api from './api';

export interface DailyStat {
  date: string;
  adViews: number;
  ticketsGranted: number;
  activeUsers: number;
  exchangeCount: number;
}

export interface HeavyUser {
  userId: string;
  totalViews: number;
  totalTickets: number;
  dailyAvg: number;
}

export interface ViewDistribution {
  '1-5': number;
  '6-10': number;
  '11-20': number;
  '21-30': number;
}

export interface RewardsSummary {
  totalAdViews: number;
  totalTickets: number;
  totalExchanges: number;
  totalActiveUsers: number;
  avgViewsPerUser: number;
  p10plus: number;
  p20plus: number;
}

export interface RewardsStats {
  period: { days: number; from: string | null; to: string | null };
  summary: RewardsSummary;
  dailyStats: DailyStat[];
  viewDistribution: ViewDistribution;
  heavyUsers: HeavyUser[];
}

export async function getRewardsStats(days: number = 14): Promise<RewardsStats> {
  const res = await api.get<RewardsStats>('/admin/rewards/stats', { params: { days } });
  return res.data;
}
