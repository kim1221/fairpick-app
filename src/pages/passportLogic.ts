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

export type PassportBookPage<TTicket, TStamp> =
  | { key: 'cover'; type: 'cover'; section: 'cover' }
  | { key: 'identity'; type: 'identity'; section: 'cover' }
  | { key: string; type: 'discovered'; section: 'discovered'; pageIndex: number; items: TTicket[] }
  | { key: string; type: 'wishlist'; section: 'wishlist'; pageIndex: number; items: TTicket[] }
  | { key: string; type: 'stamps'; section: 'stamps'; pageIndex: number; stamps: TStamp[] }
  | { key: string; type: 'loading'; section: PassportContentSection }
  | { key: string; type: 'empty'; section: PassportContentSection }
  | { key: string; type: 'error'; section: PassportContentSection };

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

export const DISCOVERED_ITEMS_PER_PAGE = 3;
export const WISHLIST_ITEMS_PER_PAGE = 3;
export const STAMPS_PER_BOOK_PAGE = 6;

const SECTION_COPY: Record<PassportSegment, PassportSectionCopy> = {
  discovered: {
    eyebrow: 'ENTRY CARDS',
    title: '발견한 카드',
    description: '광고를 보고 발급받은 문화 카드',
    emptyTitle: '아직 받은 카드가 없어요',
    emptyDescription: '홈에서 광고를 보면 문화 카드가 발급돼요',
  },
  visited: {
    eyebrow: 'PASSPORT STAMPS',
    title: '다녀왔어요',
    description: '다녀온 문화에 남긴 도장',
    emptyTitle: '아직 도장이 없어요',
    emptyDescription: '다녀온 문화를 도장으로 남겨요',
  },
  wishlist: {
    eyebrow: 'TRAVEL PLAN',
    title: '가고 싶어요',
    description: '다음에 들를 문화 일정',
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
  const pages: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    pages.push(items.slice(index, index + size));
  }
  return pages;
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
    pages.push({
      key: `${section}-${pageIndex}`,
      type: section,
      section,
      pageIndex,
      items: pageItems,
    } as PassportBookPage<TTicket, TStamp>);
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
  const pendingWishlistItems = wishlistItems.filter((item) => !visitedIds.has(item.id));

  appendTicketSection(pages, 'discovered', discoveredItems, passportLoading, passportError, discoveredItemsPerPage);
  appendTicketSection(pages, 'wishlist', pendingWishlistItems, savedLoading, savedError, wishlistItemsPerPage);

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
