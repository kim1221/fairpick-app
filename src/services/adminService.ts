import axios from 'axios';

const API_BASE_URL = process.env.API_BASE_URL ?? 'https://fairpick-app-production.up.railway.app';

export interface AdminFeaturedEvent {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
  region: string;
  mainCategory: string;
  subCategory: string;
  imageUrl: string;
  isFeatured: boolean;
  featuredOrder: number | null;
  featuredAt: string | null;
}

export interface AdminFeaturedListResponse {
  items: AdminFeaturedEvent[];
  totalCount: number;
}

export interface UpdateFeaturedParams {
  is_featured?: boolean;
  featured_order?: number | null;
}

export interface UpdateFeaturedResponse {
  success: boolean;
  event: {
    id: string;
    title: string;
    is_featured: boolean;
    featured_order: number | null;
    featured_at: string | null;
  };
}

export interface AdminMetricsResponse {
  lastCollection: {
    source: string;
    type: string;
    status: string;
    startedAt: string;
    completedAt: string;
  } | null;
}

export interface RewardAdTelemetrySummary {
  attempts: number;
  shows: number;
  impressions: number;
  rewards: number;
  failedToShow: number;
  errors: number;
  rewardsWithoutImpression: number;
  linkedTicketGrants: number;
  impressionRate: number;
  rewardToImpressionRate: number;
  ticketGrantToRewardRate: number;
}

export interface RewardAdTelemetryDailyStat extends RewardAdTelemetrySummary {
  date: string;
}

export interface RewardsStatsResponse {
  period: {
    days: number;
    from: string | null;
    to: string | null;
  };
  adTelemetry?: {
    summary: RewardAdTelemetrySummary;
    dailyStats: RewardAdTelemetryDailyStat[];
  };
}

export interface RewardReconciliationDailyStat {
  date: string;
  sdkAttempts: number;
  sdkShows: number;
  sdkImpressions: number;
  sdkRewards: number;
  sdkRewardsWithoutImpression: number;
  ticketGrants: number;
  ticketsGranted: number;
  estimatedRewardCostKrw: number;
  dashboardImpressions: number | null;
  dashboardEcpmKrw: number | null;
  dashboardEstimatedRevenueKrw: number | null;
  finalRevenueKrw: number | null;
  invalidAdjustmentKrw: number | null;
  dashboardToSdkImpressionRate: number | null;
  estimatedGrossMarginKrw: number | null;
  finalGrossMarginKrw: number | null;
  note: string | null;
  updatedAt: string | null;
}

export interface RewardReconciliationResponse {
  period: {
    days: number;
    adGroupId: string;
    os: 'all' | 'ios' | 'android' | 'unknown';
  };
  summary: {
    sdkImpressions: number;
    sdkRewards: number;
    ticketsGranted: number;
    estimatedRewardCostKrw: number;
    dashboardImpressions: number;
    dashboardEstimatedRevenueKrw: number;
    finalRevenueKrw: number;
    dashboardToSdkImpressionRate: number | null;
    estimatedGrossMarginKrw: number;
    finalGrossMarginKrw: number;
    finalAdjustmentKrw: number;
  };
  dailyStats: RewardReconciliationDailyStat[];
}

export interface SaveRewardReconciliationParams {
  adGroupId?: string;
  os?: 'all' | 'ios' | 'android' | 'unknown';
  dashboardImpressions?: number | null;
  dashboardEcpmKrw?: number | null;
  dashboardEstimatedRevenueKrw?: number | null;
  finalRevenueKrw?: number | null;
  invalidAdjustmentKrw?: number | null;
  note?: string | null;
}

class AdminService {
  private getAdminKey(): string | null {
    if (typeof (globalThis as any).window !== "undefined") {
      return localStorage.getItem('adminKey');
    }
    return null;
  }

  setAdminKey(key: string): void {
    if (typeof (globalThis as any).window !== "undefined") {
      localStorage.setItem('adminKey', key);
    }
  }

  clearAdminKey(): void {
    if (typeof (globalThis as any).window !== "undefined") {
      localStorage.removeItem('adminKey');
    }
  }

  async getFeaturedEvents(): Promise<AdminFeaturedListResponse> {
    const adminKey = this.getAdminKey();
    if (!adminKey) {
      throw new Error('Admin key not found');
    }

    const response = await axios.get<AdminFeaturedListResponse>(`${API_BASE_URL}/admin/featured`, {
      headers: {
        'x-admin-key': adminKey,
      },
    });

    return response.data;
  }

  async updateFeaturedStatus(eventId: string, params: UpdateFeaturedParams): Promise<UpdateFeaturedResponse> {
    const adminKey = this.getAdminKey();
    if (!adminKey) {
      throw new Error('Admin key not found');
    }

    const response = await axios.patch<UpdateFeaturedResponse>(
      `${API_BASE_URL}/admin/events/${eventId}/featured`,
      params,
      {
        headers: {
          'x-admin-key': adminKey,
          'Content-Type': 'application/json',
        },
      }
    );

    return response.data;
  }

  async verifyAdminKey(key: string): Promise<boolean> {
    try {
      await axios.get(`${API_BASE_URL}/admin/featured`, {
        headers: {
          'x-admin-key': key,
        },
      });
      return true;
    } catch {
      return false;
    }
  }

  async getAdminMetrics(): Promise<AdminMetricsResponse> {
    const response = await axios.get<AdminMetricsResponse>(`${API_BASE_URL}/admin/metrics`);
    return response.data;
  }

  async getRewardsStats(days = 7): Promise<RewardsStatsResponse> {
    const adminKey = this.getAdminKey();
    if (!adminKey) {
      throw new Error('Admin key not found');
    }

    const response = await axios.get<RewardsStatsResponse>(`${API_BASE_URL}/admin/rewards/stats`, {
      params: { days },
      headers: {
        'x-admin-key': adminKey,
      },
    });

    return response.data;
  }

  async getRewardReconciliation(days = 30): Promise<RewardReconciliationResponse> {
    const adminKey = this.getAdminKey();
    if (!adminKey) {
      throw new Error('Admin key not found');
    }

    const response = await axios.get<RewardReconciliationResponse>(
      `${API_BASE_URL}/admin/rewards/reconciliation`,
      {
        params: { days },
        headers: {
          'x-admin-key': adminKey,
        },
      }
    );

    return response.data;
  }

  async saveRewardReconciliation(
    date: string,
    params: SaveRewardReconciliationParams
  ): Promise<{ ok: boolean }> {
    const adminKey = this.getAdminKey();
    if (!adminKey) {
      throw new Error('Admin key not found');
    }

    const response = await axios.put<{ ok: boolean }>(
      `${API_BASE_URL}/admin/rewards/reconciliation/${date}`,
      params,
      {
        headers: {
          'x-admin-key': adminKey,
          'Content-Type': 'application/json',
        },
      }
    );

    return response.data;
  }
}

export const adminService = new AdminService();
export default adminService;
