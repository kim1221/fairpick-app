import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';
import type {
  PassportDiscoveredCard,
  PassportResponse,
} from '../../../services/passportService';
import type { CollectionSessionCache } from '../../../lib/collectionSessionCache';
import { OpenedCollectionPage } from '../opened';

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
const mockAddListener = jest.fn(() => jest.fn());
const mockGetPassport = jest.fn();
const mockGetDiscoveredCards = jest.fn();
const mockLoadSavedIds = jest.fn();
const mockGetSession = jest.fn();
const mockSetSession = jest.fn();
const mockUpdateSession = jest.fn();
const mockPrefetch = jest.fn<
  (urls: readonly (string | null | undefined)[]) => Promise<{
    requestedUrls: string[];
    loadedUrls: string[];
    failedUrls: string[];
  }>
>(() => Promise.resolve({ requestedUrls: [], loadedUrls: [], failedUrls: [] }));
let mockRouteParams: { filter?: 'all' | 'active' | 'saved' | 'past' } = {};

jest.mock('@granite-js/react-native', () => ({
  createRoute: (_path: string, config: object) => ({
    ...config,
    useNavigation: () => ({
      navigate: mockNavigate,
      goBack: mockGoBack,
      addListener: mockAddListener,
    }),
    useParams: () => mockRouteParams,
  }),
}));

jest.mock('@granite-js/native/react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('../../../hooks/useAuth', () => ({
  useAuth: () => ({
    isLoggedIn: true,
    isLoading: false,
    user: { id: 'user-1' },
  }),
}));

jest.mock('../../../services/passportService', () => ({
  getPassport: (...args: unknown[]) => mockGetPassport(...args),
  getDiscoveredCards: (...args: unknown[]) => mockGetDiscoveredCards(...args),
}));

jest.mock('../../../services/collectionService', () => ({
  loadCollectionSavedEventIds: (...args: unknown[]) => mockLoadSavedIds(...args),
}));

jest.mock('../../../lib/collectionSessionCache', () => ({
  getCollectionSessionKey: (_isLoggedIn: boolean, userId?: string) => `user:${userId ?? 'guest'}`,
  getCollectionSession: (...args: unknown[]) => mockGetSession(...args),
  setCollectionSession: (...args: unknown[]) => mockSetSession(...args),
  updateCollectionSession: (...args: unknown[]) => mockUpdateSession(...args),
}));

jest.mock('../../../components/passport/CachedCollectionImageBackground', () => ({
  CachedCollectionImageBackground: ({ children }: { children?: React.ReactNode }) => children ?? null,
  prefetchCollectionImageUrls: (urls: readonly (string | null | undefined)[]) => mockPrefetch(urls),
}));

function card(
  eventId: string,
  title: string,
  status: PassportDiscoveredCard['status'] = 'active',
): PassportDiscoveredCard {
  return {
    eventId,
    title,
    category: '전시',
    region: '서울',
    venue: '테스트 전시장',
    imageUrl: null,
    startAt: '2026-07-01',
    endAt: status === 'active' ? '2099-12-31' : '2026-01-01',
    lat: null,
    lng: null,
    discoveredAt: `2026-07-${eventId === 'active-1' ? '15' : '14'}T00:00:00.000Z`,
    status,
  };
}

function passportResponse(
  cards: PassportDiscoveredCard[],
  overrides: Partial<PassportResponse> = {},
): PassportResponse {
  return {
    passportNo: '0001',
    discoveredCount: cards.length,
    visitedCount: 0,
    monthDiscovered: cards.length,
    stampBook: 1,
    stampBookCount: 0,
    stampBookSize: 60,
    tasteCategories: [],
    stamps: [],
    visitedEventIds: [],
    discoveredCards: cards,
    discoveredPageInfo: { limit: 100, hasMore: false, nextCursor: null },
    ...overrides,
  };
}

function cacheFor(
  cards: PassportDiscoveredCard[],
  pageInfo: CollectionSessionCache['pageInfo'] = {
    limit: 100,
    hasMore: false,
    nextCursor: null,
  },
): CollectionSessionCache {
  const passport = passportResponse(cards, { discoveredPageInfo: pageInfo ?? undefined });
  return {
    passport,
    openedCards: cards,
    pageInfo,
    visitStamps: [],
    nextStampBook: 2,
    savedEventIds: [],
    visitedEventIds: [],
    fetchedAt: Date.now(),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('OpenedCollectionPage', () => {
  beforeEach(() => {
    mockRouteParams = {};
    mockNavigate.mockClear();
    mockGoBack.mockClear();
    mockAddListener.mockClear();
    mockGetPassport.mockReset();
    mockGetDiscoveredCards.mockReset();
    mockLoadSavedIds.mockReset();
    mockGetSession.mockReset();
    mockSetSession.mockClear();
    mockUpdateSession.mockClear();
    mockPrefetch.mockClear();
  });

  test('shows cached cards immediately and separates back, detail, and archive actions', async () => {
    const cached = cacheFor([
      card('active-1', '진행 중 전시'),
      card('past-1', '지난 전시', 'ended'),
    ]);
    mockGetSession.mockReturnValue(cached);

    const screen = render(<OpenedCollectionPage />);

    expect(screen.queryByText('공개한 카드를 불러오고 있어요.')).toBeNull();
    expect(screen.getByText('진행 중 전시')).toBeTruthy();
    expect(screen.getByText('지난 전시')).toBeTruthy();
    expect(mockGetPassport).not.toHaveBeenCalled();
    expect(mockLoadSavedIds).not.toHaveBeenCalled();

    fireEvent.press(screen.getByLabelText('컬렉션으로 돌아가기'));
    expect(mockGoBack).toHaveBeenCalledTimes(1);

    fireEvent.press(screen.getByLabelText('진행 중 전시 상세 보기'));
    expect(mockNavigate).toHaveBeenCalledWith('/events/:id', { id: 'active-1' });

    fireEvent.press(screen.getByLabelText('지난 전시 보관 정보 보기'));
    expect(await screen.findByText('COLLECTION ARCHIVE')).toBeTruthy();
    expect(mockNavigate).toHaveBeenCalledTimes(1);
  });

  test('guards a cursor request, deduplicates the appended page, and stops at the end', async () => {
    const first = card('active-1', '기존 카드');
    mockGetSession.mockReturnValue(cacheFor(
      [first],
      { limit: 100, hasMore: true, nextCursor: 'cursor-1' },
    ));
    const nextPage = deferred<{
      items: PassportDiscoveredCard[];
      pageInfo: { limit: number; hasMore: boolean; nextCursor: string | null };
    }>();
    mockGetDiscoveredCards.mockReturnValue(nextPage.promise);

    const screen = render(<OpenedCollectionPage />);
    const loadMore = screen.getByLabelText('공개한 카드 더 불러오기');

    fireEvent.press(loadMore);
    fireEvent.press(loadMore);

    expect(mockGetDiscoveredCards).toHaveBeenCalledTimes(1);
    expect(mockGetDiscoveredCards).toHaveBeenCalledWith({ limit: 100, cursor: 'cursor-1' });

    await act(async () => {
      nextPage.resolve({
        items: [first, card('active-2', '새 카드')],
        pageInfo: { limit: 100, hasMore: false, nextCursor: null },
      });
      await nextPage.promise;
    });

    await waitFor(() => {
      expect(screen.getByText('새 카드')).toBeTruthy();
      expect(screen.getAllByLabelText('기존 카드 상세 보기')).toHaveLength(1);
      expect(screen.queryByLabelText('공개한 카드 더 불러오기')).toBeNull();
      expect(screen.getByText('공개한 카드를 모두 불러왔어요.')).toBeTruthy();
    });
    expect(mockGetDiscoveredCards).toHaveBeenCalledTimes(1);
  });
});
