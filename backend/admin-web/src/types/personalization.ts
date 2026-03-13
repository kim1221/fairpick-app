export interface PersonalizationHealth {
  last5min: number;
  last15min: number;
  last1h: number;
  lastEventAt: string | null;
  status: 'alive' | 'warning' | 'dead';
}

export interface PersonalizationSummary {
  period: string;
  totalEvents: number;
  activeUsers: number;
  loggedInUsers: number;
  anonymousUsers: number;
  uniqueEvents: number;
  actionBreakdown: Record<string, number>;
}

export interface PersonalizationSignalQuality {
  total: number;
  nullUserId: { count: number; rate: number };
  sectionSlugRate: { count: number; rate: number };
  rankPositionRate: { count: number; rate: number };
  sessionIdRate: { count: number; rate: number };
  metadataRate: { count: number; rate: number };
  unknownActionType: { count: number; rate: number };
  dwellWithSeconds: { count: number; total: number; rate: number };
}

export interface RecentEvent {
  id: string;
  createdAt: string;
  userId: string | null;
  userType: 'logged_in' | 'anonymous' | 'unknown';
  actionType: string;
  eventId: string | null;
  eventTitle: string | null;
  mainCategory: string | null;
  sectionSlug: string | null;
  rankPosition: number | null;
  sessionId: string | null;
  metadata: Record<string, any> | null;
}

export interface TopEvent {
  eventId: string;
  title: string | null;
  mainCategory: string | null;
  region: string | null;
  clickCount: number;
  saveCount: number;
  dwellCount: number;
  ctaClickCount: number;
  totalInteractions: number;
}

export interface TrendPoint {
  bucket: string;
  count: number;
}
