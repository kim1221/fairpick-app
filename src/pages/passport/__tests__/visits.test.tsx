import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';
import type { CollectionSessionCache } from '../../../lib/collectionSessionCache';
import type { PassportResponse, PassportStamp } from '../../../services/passportService';
import { PassportVisitsPage } from '../visits';

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
const mockAddListener = jest.fn(() => jest.fn());
const mockGetPassport = jest.fn();
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
const mockSubscribeVisitChange = jest.fn<(listener: unknown) => () => void>(() => jest.fn());

jest.mock('@granite-js/react-native', () => ({
  createRoute: (_path: string, config: object) => ({
    ...config,
    useNavigation: () => ({
      navigate: mockNavigate,
      goBack: mockGoBack,
      addListener: mockAddListener,
    }),
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
}));

jest.mock('../../../services/visitService', () => ({
  subscribeVisitChange: (listener: unknown) => mockSubscribeVisitChange(listener),
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

function stamp(
  eventId: string,
  title: string,
  status: PassportStamp['status'] = 'active',
  visitedAt = '2026-07-15T00:00:00.000Z',
): PassportStamp {
  return {
    eventId,
    title,
    category: '공연',
    region: '서울',
    venue: '테스트 공연장',
    imageUrl: null,
    visitedAt,
    status,
  };
}

function response(
  stamps: PassportStamp[],
  overrides: Partial<PassportResponse> = {},
): PassportResponse {
  return {
    passportNo: '0001',
    discoveredCount: 0,
    visitedCount: stamps.length,
    monthDiscovered: 0,
    stampBook: 1,
    stampBookCount: stamps.length > 0 ? 1 : 0,
    stampBookSize: 60,
    tasteCategories: [],
    stamps,
    visitedEventIds: stamps.map((item) => item.eventId),
    discoveredCards: [],
    discoveredPageInfo: { limit: 1, hasMore: false, nextCursor: null },
    ...overrides,
  };
}

function cacheFor(
  stamps: PassportStamp[],
  passportOverrides: Partial<PassportResponse> = {},
  nextStampBook = 2,
): CollectionSessionCache {
  const passport = response(stamps, passportOverrides);
  return {
    passport,
    openedCards: [],
    pageInfo: passport.discoveredPageInfo ?? null,
    visitStamps: stamps,
    nextStampBook,
    savedEventIds: [],
    visitedEventIds: passport.visitedEventIds,
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

describe('PassportVisitsPage', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    mockGoBack.mockClear();
    mockAddListener.mockClear();
    mockGetPassport.mockReset();
    mockGetSession.mockReset();
    mockSetSession.mockClear();
    mockUpdateSession.mockClear();
    mockPrefetch.mockClear();
    mockSubscribeVisitChange.mockClear();
  });

  test('keeps cached visits visible while refreshing and separates detail from archive actions', async () => {
    const active = stamp('visit-1', '진행 중 공연');
    const past = stamp('visit-2', '지난 공연', 'ended', '2026-07-14T00:00:00.000Z');
    const cached = cacheFor([active, past], { visitedCount: 2, stampBookCount: 1 });
    mockGetSession.mockReturnValue(cached);
    const backgroundRefresh = deferred<PassportResponse>();
    mockGetPassport.mockReturnValue(backgroundRefresh.promise);

    const screen = render(<PassportVisitsPage />);

    expect(screen.queryByText('방문 기록을 불러오고 있어요')).toBeNull();
    expect(screen.getByText('진행 중 공연')).toBeTruthy();
    expect(screen.getByText('지난 공연')).toBeTruthy();
    expect(mockGetPassport).toHaveBeenCalledWith({ stampBook: 1, discoveredLimit: 1 });

    fireEvent.press(screen.getByLabelText('컬렉션으로 돌아가기'));
    expect(mockGoBack).toHaveBeenCalledTimes(1);

    fireEvent.press(screen.getByLabelText('진행 중 공연 상세 보기'));
    expect(mockNavigate).toHaveBeenCalledWith('/events/:id', { id: 'visit-1' });

    fireEvent.press(screen.getByLabelText('지난 공연 보관 정보 보기'));
    expect(await screen.findByText('COLLECTION ARCHIVE')).toBeTruthy();
    expect(mockNavigate).toHaveBeenCalledTimes(1);
  });

  test('guards an older-book request, deduplicates stamps, and stops after the last book', async () => {
    const firstStamp = stamp('visit-1', '첫 방문');
    const cached = cacheFor(
      [firstStamp],
      {
        visitedCount: 2,
        stampBookCount: 2,
        visitedEventIds: ['visit-1', 'visit-2'],
      },
      2,
    );
    mockGetSession.mockReturnValue(cached);

    const firstPage = response([firstStamp], {
      visitedCount: 2,
      stampBook: 1,
      stampBookCount: 2,
      visitedEventIds: ['visit-1', 'visit-2'],
    });
    const olderPage = deferred<PassportResponse>();
    mockGetPassport.mockImplementation((options: unknown) => {
      if ((options as { stampBook: number }).stampBook === 1) return Promise.resolve(firstPage);
      return olderPage.promise;
    });

    const screen = render(<PassportVisitsPage />);

    await waitFor(() => {
      expect(mockGetPassport).toHaveBeenCalledWith({ stampBook: 1, discoveredLimit: 1 });
      expect(screen.getByLabelText('이전 방문 기록 더 불러오기')).toBeTruthy();
    });
    await act(async () => {
      await Promise.resolve();
    });

    const loadOlder = screen.getByLabelText('이전 방문 기록 더 불러오기');
    fireEvent.press(loadOlder);
    fireEvent.press(loadOlder);

    expect(mockGetPassport.mock.calls.filter(([options]) => (
      (options as { stampBook?: number }).stampBook === 2
    ))).toHaveLength(1);

    await act(async () => {
      olderPage.resolve(response(
        [firstStamp, stamp('visit-2', '두 번째 방문', 'active', '2026-07-14T00:00:00.000Z')],
        {
          visitedCount: 2,
          stampBook: 2,
          stampBookCount: 2,
          visitedEventIds: ['visit-1', 'visit-2'],
        },
      ));
      await olderPage.promise;
    });

    await waitFor(() => {
      expect(screen.getByText('두 번째 방문')).toBeTruthy();
      expect(screen.getAllByLabelText('첫 방문 상세 보기')).toHaveLength(1);
      expect(screen.queryByLabelText('이전 방문 기록 더 불러오기')).toBeNull();
      expect(screen.getByText('모든 방문 기록을 불러왔어요.')).toBeTruthy();
    });
    expect(mockGetPassport.mock.calls.filter(([options]) => (
      (options as { stampBook?: number }).stampBook === 2
    ))).toHaveLength(1);
  });
});
