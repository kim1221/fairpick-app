export type PassportSegment = 'discovered' | 'visited' | 'wishlist';
export type PassportBookmarkSection = 'cover' | 'discovered' | 'wishlist' | 'stamps';
export type PassportContentSection = 'discovered' | 'wishlist' | 'stamps';

export type PassportSectionCopy = {
  eyebrow: string;
  title: string;
  description: string;
  emptyTitle: string;
  emptyDescription: string;
};

type PassportBasePage<
  TSection extends PassportBookmarkSection,
  TType extends string,
  TKey extends string,
> = {
  key: TKey;
  type: TType;
  section: TSection;
};

type PassportTicketPage<TSection extends 'discovered' | 'wishlist', TTicket> =
  PassportBasePage<TSection, TSection, `${TSection}-${number}`> & {
    pageIndex: number;
    items: TTicket[];
  };

type PassportStampPage<TStamp> = PassportBasePage<'stamps', 'stamps', `stamps-${number}`> & {
  pageIndex: number;
  stamps: TStamp[];
};

export type PassportBookPage<TTicket, TStamp> =
  | PassportBasePage<'cover', 'cover', 'cover'>
  | PassportBasePage<'cover', 'identity', 'identity'>
  | PassportTicketPage<'discovered', TTicket>
  | PassportTicketPage<'wishlist', TTicket>
  | PassportStampPage<TStamp>
  | PassportBasePage<PassportContentSection, 'loading', `${PassportContentSection}-loading`>
  | PassportBasePage<PassportContentSection, 'empty', `${PassportContentSection}-empty`>
  | PassportBasePage<PassportContentSection, 'error', `${PassportContentSection}-error`>;

type TicketLike = { id: string };

export type BuildPassportBookPagesInput<TTicket extends TicketLike, TStamp> = {
  discoveredItems: TTicket[];
  wishlistItems: TTicket[];
  stamps: TStamp[];
  visitedIds: Set<string>;
  passportLoading: boolean;
  passportError: boolean;
  savedLoading: boolean;
  savedError: boolean;
  discoveredItemsPerPage?: number;
  wishlistItemsPerPage?: number;
  stampsPerPage?: number;
};

export const DISCOVERED_ITEMS_PER_PAGE = 4;
export const WISHLIST_ITEMS_PER_PAGE = 4;
export const STAMPS_PER_BOOK_PAGE = 6;
export const STAMPS_PER_PASSPORT_BOOK = 60;

export const PASSPORT_CATEGORY_GOAL = 5;
const REGION_MILESTONES = [3, 5, 10, 15, 25] as const;

export type PassportDiscoverySummary = {
  monthDiscovered: number;
  monthVisited: number;
  regionsDiscovered: number;
  categoriesDiscovered: number;
  regionsVisited: number;
  regionGoal: number;
  categoryGoal: number;
  regionProgress: number;
  categoryProgress: number;
  favoriteRegion: string | null;
};

function progressRatio(value: number, goal: number): number {
  if (goal <= 0) return 0;
  return Math.max(0, Math.min(1, value / goal));
}

function nextRegionMilestone(value: number): number {
  return REGION_MILESTONES.find((milestone) => value < milestone)
    ?? REGION_MILESTONES[REGION_MILESTONES.length - 1];
}

export function getPassportDiscoverySummary(input: {
  monthDiscovered?: number;
  monthVisited?: number;
  regionsDiscovered?: number;
  categoriesDiscovered?: number;
  regionsVisited?: number;
  topRegions?: { region: string; count: number }[];
} | null): PassportDiscoverySummary {
  const regionsDiscovered = Math.max(0, input?.regionsDiscovered ?? 0);
  const categoriesDiscovered = Math.max(0, input?.categoriesDiscovered ?? 0);
  const regionGoal = nextRegionMilestone(regionsDiscovered);

  return {
    monthDiscovered: Math.max(0, input?.monthDiscovered ?? 0),
    monthVisited: Math.max(0, input?.monthVisited ?? 0),
    regionsDiscovered,
    categoriesDiscovered,
    regionsVisited: Math.max(0, input?.regionsVisited ?? 0),
    regionGoal,
    categoryGoal: PASSPORT_CATEGORY_GOAL,
    regionProgress: progressRatio(regionsDiscovered, regionGoal),
    categoryProgress: progressRatio(categoriesDiscovered, PASSPORT_CATEGORY_GOAL),
    favoriteRegion: input?.topRegions?.[0]?.region ?? null,
  };
}

const SECTION_COPY: Record<PassportSegment, PassportSectionCopy> = {
  discovered: {
    eyebrow: 'OPENED STORIES',
    title: '공개한 문화',
    description: '광고를 보고 전체 내용을 확인한 카드',
    emptyTitle: '아직 공개한 문화가 없어요',
    emptyDescription: '오늘 탭에서 광고를 보면 첫 카드가 여기에 실려요',
  },
  visited: {
    eyebrow: 'VISITED STORIES',
    title: '직접 다녀온 문화',
    description: '방문한 카드에 남긴 기록',
    emptyTitle: '아직 도장이 없어요',
    emptyDescription: '다녀온 문화를 도장으로 남겨요',
  },
  wishlist: {
    eyebrow: 'SAVED STORIES',
    title: '저장한 문화',
    description: '다음에 보고 싶은 문화 일정',
    emptyTitle: '아직 가고 싶은 문화가 없어요',
    emptyDescription: '마음에 드는 카드를 저장해 두세요',
  },
};

export function getPassportSectionCopy(segment: PassportSegment): PassportSectionCopy {
  return SECTION_COPY[segment];
}

export function getPassportTabLabel(segment: PassportSegment, count: number): string {
  return `${SECTION_COPY[segment].title} ${count}`;
}

function chunk<T>(items: T[], size: number): T[][] {
  const normalizedSize = normalizePageSize(size);
  const pages: T[][] = [];
  for (let index = 0; index < items.length; index += normalizedSize) {
    pages.push(items.slice(index, index + normalizedSize));
  }
  return pages;
}

function normalizePageSize(size: number): number {
  return Number.isFinite(size) && size > 0 ? Math.floor(size) : 1;
}

export type StampBookMeta = {
  bookIndex: number;
  totalBooks: number;
  volumeNumber: number;
  startOrdinal: number;
  endOrdinal: number;
  hasNewerBook: boolean;
  hasOlderBook: boolean;
  label: string;
  rangeLabel: string;
};

export function getStampBookMeta(
  visitedCount: number,
  bookIndex = 1,
  bookSize = STAMPS_PER_PASSPORT_BOOK,
): StampBookMeta {
  const normalizedBookSize = normalizePageSize(bookSize);
  const normalizedVisitedCount = Math.max(0, Math.floor(Number.isFinite(visitedCount) ? visitedCount : 0));
  const totalBooks = Math.max(1, Math.ceil(normalizedVisitedCount / normalizedBookSize));
  const normalizedBookIndex = Math.max(1, Math.min(Math.floor(Number.isFinite(bookIndex) ? bookIndex : 1), totalBooks));
  const volumeNumber = totalBooks - normalizedBookIndex + 1;
  const startOrdinal = normalizedVisitedCount === 0 ? 0 : ((volumeNumber - 1) * normalizedBookSize) + 1;
  const endOrdinal = normalizedVisitedCount === 0
    ? 0
    : Math.min(volumeNumber * normalizedBookSize, normalizedVisitedCount);

  return {
    bookIndex: normalizedBookIndex,
    totalBooks,
    volumeNumber,
    startOrdinal,
    endOrdinal,
    hasNewerBook: normalizedBookIndex > 1,
    hasOlderBook: normalizedBookIndex < totalBooks,
    label: `방문 기록 ${volumeNumber}권`,
    rangeLabel: normalizedVisitedCount === 0 ? '아직 도장이 없어요' : `${startOrdinal}-${endOrdinal}번째 도장`,
  };
}

function appendTicketSection<TTicket extends TicketLike, TStamp>(
  pages: PassportBookPage<TTicket, TStamp>[],
  section: 'discovered' | 'wishlist',
  items: TTicket[],
  loading: boolean,
  error: boolean,
  perPage: number,
) {
  if (loading && items.length === 0) {
    pages.push({ key: `${section}-loading`, type: 'loading', section });
    return;
  }
  if (error && items.length === 0) {
    pages.push({ key: `${section}-error`, type: 'error', section });
    return;
  }
  if (items.length === 0) {
    pages.push({ key: `${section}-empty`, type: 'empty', section });
    return;
  }
  chunk(items, perPage).forEach((pageItems, pageIndex) => {
    if (section === 'discovered') {
      pages.push({
        key: `discovered-${pageIndex}`,
        type: 'discovered',
        section: 'discovered',
        pageIndex,
        items: pageItems,
      });
      return;
    }
    pages.push({
      key: `wishlist-${pageIndex}`,
      type: 'wishlist',
      section: 'wishlist',
      pageIndex,
      items: pageItems,
    });
  });
}

export function buildPassportBookPages<TTicket extends TicketLike, TStamp>({
  discoveredItems,
  wishlistItems,
  stamps,
  visitedIds,
  passportLoading,
  passportError,
  savedLoading,
  savedError,
  discoveredItemsPerPage = DISCOVERED_ITEMS_PER_PAGE,
  wishlistItemsPerPage = WISHLIST_ITEMS_PER_PAGE,
  stampsPerPage = STAMPS_PER_BOOK_PAGE,
}: BuildPassportBookPagesInput<TTicket, TStamp>): PassportBookPage<TTicket, TStamp>[] {
  const pages: PassportBookPage<TTicket, TStamp>[] = [
    { key: 'cover', type: 'cover', section: 'cover' },
    { key: 'identity', type: 'identity', section: 'cover' },
  ];
  const shouldWaitForVisitedIds = passportLoading && wishlistItems.length > 0;
  const shouldBlockWishlistForVisitError = passportError && wishlistItems.length > 0;
  const pendingWishlistItems = shouldWaitForVisitedIds || shouldBlockWishlistForVisitError
    ? []
    : wishlistItems.filter((item) => !visitedIds.has(item.id));

  appendTicketSection(pages, 'discovered', discoveredItems, passportLoading, passportError, discoveredItemsPerPage);
  appendTicketSection(
    pages,
    'wishlist',
    pendingWishlistItems,
    savedLoading || shouldWaitForVisitedIds,
    savedError || shouldBlockWishlistForVisitError,
    wishlistItemsPerPage,
  );

  if (passportLoading && stamps.length === 0) {
    pages.push({ key: 'stamps-loading', type: 'loading', section: 'stamps' });
  } else if (passportError && stamps.length === 0) {
    pages.push({ key: 'stamps-error', type: 'error', section: 'stamps' });
  } else if (stamps.length === 0) {
    pages.push({ key: 'stamps-empty', type: 'empty', section: 'stamps' });
  } else {
    chunk(stamps, stampsPerPage).forEach((pageStamps, pageIndex) => {
      pages.push({
        key: `stamps-${pageIndex}`,
        type: 'stamps',
        section: 'stamps',
        pageIndex,
        stamps: pageStamps,
      });
    });
  }

  return pages;
}

export function getPassportSectionIndexes<TTicket, TStamp>(
  pages: PassportBookPage<TTicket, TStamp>[],
): Record<PassportBookmarkSection, number> {
  const findIndex = (section: PassportBookmarkSection) => {
    const index = pages.findIndex((page) => page.section === section);
    return index >= 0 ? index : 0;
  };
  return {
    cover: 0,
    discovered: findIndex('discovered'),
    wishlist: findIndex('wishlist'),
    stamps: findIndex('stamps'),
  };
}

export function getActivePassportBookmark<TTicket, TStamp>(
  pages: PassportBookPage<TTicket, TStamp>[],
  pageIndex: number,
): PassportBookmarkSection {
  const page = pages[Math.max(0, Math.min(pageIndex, pages.length - 1))];
  if (!page) return 'cover';
  return page.section;
}
