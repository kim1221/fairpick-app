export interface DebugUser {
  inputValue: string;
  resolvedBy: 'internal_id' | 'anonymous_id' | 'toss_user_key' | null;
  internalUserId: string | null;
  userType: 'anonymous' | 'logged_in' | null;
  anonymousId: string | null;
  tossUserKey: string | null;
  found: boolean;
}

export interface DebugSignals {
  categoryClickCounts: Record<string, number>;
  sectionClickCounts: Record<string, number>;
  summary: {
    totalClicks14d: number;
    recentClicks3d: number;
    totalSaved: number;
    todayPickImpressionBlocked: number;
    recentImpressionBlocked: number;
  };
}

export interface CategoryAffinity {
  category: string;
  clickCount: number;
  boost: 0 | 2 | 3;
}

export interface RecentAction {
  actionType: string;
  eventId: string | null;
  eventTitle: string | null;
  mainCategory: string | null;
  sectionSlug: string | null;
  rankPosition: number | null;
  createdAt: string;
}

export interface SimulatedEvent {
  id: string;
  title: string | null;
  category: string | null;
  reasons: string[];
}

export interface DownrankedEvent {
  id: string;
  title: string | null;
  category: string | null;
  downrankType: 'recent_click' | 'recent_impression';
  reason: string;
  categoryBoost: string | null;
}

export interface SkippedEvent {
  id: string;
  title: string | null;
  category: string | null;
  skipType: 'today_pick_impression' | 'slot_cap';
  reason: string;
}

export interface TodayPickSimulation {
  poolSize: number;
  selected: SimulatedEvent[];
  downranked: DownrankedEvent[];
  skipped: SkippedEvent[];
}

export interface SectionRecentlyShown {
  id: string;
  title: string | null;
  category: string | null;
  lastShownAt: string;
  impressionCount: number;
  representativeReasons: string[];
}

export interface SectionSummary {
  sectionSlug: string;
  recentlyShown: SectionRecentlyShown[];
}

export interface RecommendationDebugResult {
  user: DebugUser;
  signals: DebugSignals;
  categoryAffinity: CategoryAffinity[];
  recentActions: RecentAction[];
  todayPickSimulation: TodayPickSimulation;
  homeSectionsSummary: SectionSummary[];
}
