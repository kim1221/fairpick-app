# Culture Passport Book Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert `/passport` from three independent segment tabs into one horizontal culture passport book with bookmark-style section jumps.

**Architecture:** Build a rendering-only book model in `passportLogic.ts`, then render that model with a horizontal `FlatList`. Keep existing passport cover, identity, stamp, ticket row, visit, save, and history APIs; only reshape the passport information architecture.

**Tech Stack:** React Native 0.84, Granite route pages, TDS React Native icons/loaders/dialogs, Jest, TypeScript, ESLint.

---

## File Structure

- Modify `src/pages/passportLogic.ts`
  - Owns section copy, tab/bookmark labels, book page construction, page chunking, section index lookup, active bookmark lookup.
- Modify `src/pages/__tests__/passportLogic.test.ts`
  - Covers book page ordering, chunking, empty states, bookmark indexes, and visited-item filtering from wishlist pages.
- Modify `src/components/saved/SavedTicketRow.tsx`
  - Adds optional save/unsave CTA for discovered cards without changing existing saved/wishlist behavior.
- Create `src/components/passport/PassportBookPages.tsx`
  - Contains reusable paper-style ticket pages, state pages, and the bookmark rail.
- Modify `src/components/passport/PassportPages.tsx`
  - Extends `PassportIdentityPage` with discovered/wishlist counts.
- Modify `src/pages/passport.tsx`
  - Removes `segment`, `PassportLedgerPage`, and segment rendering.
  - Builds the full book page array and renders it through horizontal `FlatList`.
  - Wires bookmark rail, save toggling, visit state, retry, and stamp detail.

---

### Task 1: Book Model Tests

**Files:**
- Modify: `src/pages/__tests__/passportLogic.test.ts`
- Modify: `src/pages/passportLogic.ts`

- [ ] **Step 1: Write failing tests for the book model**

Replace `src/pages/__tests__/passportLogic.test.ts` with:

```ts
import { describe, expect, test } from '@jest/globals';
import {
  buildPassportBookPages,
  getActivePassportBookmark,
  getPassportSectionCopy,
  getPassportSectionIndexes,
  getPassportTabLabel,
} from '../passportLogic';

type TestTicket = { id: string; title: string };
type TestStamp = { eventId: string; visitedAt: string };

const tickets = (count: number): TestTicket[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `event-${index + 1}`,
    title: `Event ${index + 1}`,
  }));

const stamps = (count: number): TestStamp[] =>
  Array.from({ length: count }, (_, index) => ({
    eventId: `stamp-${index + 1}`,
    visitedAt: `2026-07-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
  }));

describe('passport logic', () => {
  test('describes every segment as a passport page', () => {
    expect(getPassportSectionCopy('discovered')).toMatchObject({
      eyebrow: 'ENTRY CARDS',
      title: '발견한 카드',
      description: '광고를 보고 발급받은 문화 카드',
    });
    expect(getPassportSectionCopy('visited')).toMatchObject({
      eyebrow: 'PASSPORT STAMPS',
      title: '다녀왔어요',
      description: '다녀온 문화에 남긴 도장',
    });
    expect(getPassportSectionCopy('wishlist')).toMatchObject({
      eyebrow: 'TRAVEL PLAN',
      title: '가고 싶어요',
      description: '다음에 들를 문화 일정',
    });
  });

  test('keeps tab labels short while counts change', () => {
    expect(getPassportTabLabel('discovered', 67)).toBe('발견한 카드 67');
    expect(getPassportTabLabel('visited', 2)).toBe('다녀왔어요 2');
    expect(getPassportTabLabel('wishlist', 3)).toBe('가고 싶어요 3');
  });

  test('builds one passport book in story order', () => {
    const pages = buildPassportBookPages<TestTicket, TestStamp>({
      discoveredItems: tickets(2),
      wishlistItems: tickets(2),
      stamps: stamps(2),
      visitedIds: new Set(),
      passportLoading: false,
      passportError: false,
      savedLoading: false,
      savedError: false,
    });

    expect(pages.map((page) => page.type)).toEqual([
      'cover',
      'identity',
      'discovered',
      'wishlist',
      'stamps',
    ]);
  });

  test('chunks discovered and wishlist tickets into three-card pages', () => {
    const pages = buildPassportBookPages<TestTicket, TestStamp>({
      discoveredItems: tickets(7),
      wishlistItems: tickets(4),
      stamps: stamps(1),
      visitedIds: new Set(),
      passportLoading: false,
      passportError: false,
      savedLoading: false,
      savedError: false,
    });

    const discoveredPages = pages.filter((page) => page.type === 'discovered');
    const wishlistPages = pages.filter((page) => page.type === 'wishlist');

    expect(discoveredPages.map((page) => page.type === 'discovered' ? page.items.length : 0)).toEqual([3, 3, 1]);
    expect(wishlistPages.map((page) => page.type === 'wishlist' ? page.items.length : 0)).toEqual([3, 1]);
  });

  test('keeps empty sections inside the passport book', () => {
    const pages = buildPassportBookPages<TestTicket, TestStamp>({
      discoveredItems: [],
      wishlistItems: [],
      stamps: [],
      visitedIds: new Set(),
      passportLoading: false,
      passportError: false,
      savedLoading: false,
      savedError: false,
    });

    expect(pages.map((page) => `${page.type}:${page.section}`)).toEqual([
      'cover:cover',
      'identity:cover',
      'empty:discovered',
      'empty:wishlist',
      'empty:stamps',
    ]);
  });

  test('filters visited saved events out of the wishlist section', () => {
    const pages = buildPassportBookPages<TestTicket, TestStamp>({
      discoveredItems: tickets(1),
      wishlistItems: tickets(3),
      stamps: stamps(1),
      visitedIds: new Set(['event-2']),
      passportLoading: false,
      passportError: false,
      savedLoading: false,
      savedError: false,
    });

    const wishlistPage = pages.find((page) => page.type === 'wishlist');
    expect(wishlistPage?.type).toBe('wishlist');
    expect(wishlistPage?.type === 'wishlist' ? wishlistPage.items.map((item) => item.id) : []).toEqual([
      'event-1',
      'event-3',
    ]);
  });

  test('calculates bookmark indexes and active bookmark', () => {
    const pages = buildPassportBookPages<TestTicket, TestStamp>({
      discoveredItems: tickets(4),
      wishlistItems: tickets(1),
      stamps: stamps(7),
      visitedIds: new Set(),
      passportLoading: false,
      passportError: false,
      savedLoading: false,
      savedError: false,
    });

    expect(getPassportSectionIndexes(pages)).toEqual({
      cover: 0,
      discovered: 2,
      wishlist: 4,
      stamps: 5,
    });
    expect(getActivePassportBookmark(pages, 0)).toBe('cover');
    expect(getActivePassportBookmark(pages, 3)).toBe('discovered');
    expect(getActivePassportBookmark(pages, 4)).toBe('wishlist');
    expect(getActivePassportBookmark(pages, 6)).toBe('stamps');
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npm test -- src/pages/__tests__/passportLogic.test.ts --runInBand --watchman=false
```

Expected: fail with missing exports `buildPassportBookPages`, `getPassportSectionIndexes`, or `getActivePassportBookmark`.

- [ ] **Step 3: Implement the book model**

Replace `src/pages/passportLogic.ts` with:

```ts
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
```

- [ ] **Step 4: Run tests and verify pass**

Run:

```bash
npm test -- src/pages/__tests__/passportLogic.test.ts --runInBand --watchman=false
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

Run:

```bash
git add src/pages/passportLogic.ts src/pages/__tests__/passportLogic.test.ts
git commit -m "feat: model culture passport book pages"
```

Expected: commit only those two files.

---

### Task 2: Optional Save Action On Ticket Rows

**Files:**
- Modify: `src/components/saved/SavedTicketRow.tsx`

- [ ] **Step 1: Extend row props**

In `src/components/saved/SavedTicketRow.tsx`, add this type near `VisitButtonState`:

```ts
export type SaveButtonState = 'hidden' | 'idle' | 'saved' | 'loading';
```

Extend `SavedTicketRowProps`:

```ts
interface SavedTicketRowProps {
  item: SavedTicketItem;
  visitState: VisitButtonState;
  stampSignal: number;
  saveState?: SaveButtonState;
  onPress: (item: SavedTicketItem) => void;
  onDirections: (item: SavedTicketItem) => void;
  onVisit: (item: SavedTicketItem) => void;
  onToggleSave?: (item: SavedTicketItem) => void;
}
```

Update the component signature:

```ts
export function SavedTicketRow({
  item,
  visitState,
  stampSignal,
  saveState = 'hidden',
  onPress,
  onDirections,
  onVisit,
  onToggleSave,
}: SavedTicketRowProps) {
```

- [ ] **Step 2: Add save label and CTA**

Inside the component, after `visitLabel`, add:

```ts
  const saveLabel = useMemo(() => {
    if (saveState === 'loading') return '저장 중';
    if (saveState === 'saved') return '저장됨';
    return '저장';
  }, [saveState]);

  const showSaveButton = saveState !== 'hidden' && typeof onToggleSave === 'function';
```

Inside `styles.actions`, render the optional save button between visit and directions:

```tsx
            {showSaveButton ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  saveState === 'saved' ? `${item.title} 저장 취소` : `${item.title} 저장`
                }
                disabled={saveState === 'loading' || isDeleted}
                onPress={() => onToggleSave?.(item)}
                style={[
                  styles.saveButton,
                  saveState === 'saved' ? styles.saveButtonDone : styles.saveButtonIdle,
                  saveState === 'loading' || isDeleted ? styles.actionDisabled : null,
                ]}
              >
                <Text style={[styles.saveButtonText, saveState === 'saved' ? styles.saveButtonDoneText : null]}>
                  {saveLabel}
                </Text>
              </Pressable>
            ) : null}
```

Add styles:

```ts
  saveButton: {
    minHeight: 30,
    borderRadius: 999,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveButtonIdle: {
    backgroundColor: NORMAL_BG,
  },
  saveButtonDone: {
    backgroundColor: GOLD,
  },
  saveButtonText: {
    color: NORMAL_TEXT,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '900',
  },
  saveButtonDoneText: {
    color: GOLD_INK,
  },
```

- [ ] **Step 3: Run focused lint**

Run:

```bash
./node_modules/.bin/eslint src/components/saved/SavedTicketRow.tsx
```

Expected: no lint errors.

- [ ] **Step 4: Commit**

Run:

```bash
git add src/components/saved/SavedTicketRow.tsx
git commit -m "feat: add passport save action to ticket rows"
```

Expected: commit only the ticket row file.

---

### Task 3: Passport Book Page Components

**Files:**
- Create: `src/components/passport/PassportBookPages.tsx`

- [ ] **Step 1: Create passport book page components**

Create `src/components/passport/PassportBookPages.tsx` with:

```tsx
import { Icon, Loader } from '@toss/tds-react-native';
import React from 'react';
import { ImageBackground, Pressable, StyleSheet, Text, View } from 'react-native';
import { manilaTagTexture } from '../../assets';
import type { PassportBookmarkSection, PassportContentSection, PassportSectionCopy } from '../../pages/passportLogic';
import { SavedTicketRow, type SavedTicketItem, type SaveButtonState, type VisitButtonState } from '../saved/SavedTicketRow';
import { PassportEmblem } from './PassportEmblem';

const GOLD = '#CBA15E';
const GOLD_SOFT = '#DDB877';
const PAPER_EDGE = '#D6C79E';
const INK = '#2C2A22';
const INK_SUB = '#6E6350';
const NAVY_STAMP = '#2A386A';
const RED_STAMP = '#A8331F';

export type PassportBookmarkItem = {
  section: PassportBookmarkSection;
  label: string;
};

type TicketPageMode = 'discovered' | 'wishlist';

export function PassportTicketBookPage({
  width,
  copy,
  mode,
  pageIndex,
  totalPages,
  items,
  getVisitState,
  getSaveState,
  getStampSignal,
  onPressTicket,
  onDirections,
  onVisit,
  onToggleSave,
}: {
  width: number;
  copy: PassportSectionCopy;
  mode: TicketPageMode;
  pageIndex: number;
  totalPages: number;
  items: SavedTicketItem[];
  getVisitState: (id: string) => VisitButtonState;
  getSaveState: (id: string) => SaveButtonState;
  getStampSignal: (id: string) => number;
  onPressTicket: (item: SavedTicketItem) => void;
  onDirections: (item: SavedTicketItem) => void;
  onVisit: (item: SavedTicketItem) => void;
  onToggleSave: (item: SavedTicketItem) => void;
}) {
  const pageNo = `${pageIndex + 1}/${Math.max(totalPages, 1)}`;
  return (
    <View style={[styles.page, { width }]}>
      <ImageBackground
        source={manilaTagTexture}
        style={styles.paperFace}
        imageStyle={styles.paperFaceImg}
        resizeMode="cover"
      >
        <View style={styles.paperWash} pointerEvents="none" />
        <View style={styles.watermark} pointerEvents="none">
          <PassportEmblem size={150} color={INK} opacity={0.05} />
        </View>

        <View style={styles.headerRow}>
          <View style={styles.headerText}>
            <Text style={styles.eyebrow}>{copy.eyebrow}</Text>
            <Text style={styles.title}>{copy.title}</Text>
            <Text style={styles.description}>{copy.description}</Text>
          </View>
          <View style={styles.pageBadge}>
            <Text style={styles.pageBadgeText}>{pageNo}</Text>
          </View>
        </View>

        <View style={styles.divider} />

        <View style={styles.ticketList}>
          {items.map((item) => (
            <SavedTicketRow
              key={item.id}
              item={item}
              visitState={getVisitState(item.id)}
              stampSignal={getStampSignal(item.id)}
              saveState={mode === 'discovered' ? getSaveState(item.id) : 'saved'}
              onPress={onPressTicket}
              onDirections={onDirections}
              onVisit={onVisit}
              onToggleSave={onToggleSave}
            />
          ))}
        </View>
      </ImageBackground>
    </View>
  );
}

export function PassportBookStatePage({
  width,
  section,
  copy,
  state,
  onRetry,
}: {
  width: number;
  section: PassportContentSection;
  copy: PassportSectionCopy;
  state: 'loading' | 'empty' | 'error';
  onRetry: () => void;
}) {
  const iconName = section === 'wishlist' ? 'icon-bookmark-mono' : 'icon-ticket-mono';
  const title = state === 'loading'
    ? `${copy.title}를 불러오고 있어요`
    : state === 'error'
      ? `${copy.title}를 불러오지 못했어요`
      : copy.emptyTitle;
  const description = state === 'empty' ? copy.emptyDescription : state === 'error' ? '잠시 후 다시 확인해 주세요.' : '';

  return (
    <View style={[styles.page, { width }]}>
      <ImageBackground
        source={manilaTagTexture}
        style={styles.paperFace}
        imageStyle={styles.paperFaceImg}
        resizeMode="cover"
      >
        <View style={styles.paperWash} pointerEvents="none" />
        <View style={styles.stateBox}>
          {state === 'loading' ? (
            <Loader size="small" customStrokeColor={INK_SUB} />
          ) : (
            <Icon name={iconName} size={30} color={section === 'stamps' ? RED_STAMP : NAVY_STAMP} />
          )}
          <Text style={styles.stateTitle}>{title}</Text>
          {description ? <Text style={styles.stateDesc}>{description}</Text> : null}
          {state === 'error' ? (
            <Pressable accessibilityRole="button" onPress={onRetry} style={styles.retryButton}>
              <Text style={styles.retryText}>다시 불러오기</Text>
            </Pressable>
          ) : null}
        </View>
      </ImageBackground>
    </View>
  );
}

export function PassportIndexRail({
  items,
  activeSection,
  onPress,
}: {
  items: PassportBookmarkItem[];
  activeSection: PassportBookmarkSection;
  onPress: (section: PassportBookmarkSection) => void;
}) {
  return (
    <View pointerEvents="box-none" style={styles.indexRail}>
      {items.map((item) => {
        const active = item.section === activeSection;
        return (
          <Pressable
            key={item.section}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => onPress(item.section)}
            style={[styles.indexTab, active ? styles.indexTabActive : null]}
          >
            <Text style={[styles.indexText, active ? styles.indexTextActive : null]}>{item.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    height: 520,
    paddingHorizontal: 20,
  },
  paperFace: {
    flex: 1,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: PAPER_EDGE,
    paddingHorizontal: 14,
    paddingTop: 18,
    paddingBottom: 16,
  },
  paperFaceImg: {
    opacity: 0.96,
  },
  paperWash: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,249,235,0.45)',
  },
  watermark: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 160,
    alignItems: 'center',
  },
  headerRow: {
    minHeight: 82,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  eyebrow: {
    color: NAVY_STAMP,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '900',
    letterSpacing: 2,
  },
  title: {
    marginTop: 6,
    color: INK,
    fontSize: 24,
    lineHeight: 31,
    fontWeight: '900',
    fontFamily: 'Noto Serif KR',
  },
  description: {
    marginTop: 4,
    color: INK_SUB,
    fontSize: 12.5,
    lineHeight: 18,
    fontWeight: '700',
  },
  pageBadge: {
    minWidth: 42,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: GOLD,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  pageBadgeText: {
    color: INK,
    fontSize: 11,
    fontWeight: '900',
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(44,42,34,0.32)',
    marginBottom: 12,
  },
  ticketList: {
    gap: 10,
  },
  stateBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  stateTitle: {
    marginTop: 12,
    color: INK,
    fontSize: 18,
    lineHeight: 25,
    fontWeight: '900',
    textAlign: 'center',
  },
  stateDesc: {
    marginTop: 6,
    color: INK_SUB,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '700',
    textAlign: 'center',
  },
  retryButton: {
    marginTop: 14,
    minHeight: 40,
    borderRadius: 999,
    paddingHorizontal: 18,
    backgroundColor: NAVY_STAMP,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryText: {
    color: GOLD_SOFT,
    fontSize: 13,
    fontWeight: '900',
  },
  indexRail: {
    position: 'absolute',
    right: 4,
    top: 48,
    gap: 8,
  },
  indexTab: {
    width: 40,
    minHeight: 38,
    borderTopLeftRadius: 10,
    borderBottomLeftRadius: 10,
    backgroundColor: 'rgba(20,33,58,0.70)',
    borderWidth: 1,
    borderRightWidth: 0,
    borderColor: 'rgba(203,161,94,0.46)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  indexTabActive: {
    backgroundColor: GOLD,
  },
  indexText: {
    color: GOLD_SOFT,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '900',
  },
  indexTextActive: {
    color: '#20160A',
  },
});
```

- [ ] **Step 2: Run focused lint**

Run:

```bash
./node_modules/.bin/eslint src/components/passport/PassportBookPages.tsx
```

Expected: no lint errors.

- [ ] **Step 3: Commit**

Run:

```bash
git add src/components/passport/PassportBookPages.tsx
git commit -m "feat: add passport book page components"
```

Expected: commit only the new component file.

---

### Task 4: Identity Page Counts

**Files:**
- Modify: `src/components/passport/PassportPages.tsx`

- [ ] **Step 1: Extend `PassportIdentityPage` props**

Change the function signature props to:

```ts
export function PassportIdentityPage({
  width,
  passportNo,
  discoveredCount,
  wishlistCount,
  visitedCount,
  monthLabel,
  tasteCategories,
}: {
  width: number;
  passportNo: string;
  discoveredCount: number;
  wishlistCount: number;
  visitedCount: number;
  monthLabel: string | null;
  tasteCategories: string[];
}) {
```

Replace the `IdField` block with:

```tsx
          <View style={styles.idFields}>
            <IdField label="HOLDER / 명의" value="문화 탐험가" />
            <IdField label="여권번호" value={`No. ${passportNo}`} />
            <IdField label="발급" value={issue} />
            <IdField label="발견 카드" value={`${discoveredCount}장`} />
            <IdField label="가고 싶어요" value={`${wishlistCount}개`} />
            <IdField label="도장 수" value={`${visitedCount}개`} />
            <IdField label="취향" value={taste} />
          </View>
```

Update MRZ line 2:

```ts
  const mrz2 = `${passportNo}<<<KOR<ENTRY${String(discoveredCount).padStart(2, '0')}<PLAN${String(wishlistCount).padStart(2, '0')}<STAMPS${String(visitedCount).padStart(2, '0')}`;
```

- [ ] **Step 2: Run focused lint**

Run:

```bash
./node_modules/.bin/eslint src/components/passport/PassportPages.tsx
```

Expected: no lint errors.

- [ ] **Step 3: Commit**

Run:

```bash
git add src/components/passport/PassportPages.tsx
git commit -m "feat: show passport section counts on identity page"
```

Expected: commit only `PassportPages.tsx`.

---

### Task 5: Refactor Passport Screen Into One Book

**Files:**
- Modify: `src/pages/passport.tsx`

- [ ] **Step 1: Update imports**

In `src/pages/passport.tsx`, update the React Native import to include `FlatList`, `NativeScrollEvent`, and `NativeSyntheticEvent`:

```ts
import {
  Animated,
  FlatList,
  Linking,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
```

Add component imports:

```ts
import {
  PassportBookStatePage,
  PassportIndexRail,
  PassportTicketBookPage,
  type PassportBookmarkItem,
} from '../components/passport/PassportBookPages';
```

Update saved row imports:

```ts
import type { SavedTicketItem, SaveButtonState, VisitButtonState } from '../components/saved/SavedTicketRow';
```

Update logic imports:

```ts
import {
  buildPassportBookPages,
  getActivePassportBookmark,
  getPassportSectionCopy,
  getPassportSectionIndexes,
  type PassportBookPage,
  type PassportBookmarkSection,
  type PassportContentSection,
} from './passportLogic';
```

- [ ] **Step 2: Remove segment and ledger-only code**

Remove:

```ts
type LedgerIconName = 'icon-ticket-mono' | 'icon-bookmark-mono';
```

Remove the functions:

- `formatRecordCount`
- `PassportLedgerPage`
- `PassportLedgerState`
- `PassportLedgerLoading`
- `chunkStamps`

Remove state:

```ts
const [segment, setSegment] = useState<PassportSegment>('discovered');
```

Remove the old `STAMPS_PER_PAGE` constant from `src/pages/passport.tsx`. Stamp page chunking now comes from `buildPassportBookPages`.

- [ ] **Step 3: Add book state and save state**

Inside `PassportPage`, add:

```ts
  const bookListRef = useRef<FlatList<PassportBookPage<SavedTicketItem, PassportStamp>>>(null);
  const [currentBookPage, setCurrentBookPage] = useState(0);
  const [savingIds, setSavingIds] = useState<Set<string>>(() => new Set());
```

Add local helper after `getVisitState`:

```ts
  const savedIds = useMemo(() => new Set(savedItems.map((item) => item.id)), [savedItems]);

  const getSaveState = useCallback((id: string): SaveButtonState => {
    if (savingIds.has(id)) return 'loading';
    if (savedIds.has(id)) return 'saved';
    return 'idle';
  }, [savedIds, savingIds]);

  const getStampSignal = useCallback((id: string) => stampSignals[id] ?? 0, [stampSignals]);
```

Add save toggle handler:

```ts
  const handleToggleSave = useCallback(async (item: SavedTicketItem) => {
    if (savingIds.has(item.id)) return;
    addId(setSavingIds, item.id);
    try {
      const result = await toggleLike(item.id, {
        title: item.title,
        startAt: item.startAt ?? undefined,
        endAt: item.endAt ?? undefined,
        venue: item.venue ?? undefined,
        region: item.region ?? undefined,
        mainCategory: item.category ?? undefined,
        subCategory: item.subCategory ?? undefined,
      });
      if (result.liked) {
        userEventService.logEventSave(item.id).catch(() => {});
        setSavedItems((prev) => (
          prev.some((saved) => saved.id === item.id) ? prev : [item, ...prev]
        ));
        showToast({ title: '가고 싶어요에 저장했어요' });
      } else {
        userEventService.logEventUnsave(item.id).catch(() => {});
        setSavedItems((prev) => prev.filter((saved) => saved.id !== item.id));
        showToast({ title: '저장을 취소했어요' });
      }
    } catch (error) {
      showToast({ title: '저장 상태를 바꾸지 못했어요', description: '잠시 후 다시 시도해 주세요.' });
      if (__DEV__) console.error('[PassportPage][toggleSave]', error);
    } finally {
      removeId(setSavingIds, item.id);
    }
  }, [savingIds, showToast]);
```

Import `toggleLike` and `userEventService`:

```ts
import userEventService from '../services/userEventService';
import { getLikesV2, subscribeStorageChange, toggleLike, type StoredEventItemV2 } from '../utils/storage';
```

- [ ] **Step 4: Build book pages and bookmark state**

After count derivation, add:

```ts
  const pendingSavedCount = useMemo(
    () => savedItems.filter((item) => !visitedIds.has(item.id)).length,
    [savedItems, visitedIds],
  );

  const bookPages = useMemo(
    () => buildPassportBookPages<SavedTicketItem, PassportStamp>({
      discoveredItems,
      wishlistItems: savedItems,
      stamps,
      visitedIds,
      passportLoading,
      passportError,
      savedLoading,
      savedError,
    }),
    [
      discoveredItems,
      passportError,
      passportLoading,
      savedError,
      savedItems,
      savedLoading,
      stamps,
      visitedIds,
    ],
  );

  const bookmarkIndexes = useMemo(() => getPassportSectionIndexes(bookPages), [bookPages]);
  const activeBookmark = getActivePassportBookmark(bookPages, currentBookPage);
  const bookmarkItems: PassportBookmarkItem[] = useMemo(() => [
    { section: 'cover', label: '표지' },
    { section: 'discovered', label: '발견' },
    { section: 'wishlist', label: '예정' },
    { section: 'stamps', label: '도장' },
  ], []);
```

Add page movement handlers:

```ts
  const handleBookMomentumEnd = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const nextIndex = Math.round(event.nativeEvent.contentOffset.x / Math.max(pageWidth, 1));
    setCurrentBookPage(Math.max(0, Math.min(nextIndex, bookPages.length - 1)));
  }, [bookPages.length, pageWidth]);

  const handlePressBookmark = useCallback((section: PassportBookmarkSection) => {
    const index = bookmarkIndexes[section];
    setCurrentBookPage(index);
    bookListRef.current?.scrollToIndex({ index, animated: true });
  }, [bookmarkIndexes]);
```

- [ ] **Step 5: Replace the segment render with the book renderer**

Remove the entire segment row and conditional `segment === ...` render block.

Insert:

```tsx
        <View style={styles.bookStage}>
          <FlatList
            ref={bookListRef}
            horizontal
            pagingEnabled
            data={bookPages}
            keyExtractor={(item) => item.key}
            renderItem={({ item }) => renderBookPage(item)}
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={handleBookMomentumEnd}
            getItemLayout={(_, index) => ({
              length: pageWidth,
              offset: pageWidth * index,
              index,
            })}
          />
          <PassportIndexRail
            items={bookmarkItems}
            activeSection={activeBookmark}
            onPress={handlePressBookmark}
          />
        </View>
        <Text style={styles.bookHint}>책갈피를 누르거나 옆으로 넘겨요</Text>
```

Before `return`, add `renderBookPage`:

```tsx
  const renderStateCopy = useCallback((section: PassportContentSection) => {
    if (section === 'wishlist') return getPassportSectionCopy('wishlist');
    if (section === 'stamps') return getPassportSectionCopy('visited');
    return getPassportSectionCopy('discovered');
  }, []);

  const renderBookPage = useCallback((page: PassportBookPage<SavedTicketItem, PassportStamp>) => {
    if (page.type === 'cover') {
      return <PassportCoverPage width={pageWidth} passportNo={passportNo} />;
    }
    if (page.type === 'identity') {
      return (
        <PassportIdentityPage
          width={pageWidth}
          passportNo={passportNo}
          discoveredCount={discoveredCount}
          wishlistCount={pendingSavedCount}
          visitedCount={visitedCount}
          monthLabel={issueMonth}
          tasteCategories={tasteCategories}
        />
      );
    }
    if (page.type === 'discovered') {
      return (
        <PassportTicketBookPage
          width={pageWidth}
          copy={getPassportSectionCopy('discovered')}
          mode="discovered"
          pageIndex={page.pageIndex}
          totalPages={bookPages.filter((candidate) => candidate.type === 'discovered').length}
          items={page.items}
          getVisitState={getVisitState}
          getSaveState={getSaveState}
          getStampSignal={getStampSignal}
          onPressTicket={handleTicketPress}
          onDirections={handleDirections}
          onVisit={handleVisit}
          onToggleSave={handleToggleSave}
        />
      );
    }
    if (page.type === 'wishlist') {
      return (
        <PassportTicketBookPage
          width={pageWidth}
          copy={getPassportSectionCopy('wishlist')}
          mode="wishlist"
          pageIndex={page.pageIndex}
          totalPages={bookPages.filter((candidate) => candidate.type === 'wishlist').length}
          items={page.items}
          getVisitState={getVisitState}
          getSaveState={getSaveState}
          getStampSignal={getStampSignal}
          onPressTicket={handleTicketPress}
          onDirections={handleDirections}
          onVisit={handleVisit}
          onToggleSave={handleToggleSave}
        />
      );
    }
    if (page.type === 'stamps') {
      return (
        <PassportStampPage
          width={pageWidth}
          stamps={page.stamps}
          pageIndex={page.pageIndex}
          pageMonthLabel={pageMonthLabel(page.stamps)}
          onPressStamp={handlePressStamp}
        />
      );
    }
    return (
      <PassportBookStatePage
        width={pageWidth}
        section={page.section}
        copy={renderStateCopy(page.section)}
        state={page.type}
        onRetry={refresh}
      />
    );
  }, [
    bookPages,
    discoveredCount,
    getSaveState,
    getStampSignal,
    getVisitState,
    handleDirections,
    handlePressStamp,
    handleTicketPress,
    handleToggleSave,
    handleVisit,
    issueMonth,
    pageWidth,
    passportNo,
    pendingSavedCount,
    refresh,
    renderStateCopy,
    tasteCategories,
    visitedCount,
  ]);
```

- [ ] **Step 6: Replace styles**

Remove styles only used by old segments and ledger:

```ts
segRow
segItem
segItemActive
segText
segTextActive
ledgerShell
ledgerTopWash
ledgerFrame
ledgerHeader
ledgerHeaderText
ledgerEyebrow
ledgerTitle
ledgerDescription
ledgerSeal
ledgerCountBox
ledgerCountLabel
ledgerCountValue
ledgerDivider
ledgerBody
ledgerList
ledgerState
ledgerStateTitle
ledgerStateDesc
loadingBox
loadingText
errorBox
errorTitle
errorDesc
emptyPage
emptyPageTitle
emptyPageDesc
retryButton
retryText
```

Add:

```ts
  bookStage: {
    height: 520,
    marginHorizontal: -20,
    position: 'relative',
  },
```

Keep:

```ts
  bookHint: {
    marginTop: 12,
    textAlign: 'center',
    color: ON_BG_MUTED,
    fontSize: 12.5,
    fontWeight: '700',
  },
```

- [ ] **Step 7: Run focused tests and lint**

Run:

```bash
npm test -- src/pages/__tests__/passportLogic.test.ts src/components/saved/savedTicketUtils.test.ts --runInBand --watchman=false
./node_modules/.bin/eslint src/pages/passport.tsx src/pages/passportLogic.ts src/components/passport/PassportBookPages.tsx src/components/passport/PassportPages.tsx src/components/saved/SavedTicketRow.tsx
```

Expected: tests pass and lint reports no errors.

- [ ] **Step 8: Commit**

Run:

```bash
git add src/pages/passport.tsx src/pages/passportLogic.ts src/components/passport/PassportBookPages.tsx src/components/passport/PassportPages.tsx src/components/saved/SavedTicketRow.tsx src/pages/__tests__/passportLogic.test.ts
git commit -m "feat: render passport as one book"
```

Expected: commit only passport book implementation files.

---

### Task 6: Regression Verification

**Files:**
- No source edits expected unless a command finds a defect.

- [ ] **Step 1: Run focused frontend tests**

Run:

```bash
npm test -- src/pages/__tests__/passportLogic.test.ts src/pages/__tests__/pointsLogic.test.ts src/components/culture-card/__tests__/homeLogic.test.ts src/components/saved/savedTicketUtils.test.ts --runInBand --watchman=false
```

Expected: all suites pass.

- [ ] **Step 2: Run backend route tests**

Run:

```bash
TS_NODE_PROJECT=backend/tsconfig.json TS_NODE_TRANSPILE_ONLY=1 node --test backend/tests/unit/routes/culturecard-routes.test.js
```

Expected: 11 tests pass. A logged warning for skipped legacy ticket history sources is acceptable because that test intentionally simulates missing legacy tables.

- [ ] **Step 3: Run lint on changed files**

Run:

```bash
./node_modules/.bin/eslint src/pages/passport.tsx src/pages/passportLogic.ts src/pages/__tests__/passportLogic.test.ts src/components/passport/PassportBookPages.tsx src/components/passport/PassportPages.tsx src/components/saved/SavedTicketRow.tsx src/pages/points.tsx src/pages/pointsLogic.ts src/components/passport/TicketHistoryList.tsx backend/src/routes/tickets.ts backend/src/routes/passport.ts backend/src/routes/cards.ts pages/events/[id].tsx
```

Expected: no lint errors.

- [ ] **Step 4: Run backend typecheck**

Run:

```bash
./node_modules/.bin/tsc --noEmit --pretty false --skipLibCheck --project backend/tsconfig.json
```

Expected: no backend type errors.

- [ ] **Step 5: Run full typecheck and filter changed files**

Run:

```bash
npm run typecheck -- --pretty false
```

Expected: this repository currently has pre-existing type errors in `backend/admin-web`, `backend/src`, and `scripts`. If the command fails, confirm the new passport files are not present in the error list:

```bash
./node_modules/.bin/tsc --noEmit --pretty false 2>&1 | rg "src/pages/passport|src/pages/__tests__/passportLogic|src/pages/passportLogic|src/components/passport/PassportBookPages|src/components/passport/PassportPages|src/components/saved/SavedTicketRow"
```

Expected filtered output: empty.

- [ ] **Step 6: Check whitespace**

Run:

```bash
git diff --check
```

Expected: no whitespace errors.

- [ ] **Step 7: Final commit if verification required fixes**

If any verification fix was needed, run:

```bash
git add src/pages/passport.tsx src/pages/passportLogic.ts src/pages/__tests__/passportLogic.test.ts src/components/passport/PassportBookPages.tsx src/components/passport/PassportPages.tsx src/components/saved/SavedTicketRow.tsx
git commit -m "fix: stabilize passport book flow"
```

Expected: commit only files changed by verification fixes.
