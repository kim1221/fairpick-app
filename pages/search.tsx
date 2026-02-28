import { createRoute } from '@granite-js/react-native';
import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  View,
  Pressable,
  StyleSheet,
  ScrollView,
  FlatList,
} from 'react-native';
import { Txt, SearchField, Icon } from '@toss/tds-react-native';
import { BottomSheet } from '@toss/tds-react-native';
import { useAdaptive } from '@toss/tds-react-native/private';
import eventService from '../src/services/eventService';
import userEventService from '../src/services/userEventService';
import { EventCardData } from '../src/data/events';
import SearchSuggestions from '../src/components/SearchSuggestions';
import SearchResults from '../src/components/SearchResults';
import {
  getSearchHistory,
  saveSearchTerm,
  removeSearchTerm,
  clearSearchHistory,
} from '../src/utils/searchStorage';

// ─────────────────────────────────────────────────
// 인기 검색어 풀 (22개) — 마운트 시 8개 랜덤 추출
// ─────────────────────────────────────────────────
interface KeywordFilters {
  query?: string;
  category?: string;
  isFree?: boolean;
  endingSoon?: boolean;
  sortBy?: string;
  order?: 'asc' | 'desc';
}

interface KeywordEntry {
  term: string;
  isNew?: boolean;
  filters?: KeywordFilters;
}

const KEYWORD_POOL: KeywordEntry[] = [
  { term: '이번 주 마감', isNew: true,
    filters: { query: '', endingSoon: true, sortBy: 'end_at', order: 'asc' } },
  { term: '무료 관람',
    filters: { query: '', isFree: true } },
  { term: '아이와 함께',
    filters: { query: '어린이' } },
  { term: '대학로 연극',
    filters: { query: '대학로', category: '공연' } },
  { term: '무료 전시',
    filters: { query: '', category: '전시', isFree: true } },
  { term: '봄 콘서트', isNew: true,
    filters: { query: '봄', category: '공연' } },
  { term: '내한 공연',
    filters: { query: '내한' } },
  { term: '팝업스토어',
    filters: { query: '', category: '팝업' } },
  { term: '전통 국악',
    filters: { query: '국악' } },
  { term: '특별 전시',
    filters: { query: '특별전' } },
  { term: '비틀쥬스',    isNew: true },
  { term: '위키드',      isNew: true },
  { term: '센과 치히로', isNew: true },
  { term: '데스노트' },
  { term: '킹키부츠' },
  { term: '콘서트' },
  { term: '클래식' },
  { term: '연극' },
  { term: '재즈' },
  { term: '오페라' },
  { term: '예술의전당' },
  { term: '페스티벌' },
];

function pickRandom(pool: KeywordEntry[], n: number): KeywordEntry[] {
  return [...pool].sort(() => Math.random() - 0.5).slice(0, n);
}

const QUICK_FILTER_MAP: Record<string, {
  label: string;
  sortBy?: string;
  order?: 'asc' | 'desc';
  isFree?: boolean;
  isEndingSoon?: boolean;
}> = {
  free:         { label: '무료',     isFree: true },
  ending_soon:  { label: '마감임박', sortBy: 'end_at',      order: 'asc',  isEndingSoon: true },
  hot:          { label: '인기',     sortBy: 'buzz_score',  order: 'desc' },
  new:          { label: '신규',     sortBy: 'created_at',  order: 'desc' },
};

interface SortOption {
  id: string;
  label: string;
  sortBy?: string;
  order?: 'asc' | 'desc';
}

const SORT_OPTIONS: SortOption[] = [
  { id: 'relevance', label: '관련도순' },
  { id: 'newest',    label: '최신순',   sortBy: 'created_at', order: 'desc' },
  { id: 'ending',    label: '마감임박순', sortBy: 'end_at',     order: 'asc' },
];

interface SearchParams {
  category?: string | null;
  region?: string | null;
  quickFilter?: string | null;
}

export const Route = createRoute('/search', {
  component: SearchPage,
});

function SearchPage() {
  const adaptive = useAdaptive();
  const navigation = Route.useNavigation();
  const params = Route.useParams() as SearchParams;

  // ── 검색 입력 상태 (타이핑 중 텍스트) ──────────
  const [query, setQuery] = useState('');
  // ── 실제로 검색이 실행된 쿼리 (버튼/엔터/제안 클릭 시 세팅) ──
  const [submittedQuery, setSubmittedQuery] = useState('');

  const [results, setResults] = useState<EventCardData[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [searchMode, setSearchMode] = useState<'text' | 'vector' | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const currentPageRef = useRef(1);

  const [recentSearches, setRecentSearches] = useState<string[]>([]);

  const [activeCategory, setActiveCategory] = useState<string | null>(params.category ?? null);
  const [activeRegion, setActiveRegion] = useState<string | null>(params.region ?? null);
  const [activeQuickFilter, setActiveQuickFilter] = useState<string | null>(params.quickFilter ?? null);

  const [activeKeywordFilters, setActiveKeywordFilters] = useState<KeywordFilters | null>(null);

  const [displayKeywords] = useState<KeywordEntry[]>(() => pickRandom(KEYWORD_POOL, 8));

  const [sortOption, setSortOption] = useState<SortOption>(() => SORT_OPTIONS[0] as SortOption);
  const [showSortSheet, setShowSortSheet] = useState(false);

  const isFetchingRef = useRef(false);
  const loadMoreTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── 자동완성 제안: query 입력 중 최근+인기 검색어에서 매칭 ──
  const autocompleteSuggestions = useMemo(() => {
    const trimmed = query.trim();
    if (!trimmed || submittedQuery === query) return [];

    const lower = trimmed.toLowerCase();
    const recentMatches = recentSearches
      .filter(t => t.toLowerCase().includes(lower) && t !== trimmed)
      .slice(0, 3)
      .map(term => ({ term, source: 'recent' as const }));

    const keywordMatches = KEYWORD_POOL
      .filter(k => k.term.toLowerCase().includes(lower) && k.term !== trimmed)
      .slice(0, 5)
      .map(k => ({ term: k.term, source: 'popular' as const, entry: k }));

    // 중복 제거
    const seen = new Set(recentMatches.map(r => r.term));
    const dedupedKeywords = keywordMatches.filter(k => !seen.has(k.term));

    return [...recentMatches, ...dedupedKeywords].slice(0, 6);
  }, [query, submittedQuery, recentSearches]);

  // ── 초기 로딩 ──────────────────────────────────────
  useEffect(() => {
    loadRecentSearches();
  }, []);

  // ── 검색 실행 트리거: submittedQuery / 필터 변경 시 ──
  useEffect(() => {
    const kwf = activeKeywordFilters;
    const hasKwFilter = !!(kwf?.isFree || kwf?.endingSoon || kwf?.category || kwf?.query);
    if (submittedQuery.trim() || hasKwFilter) {
      if (loadMoreTimerRef.current) clearTimeout(loadMoreTimerRef.current);
      currentPageRef.current = 1;
      performSearch(submittedQuery, activeCategory, activeRegion, activeQuickFilter, sortOption, 1, true, kwf ?? undefined);
    } else {
      if (loadMoreTimerRef.current) clearTimeout(loadMoreTimerRef.current);
      setResults([]);
      setTotalCount(0);
      setSearchMode(null);
      setHasMore(true);
      currentPageRef.current = 1;
    }
  }, [submittedQuery, activeCategory, activeRegion, activeQuickFilter, sortOption, activeKeywordFilters]);

  // ─────────────────────────────────────────────────
  // 검색 실행
  // ─────────────────────────────────────────────────
  const performSearch = async (
    text: string,
    category: string | null,
    region: string | null,
    quickFilter: string | null,
    sort: SortOption,
    targetPage: number,
    reset: boolean,
    kwFilters?: KeywordFilters,
  ) => {
    if (!reset && isFetchingRef.current) return;
    isFetchingRef.current = true;
    reset ? setLoading(true) : setLoadingMore(true);

    try {
      const qf = quickFilter ? QUICK_FILTER_MAP[quickFilter] : null;

      const effectiveQuery = kwFilters
        ? (kwFilters.query !== undefined ? kwFilters.query || undefined : text || undefined)
        : (text || undefined);

      const effectiveCategory = kwFilters?.category ?? (category || undefined);
      const effectiveSortBy = kwFilters?.sortBy
        ?? (sort.id !== 'relevance' ? sort.sortBy : qf?.sortBy);
      const effectiveOrder = kwFilters?.order
        ?? (sort.id !== 'relevance' ? sort.order : qf?.order);
      const effectiveIsFree = kwFilters?.isFree || qf?.isFree;
      const effectiveEndingSoon = kwFilters?.endingSoon || qf?.isEndingSoon;

      const result = await eventService.getEventList({
        query: effectiveQuery,
        category: effectiveCategory as any,
        region: (region || undefined) as any,
        page: targetPage,
        size: 20,
        sortBy: effectiveSortBy,
        order: effectiveOrder,
        isFree: effectiveIsFree,
        isEndingSoon: effectiveEndingSoon,
      });

      if (reset) {
        setResults(result.items);
      } else {
        setResults(prev => {
          const existingIds = new Set(prev.map(item => item.id));
          const newItems = result.items.filter(item => !existingIds.has(item.id));
          return [...prev, ...newItems];
        });
      }

      setTotalCount(result.totalCount);
      setSearchMode(result.searchMode ?? 'text');
      const loadedCount = (targetPage - 1) * 20 + result.items.length;
      setHasMore(loadedCount < result.totalCount);
      currentPageRef.current = targetPage;

      // 첫 페이지 검색 시에만 로그 수집 (page 2 이상은 무시)
      if (reset && text.trim()) {
        userEventService.logSearchQuery(text.trim(), result.totalCount, result.searchMode ?? 'text', {
          category, region, quickFilter,
        });
      }

    } catch (error) {
      console.error('[Search] Error:', error);
      if (reset) setResults([]);
    } finally {
      isFetchingRef.current = false;
      setLoading(false);
      setLoadingMore(false);
    }
  };

  // ─────────────────────────────────────────────────
  // 최근 검색어 관리
  // ─────────────────────────────────────────────────
  const loadRecentSearches = async () => {
    const history = await getSearchHistory();
    setRecentSearches(history);
  };

  const handleDeleteRecentSearch = async (term: string) => {
    await removeSearchTerm(term);
    await loadRecentSearches();
  };

  const handleClearAllSearches = async () => {
    await clearSearchHistory();
    await loadRecentSearches();
  };

  // ─────────────────────────────────────────────────
  // 검색 제출 — 검색 버튼 / 엔터
  // ─────────────────────────────────────────────────
  const handleSearchSubmit = async () => {
    const trimmed = query.trim();
    if (!trimmed) return;
    await saveSearchTerm(trimmed);
    await loadRecentSearches();
    setSubmittedQuery(trimmed);
  };

  const handleEventPress = async (eventId: string) => {
    if (query.trim()) {
      await saveSearchTerm(query.trim());
      await loadRecentSearches();
    }
    navigation.push('/events/:id', { id: eventId });
  };

  // ─────────────────────────────────────────────────
  // 자동완성 제안 클릭
  // ─────────────────────────────────────────────────
  const handleSuggestionSelect = async (term: string, keywordEntry?: KeywordEntry) => {
    setQuery(term);
    if (keywordEntry?.filters) {
      setActiveCategory(null);
      setActiveRegion(null);
      setActiveQuickFilter(null);
      setActiveKeywordFilters(keywordEntry.filters);
      setSubmittedQuery(term);
    } else {
      setActiveKeywordFilters(null);
      setSubmittedQuery(term);
    }
    await saveSearchTerm(term);
    await loadRecentSearches();
  };

  // ─────────────────────────────────────────────────
  // 필터 관리
  // ─────────────────────────────────────────────────
  const handleRemoveCategory     = () => setActiveCategory(null);
  const handleRemoveRegion       = () => setActiveRegion(null);
  const handleRemoveQuickFilter  = () => setActiveQuickFilter(null);
  const handleResetFilters       = () => {
    setActiveCategory(null);
    setActiveRegion(null);
    setActiveQuickFilter(null);
  };

  // ─────────────────────────────────────────────────
  // 무한 스크롤
  // ─────────────────────────────────────────────────
  const handleLoadMore = () => {
    const kwf = activeKeywordFilters;
    const hasKwFilter = !!(kwf?.isFree || kwf?.endingSoon || kwf?.category || kwf?.query);
    if (!loading && !loadingMore && hasMore && (submittedQuery.trim() || hasKwFilter)) {
      if (loadMoreTimerRef.current) clearTimeout(loadMoreTimerRef.current);
      loadMoreTimerRef.current = setTimeout(() => {
        const nextPage = currentPageRef.current + 1;
        performSearch(submittedQuery, activeCategory, activeRegion, activeQuickFilter, sortOption, nextPage, false, kwf ?? undefined);
      }, 300);
    }
  };

  // ─────────────────────────────────────────────────
  // 키워드 선택 (최근 검색어 / 인기 검색어 클릭)
  // ─────────────────────────────────────────────────
  const handleRecentSelect = async (term: string) => {
    setActiveKeywordFilters(null);
    setQuery(term);
    setSubmittedQuery(term);
    await saveSearchTerm(term);
    await loadRecentSearches();
  };

  const handlePopularKeywordSelect = async (keyword: KeywordEntry) => {
    setActiveCategory(null);
    setActiveRegion(null);
    setActiveQuickFilter(null);
    setActiveKeywordFilters(keyword.filters ?? null);
    setQuery(keyword.term);
    setSubmittedQuery(keyword.term);
    await saveSearchTerm(keyword.term);
    await loadRecentSearches();
  };

  const handleSearchTextChange = (text: string) => {
    if (activeKeywordFilters) setActiveKeywordFilters(null);
    // 텍스트를 바꾸면 이전 결과 숨김 (submittedQuery 초기화)
    if (submittedQuery && text !== submittedQuery) {
      setSubmittedQuery('');
    }
    setQuery(text);
  };

  const handleClose = () => navigation.pop();

  const hasAnyFilter = activeCategory || activeRegion || activeQuickFilter;
  const popularTerms = displayKeywords.map(k => k.term);
  const handlePopularTermPress = (term: string) => {
    const entry = displayKeywords.find(k => k.term === term) ?? { term };
    handlePopularKeywordSelect(entry);
  };

  // 결과 표시 여부: submittedQuery가 있거나 키워드 필터가 활성화된 경우
  const hasKwFilter = !!(activeKeywordFilters?.isFree || activeKeywordFilters?.endingSoon || activeKeywordFilters?.category || activeKeywordFilters?.query);
  const showResults = !!(submittedQuery.trim() || hasKwFilter);
  // 자동완성 제안: 타이핑 중이고 결과 화면이 아닐 때
  const showAutocomplete = query.trim().length > 0 && !showResults && autocompleteSuggestions.length > 0;

  return (
    <View style={[styles.container, { backgroundColor: adaptive.background }]}>
      {/* 검색 헤더 */}
      <View style={[styles.header, { borderBottomColor: adaptive.grey200 }]}>
        <SearchField
          value={query}
          placeholder="이벤트, 장소, 키워드 검색"
          hasClearButton
          autoFocus
          style={styles.searchField}
          onChange={(e) => handleSearchTextChange(e.nativeEvent.text)}
          {...({
            onSubmitEditing: handleSearchSubmit,
            returnKeyType: 'search',
          } as any)}
        />
        <Pressable onPress={handleClose} style={styles.cancelButton}>
          <Txt typography="t5" style={[styles.cancelText, { color: adaptive.grey700 }]}>취소</Txt>
        </Pressable>
      </View>

      {/* 활성 필터 칩 */}
      {hasAnyFilter && (
        <View style={[styles.filterChipsBar, { borderBottomColor: adaptive.grey100 }]}>
          <Txt typography="t6" style={[styles.filterLabel, { color: adaptive.grey500 }]}>검색 범위</Txt>
          {activeCategory && (
            <Pressable style={[styles.activeChip, { backgroundColor: adaptive.blue50 }]} onPress={handleRemoveCategory}>
              <Txt typography="t6" style={[styles.activeChipText, { color: adaptive.blue500 }]}>{activeCategory}</Txt>
              <Icon name="icon-x-circle-mono" size={14} color={adaptive.blue500} />
            </Pressable>
          )}
          {activeRegion && (
            <Pressable style={[styles.activeChip, { backgroundColor: adaptive.blue50 }]} onPress={handleRemoveRegion}>
              <Txt typography="t6" style={[styles.activeChipText, { color: adaptive.blue500 }]}>{activeRegion}</Txt>
              <Icon name="icon-x-circle-mono" size={14} color={adaptive.blue500} />
            </Pressable>
          )}
          {activeQuickFilter && QUICK_FILTER_MAP[activeQuickFilter] && (
            <Pressable style={[styles.activeChip, styles.activeChipQuick]} onPress={handleRemoveQuickFilter}>
              <Txt typography="t6" style={[styles.activeChipText, { color: adaptive.blue500 }]}>
                {QUICK_FILTER_MAP[activeQuickFilter].label}
              </Txt>
              <Icon name="icon-x-circle-mono" size={14} color={adaptive.blue500} />
            </Pressable>
          )}
        </View>
      )}

      {/* 자동완성 제안 드롭다운 */}
      {showAutocomplete && (
        <View style={[styles.autocompleteContainer, { backgroundColor: adaptive.background, borderBottomColor: adaptive.grey200 }]}>
          <FlatList
            data={autocompleteSuggestions}
            keyExtractor={(item, i) => `${item.term}_${i}`}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <Pressable
                style={[styles.autocompleteItem, { borderBottomColor: adaptive.grey100 }]}
                onPress={() => {
                  const keywordEntry = KEYWORD_POOL.find(k => k.term === item.term);
                  handleSuggestionSelect(item.term, keywordEntry);
                }}
              >
                <Icon
                  name={item.source === 'recent' ? 'icon-clock-mono' : 'icon-search-mono'}
                  size={16}
                  color={adaptive.grey400}
                />
                <Txt typography="t5" style={[styles.autocompleteText, { color: adaptive.grey800 }]}>
                  {item.term}
                </Txt>
                {/* 입력된 텍스트 부분을 강조하기 위해 같은 텍스트로 표시 */}
              </Pressable>
            )}
          />
        </View>
      )}

      {/* 검색 전: 최근/인기 검색어 */}
      {!query.trim() && (
        <SearchSuggestions
          recentSearches={recentSearches}
          popularKeywords={displayKeywords as any}
          onSelectRecent={handleRecentSelect as any}
          onSelectPopular={handlePopularKeywordSelect as any}
          onDeleteTerm={handleDeleteRecentSearch}
          onClearAll={handleClearAllSearches}
        />
      )}

      {/* 검색 결과 */}
      {showResults && (
        <SearchResults
          query={submittedQuery}
          results={results}
          totalCount={totalCount}
          searchMode={searchMode}
          loading={loading}
          loadingMore={loadingMore}
          hasMore={hasMore}
          activeCategory={activeCategory}
          activeRegion={activeRegion}
          activeQuickFilter={activeQuickFilter ? QUICK_FILTER_MAP[activeQuickFilter]?.label : null}
          sortLabel={sortOption.label}
          onEventPress={handleEventPress}
          onLoadMore={handleLoadMore}
          onResetFilters={handleResetFilters}
          onSortPress={() => setShowSortSheet(true)}
          popularKeywords={popularTerms}
          onPopularKeywordPress={handlePopularTermPress}
        />
      )}

      {/* 타이핑 중이지만 제안도 결과도 없는 상태 — 힌트 텍스트 */}
      {query.trim() && !showResults && !showAutocomplete && (
        <View style={styles.hintContainer}>
          <Txt typography="t5" style={[styles.hintText, { color: adaptive.grey500 }]}>
            검색 버튼을 눌러 결과를 확인하세요
          </Txt>
        </View>
      )}

      {/* 정렬 BottomSheet */}
      <BottomSheet.Root
        open={showSortSheet}
        onClose={() => setShowSortSheet(false)}
        onDimmerClick={() => setShowSortSheet(false)}
      >
        <BottomSheet.Header>정렬</BottomSheet.Header>
        <ScrollView
          style={styles.sortSheetList}
          contentContainerStyle={{ paddingBottom: 40 }}
          showsVerticalScrollIndicator={false}
        >
          {SORT_OPTIONS.map(opt => (
            <Pressable
              key={opt.id}
              style={[styles.sortSheetItem, { borderBottomColor: adaptive.grey100 }]}
              onPress={() => {
                setSortOption(opt);
                setShowSortSheet(false);
              }}
            >
              <Txt
                typography="t5"
                style={[
                  styles.sortSheetText,
                  { color: adaptive.grey600 },
                  sortOption.id === opt.id && { color: adaptive.grey900, fontWeight: '700' },
                ]}
              >
                {opt.label}
              </Txt>
              {sortOption.id === opt.id && (
                <Icon name="icon-check-mono" size={18} color={adaptive.blue500} />
              )}
            </Pressable>
          ))}
        </ScrollView>
      </BottomSheet.Root>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },

  // ── 검색 헤더 ──────────────────────────────────────
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 10,
    gap: 8,
    borderBottomWidth: 1,
  },
  searchField: {
    flex: 1,
  },
  cancelButton: {
    paddingVertical: 8,
    paddingLeft: 4,
  },
  cancelText: {
    // color via adaptive
  },

  // ── 필터 칩 ──────────────────────────────────────
  filterChipsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
    borderBottomWidth: 1,
    flexWrap: 'wrap',
  },
  filterLabel: {
    marginRight: 2,
  },
  activeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 16,
    gap: 4,
  },
  activeChipQuick: {
    backgroundColor: '#FFF3E6',
  },
  activeChipText: {
    fontWeight: '600',
  },

  // ── 자동완성 드롭다운 ─────────────────────────────
  autocompleteContainer: {
    borderBottomWidth: 1,
    maxHeight: 300,
  },
  autocompleteItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    gap: 12,
    borderBottomWidth: 1,
  },
  autocompleteText: {
    flex: 1,
  },

  // ── 힌트 ─────────────────────────────────────────
  hintContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 80,
  },
  hintText: {
    // color via adaptive
  },

  // ── 정렬 BottomSheet ──────────────────────────────
  sortSheetList: {
    paddingHorizontal: 20,
  },
  sortSheetItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 18,
    borderBottomWidth: 1,
  },
  sortSheetText: {
    // color via adaptive
  },
});
