import axios from 'axios';
import type { Event, DashboardStats, PaginatedResponse, PopupFormData, UploadImageResponse } from '../types';

const API_BASE_URL = import.meta.env.VITE_API_URL || '';

// Axios 인스턴스 생성
const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Admin Key 인터셉터
api.interceptors.request.use((config) => {
  const adminKey = localStorage.getItem('adminKey');
  if (adminKey) {
    config.headers['x-admin-key'] = adminKey;
  }
  return config;
});

// 인증 실패 처리
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('adminKey');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// API 함수들
export const adminApi = {
  // 인증 확인
  verifyAdminKey: async (key: string): Promise<boolean> => {
    try {
      await api.post('/admin/verify', {}, {
        headers: { 'x-admin-key': key }
      });
      return true;
    } catch {
      return false;
    }
  },

  // 대시보드 통계
  getDashboard: async (): Promise<DashboardStats> => {
    const { data } = await api.get('/admin/dashboard');
    return data;
  },

  // 이벤트 목록
  getEvents: async (params: {
    page?: number;
    size?: number;
    q?: string;
    category?: string;
    isFeatured?: string;
    hasImage?: string;
    isDeleted?: string;
    sort?: string;
    recentlyCollected?: string; // 🆕 추가
  }): Promise<PaginatedResponse<Event>> => {
    const { data } = await api.get('/admin/events', { params });
    return data;
  },

  // 이벤트 상세
  getEvent: async (id: string): Promise<{ item: Event }> => {
    const { data } = await api.get(`/admin/events/${id}`);
    return data;
  },

  // 이벤트 수정
  updateEvent: async (id: string, updates: Partial<Event>): Promise<void> => {
    await api.patch(`/admin/events/${id}`, updates);
  },

  // 팝업 생성
  createPopup: async (formData: PopupFormData): Promise<Event> => {
    const { data } = await api.post('/admin/events/popup', formData);
    return data.item;
  },

  // 범용 이벤트 생성
  createEvent: async (formData: Partial<Event>): Promise<Event> => {
    const { data } = await api.post('/admin/events', formData);
    return data.item;
  },

  // 이미지 업로드
  uploadImage: async (
    file: File,
    onUploadProgress?: (progressEvent: any) => void
  ): Promise<UploadImageResponse> => {
    const formData = new FormData();
    formData.append('image', file);

    const { data } = await api.post('/admin/uploads/image', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
      onUploadProgress,
    });

    return data;
  },

  // Auto-unfeature 실행
  runAutoUnfeature: async (): Promise<void> => {
    await api.post('/admin/jobs/auto-unfeature');
  },

  // AI 자동 채우기 (이벤트 생성 전 미리보기)
  enrichEventPreview: async (params: {
    title: string;
    venue?: string;
    main_category?: string;
    overview?: string;
    selectedFields?: string[]; // 🆕 선택한 필드만 재생성
  }): Promise<{
    success: boolean;
    message?: string;
    enriched?: {
      // 기본 정보
      start_date?: string | null;
      end_date?: string | null;
      venue?: string | null;
      address?: string | null;
      overview?: string | null;

      // 지오코딩 결과
      lat?: number | null;
      lng?: number | null;
      region?: string | null;

      // 추가 정보
      derived_tags?: string[];
      opening_hours?: any;
      price_min?: number | null;
      price_max?: number | null;
      external_links?: {
        official?: string;
        ticket?: string;
        reservation?: string;
      };
    } | null;
    // 🆕 Phase 2: 제안 시스템
    suggestions?: any;
  }> => {
    const { data } = await api.post('/admin/events/enrich-preview', params);
    return data;
  },

  // AI만으로 빈 필드 보완 (이벤트 생성 전 미리보기, 네이버 검색 없이)
  enrichEventPreviewAIOnly: async (params: {
    title: string;
    venue?: string;
    main_category?: string;
    overview?: string;
    selectedFields?: string[]; // 🆕 선택한 필드만 재생성
  }): Promise<{
    success: boolean;
    message?: string;
    enriched?: {
      // 기본 정보
      start_date?: string | null;
      end_date?: string | null;
      venue?: string | null;
      address?: string | null;
      overview?: string | null;

      // 지오코딩 결과
      lat?: number | null;
      lng?: number | null;
      region?: string | null;

      // 추가 정보
      derived_tags?: string[];
      opening_hours?: any;
      price_min?: number | null;
      price_max?: number | null;
      external_links?: {
        official?: string;
        ticket?: string;
        reservation?: string;
      };

      // 카테고리별 특화 필드
      metadata?: {
        display?: {
          [category: string]: any;
        };
      };
    } | null;
    // 🆕 Phase 2: 제안 시스템
    suggestions?: any;
  }> => {
    const { data } = await api.post('/admin/events/enrich-preview', { ...params, aiOnly: true });
    return data;
  },

  // AI로 기존 이벤트 보완
  enrichEvent: async (
    eventId: string,
    options?: {
      forceFields?: string[]; // 강제 재생성할 필드 목록
      aiOnly?: boolean; // 🆕 네이버 API 건너뛰고 AI만 사용
    }
  ): Promise<{
    success: boolean;
    message?: string;
    enriched?: {
      // 기본 정보
      start_date?: string | null;
      end_date?: string | null;
      venue?: string | null;
      address?: string | null;
      overview?: string | null;
      
      // 지오코딩 결과
      lat?: number | null;
      lng?: number | null;
      region?: string | null;
      
      // 추가 정보
      derived_tags?: string[];
      opening_hours?: any;
      price_min?: number | null;
      price_max?: number | null;
      external_links?: {
        official?: string;
        ticket?: string;
        reservation?: string;
      };
      // Phase 3: 전시/공연 특화 필드
      exhibition_display?: any;
      performance_display?: any;
    } | null;
    // Phase 2: AI 제안 시스템
    suggestions?: any;
  }> => {
    const { data } = await api.post(`/admin/events/${eventId}/enrich`, {
      forceFields: options?.forceFields || [],
      aiOnly: options?.aiOnly || false, // 🆕 aiOnly 옵션 전달
    });
    return data;
  },

  // 🆕 Phase 3: AI 제안 적용
  applySuggestion: async (
    eventId: string,
    fieldName: string
  ): Promise<{
    success: boolean;
    message: string;
    event: Event;
    remainingSuggestions: number;
  }> => {
    const { data } = await api.post(`/admin/events/${eventId}/apply-suggestion`, {
      fieldName,
    });
    return data;
  },

  // 🆕 Phase 3: AI 제안 무시
  dismissSuggestion: async (
    eventId: string,
    fieldName: string
  ): Promise<{
    success: boolean;
    message: string;
    remainingSuggestions: number;
  }> => {
    const { data } = await api.post(`/admin/events/${eventId}/dismiss-suggestion`, {
      fieldName,
    });
    return data;
  },

  // 🆕 AI만으로 빈 필드 보완 (네이버 API 없이)
  enrichEventAIOnly: async (
    eventId: string,
    selectedFields?: string[]
  ): Promise<{
    success: boolean;
    message?: string;
    enriched?: any;
    sources?: string[];
  }> => {
    if (!eventId) {
      throw new Error('eventId is required');
    }
    const encodedId = encodeURIComponent(eventId);

    // 🔍 [RUNTIME DEBUG] API call
    console.log('[API] 🚀 enrichEventAIOnly called', {
      eventId,
      eventIdType: typeof eventId,
      encodedId,
      selectedFields,
      url: `/admin/events/${encodedId}/enrich-ai-direct`
    });

    const { data } = await api.post(`/admin/events/${encodedId}/enrich-ai-direct`, {
      selectedFields: selectedFields || [],
    });

    console.log('[API] ✅ enrichEventAIOnly response', { success: data.success });

    return data;
  },

  // Hot Suggestion 승인 (간소화 버전)
  approveHotSuggestion: async (id: string) => {
    const { data } = await api.post(`/admin/hot-suggestions/${id}/approve-simple`);
    return data;
  },
};

// Hot Suggestions API (별도 export)
export const getHotSuggestions = async (status: 'pending' | 'approved' | 'rejected' = 'pending') => {
  const { data } = await api.get(`/admin/hot-suggestions?status=${status}`);
  return data;
};

// 간소화된 승인 API (이벤트 생성 완료 후 호출)
export const approveHotSuggestion = async (id: string) => {
  const { data } = await api.post(`/admin/hot-suggestions/${id}/approve-simple`);
  return data;
};

export const rejectHotSuggestion = async (id: string) => {
  const { data } = await api.post(`/admin/hot-suggestions/${id}/reject`);
  return data;
};

export default api;

