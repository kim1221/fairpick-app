import axios from 'axios';

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://172.20.10.4:5001';

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

class AdminService {
  private getAdminKey(): string | null {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('adminKey');
    }
    return null;
  }

  setAdminKey(key: string): void {
    if (typeof window !== 'undefined') {
      localStorage.setItem('adminKey', key);
    }
  }

  clearAdminKey(): void {
    if (typeof window !== 'undefined') {
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
}

export const adminService = new AdminService();
export default adminService;
