import { createRoute } from '@granite-js/react-native';
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  TextInput,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { Txt } from '@toss/tds-react-native';
import { BottomSheet } from '@toss/tds-react-native';
import { useAdaptive } from '@toss/tds-react-native/private';
import eventService from '../src/services/eventService';
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
// isNew: true → 추출됐을 때만 N 뱃지 표시
//
// filters 없음  → keyword.term 을 텍스트 검색어로 그대로 사용
// filters.query → 텍스트 검색어 재정의 (''이면 텍스트 검색 없음)
// filters.category / isFree / endingSoon / sortBy / order → 추가 필터/정렬
// ─────────────────────────────────────────────────
interface KeywordFilters {
  query?: string;            // ''이면 텍스트 검색 없음; 값 있으면 그걸로 검색
  category?: string;         // main_category 필터
  isFree?: boolean;          // is_free=true
  endingSoon?: boolean;      // end_at <= 7일 이내
  sortBy?: string;
  order?: 'asc' | 'desc';
}

interface KeywordEntry {
  term: string;              // 화면에 표시되는 레이블
  isNew?: boolean;
  filters?: KeywordFilters;  // 없으면 term 그대로 텍스트 검색
}

const KEYWORD_POOL: KeywordEntry[] = [
  // ── 탐색형 (필터 매핑) ─────────────────────────
  // 텍스트가 아닌 필터로 동작 → 결과 수 충분
  { term: '이번 주 마감', isNew: true,
    filters: { query: '', endingSoon: true, sortBy: 'end_at', order: 'asc' } }, // ~397개
  { term: '무료 관람',
    filters: { query: '', isFree: true } },                                      // ~51개
  { term: '아이와 함께',
    filters: { query: '어린이' } },                                              // ~78개
  { term: '대학로 연극',
    filters: { query: '대학로', category: '공연' } },                           // ~107개
  { term: '무료 전시',
    filters: { query: '', category: '전시', isFree: true } },                   // 전시 중 무료
  { term: '봄 콘서트', isNew: true,
    filters: { query: '봄', category: '공연' } },                               // ~47개
  { term: '내한 공연',
    filters: { query: '내한' } },                                                // ~29개
  { term: '팝업스토어',
    filters: { query: '', category: '팝업' } },                                  // ~14개
  { term: '전통 국악',
    filters: { query: '국악' } },                                                // ~48개
  { term: '특별 전시',
    filters: { query: '특별전' } },                                              // ~16개

  // ── 화제작 (buzz_score 상위 공연 제목) ────────
  { term: '비틀쥬스',    isNew: true },  // 브로드웨이 뮤지컬
  { term: '위키드',      isNew: true },  // 영화·뮤지컬 동시 화제
  { term: '센과 치히로', isNew: true },  // 지브리 오리지널 투어
  { term: '데스노트'  },
  { term: '킹키부츠'  },

  // ── 장르 / 기관 (텍스트 검색) ─────────────────
  { term: '콘서트'     },   // ~519개
  { term: '클래식'     },   // ~52개
  { term: '연극'       },   // ~26개
  { term: '재즈'       },   // ~20개
  { term: '오페라'     },   // ~22개
  { term: '예술의전당' },   // ~262개
  { term: '페스티벌'   },   // ~40개
];

/** 풀에서 n개 랜덤 추출 (Fisher-Yates 기반 sort shuffle) */
function pickRandom(pool: KeywordEntry[], n: number): KeywordEntry[] {
  return [...pool].sort(() => Math.random() - 0.5).slice(0, n);
}

// ─────────────────────────────────────────────────
// 퀵필터 ID → 표시 레이블 + API 파라미터 매핑
// ─────────────────────────────────────────────────
const QUICK_FILTER_MAP: Record<string, {
  label: string;
  sortBy?: string;
  order?: 'asc' | 'desc';
  isFree?: boolean;
  isEndingSoon?: boolean;
}> = {
  free:         { label: '💰 무료',     isFree: true },
  ending_soon:  { label: '⏰ 마감임박', sortBy: 'end_at',      order: 'asc',  isEndingSoon: true },
  hot:          { label: '🔥 인기',     sortBy: 'buzz_score',  order: 'desc' },
  new:          { label: '🆕 신규',     sortBy: 'created_at',  order: 'desc' },
};

// ─────────────────────────────────────────────────
// 정렬 옵션
// ─────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────

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

  // ── 검색 상태 ──────────────────────────────────────
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [isDebouncing, setIsDebouncing] = useState(false);

  const [results, setResults] = useState<EventCardData[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);

  const [recentSearches, setRecentSearches] = useState<string[]>([]);

  // ── 필터: navigation params → local state (X로 제거 가능) ──
  const [activeCategory, setActiveCategory] = useState<string | null>(params.category ?? null);
  const [activeRegion, setActiveRegion] = useState<string | null>(params.region ?? null);
  const [activeQuickFilter, setActiveQuickFilter] = useState<string | null>(params.quickFilter ?? null);

  // ── 키워드 필터: 인기 검색어 클릭 시 적용되는 필터 ──
  const [activeKeywordFilters, setActiveKeywordFilters] = useState<KeywordFilters | null>(null);

  // ── 인기 검색어: 마운트 시 풀에서 8개 랜덤 추출 (리렌더에 유지) ──
  const [displayKeywords] = useState<KeywordEntry[]>(() => pickRandom(KEYWORD_POOL, 8));

  // ── 정렬 상태 ──────────────────────────────────────
  const [sortOption, setSortOption] = useState<SortOption>(SORT_OPTIONS[0]);
  const [showSortSheet, setShowSortSheet] = useState(false);

  // ── 초기 로딩 ──────────────────────────────────────
  useEffect(() => {
    loadRecentSearches();
  }, []);

  // ── 디바운스 (300ms) ──────────────────────────────
  useEffect(() => {
    setIsDebouncing(!!query.trim());
    const timer = setTimeout(() => {
      setDebouncedQuery(query);
      setIsDebouncing(false);
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  // ── 검색 실행 (쿼리 / 필터 / 정렬 변경 시) ──────────
  useEffect(() => {
    const kwf = activeKeywordFilters;
    const hasKwFilter = !!(kwf?.isFree || kwf?.endingSoon || kwf?.category || kwf?.query);
    if (debouncedQuery.trim() || hasKwFilter) {
      setCurrentPage(1);
      performSearch(debouncedQuery, activeCategory, activeRegion, activeQuickFilter, sortOption, 1, true, kwf ?? undefined);
    } else {
      setResults([]);
      setTotalCount(0);
      setHasMore(true);
    }
  }, [debouncedQuery, activeCategory, activeRegion, activeQuickFilter, sortOption, activeKeywordFilters]);

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
    reset ? setLoading(true) : setLoadingMore(true);

    try {
      // quickFilter → API 파라미터로 변환
      const qf = quickFilter ? QUICK_FILTER_MAP[quickFilter] : null;

      // ── 키워드 필터 우선, 없으면 기존 로직 ──────────
      // query: kwFilters.query 있으면 그 값 사용 (''이면 텍스트 검색 없음)
      //        없으면 text 그대로 사용
      const effectiveQuery = kwFilters
        ? (kwFilters.query !== undefined ? kwFilters.query || undefined : text || undefined)
        : (text || undefined);

      // category: kwFilters.category 있으면 우선
      const effectiveCategory = kwFilters?.category ?? (category || undefined);

      // 정렬: kwFilters → sortOption → quickFilter 순
      const effectiveSortBy = kwFilters?.sortBy
        ?? (sort.id !== 'relevance' ? sort.sortBy : qf?.sortBy);
      const effectiveOrder = kwFilters?.order
        ?? (sort.id !== 'relevance' ? sort.order : qf?.order);

      // 무료/마감: kwFilters 또는 quickFilter
      const effectiveIsFree = kwFilters?.isFree || qf?.isFree;
      const effectiveEndingSoon = kwFilters?.endingSoon || qf?.isEndingSoon;

      const result = await eventService.getEventList({
        query: effectiveQuery,
        category: effectiveCategory,
        region: region || undefined,
        page: targetPage,
        size: 20,
        sortBy: effectiveSortBy,
        order: effectiveOrder,
        isFree: effectiveIsFree,
        isEndingSoon: effectiveEndingSoon,
      });

      reset
        ? setResults(result.items)
        : setResults(prev => [...prev, ...result.items]);

      setTotalCount(result.totalCount);
      setHasMore(result.items.length >= 20);
      setCurrentPage(targetPage);
    } catch (error) {
      console.error('[Search] Error:', error);
      if (reset) setResults([]);
    } finally {
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
  // 검색어 저장 — 명확한 의도 2가지
  // ─────────────────────────────────────────────────
  const handleSearchSubmit = async () => {
    if (query.trim()) {
      await saveSearchTerm(query.trim());
      await loadRecentSearches();
    }
  };

  const handleEventPress = async (eventId: string) => {
    if (query.trim()) {
      await saveSearchTerm(query.trim());
      await loadRecentSearches();
    }
    navigation.push('/events/:id', { id: eventId });
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
    if (!loading && !loadingMore && hasMore && (debouncedQuery.trim() || hasKwFilter)) {
      const nextPage = currentPage + 1;
      performSearch(debouncedQuery, activeCategory, activeRegion, activeQuickFilter, sortOption, nextPage, false, kwf ?? undefined);
    }
  };

  // ─────────────────────────────────────────────────
  // 키워드 선택
  // ─────────────────────────────────────────────────
  // 최근 검색어 클릭 — 텍스트 검색만
  const handleRecentSelect = (term: string) => {
    setActiveKeywordFilters(null);
    setQuery(term);
    setDebouncedQuery(term); // 디바운스 스킵
  };

  // 인기 검색어 클릭 — 필터 매핑 적용
  const handlePopularKeywordSelect = (keyword: KeywordEntry) => {
    setActiveCategory(null);
    setActiveRegion(null);
    setActiveQuickFilter(null);
    setActiveKeywordFilters(keyword.filters ?? null);
    setQuery(keyword.term);
    setDebouncedQuery(keyword.term); // 디바운스 스킵
    saveSearchTerm(keyword.term);
  };

  // 텍스트 직접 입력 시 키워드 필터 해제
  const handleSearchTextChange = (text: string) => {
    if (activeKeywordFilters) setActiveKeywordFilters(null);
    setQuery(text);
  };

  const handleClearQuery = () => {
    setQuery('');
    setActiveKeywordFilters(null);
  };

  const handleClose = () => navigation.pop();

  // ─────────────────────────────────────────────────
  // 검색 입력 우측 accessory
  // ─────────────────────────────────────────────────
  const renderSearchAccessory = () => {
    if ((isDebouncing || loading) && query.trim()) {
      return <ActivityIndicator size="small" color="#B0B8C1" style={styles.searchAccessory} />;
    }
    if (query.trim()) {
      return (
        <Pressable onPress={handleClearQuery} style={styles.searchAccessory} hitSlop={8}>
          <Text style={styles.clearButtonIcon}>✕</Text>
        </Pressable>
      );
    }
    return null;
  };

  // 활성 필터 개수 (칩 렌더 여부)
  const hasAnyFilter = activeCategory || activeRegion || activeQuickFilter;

  // SearchResults에 넘길 popularKeywords (문자열 배열)
  const popularTerms = displayKeywords.map(k => k.term);

  // 빈 결과 화면에서 인기 검색어 클릭 시 — term으로 KeywordEntry 찾아 필터 적용
  const handlePopularTermPress = (term: string) => {
    const entry = displayKeywords.find(k => k.term === term) ?? { term };
    handlePopularKeywordSelect(entry);
  };

  return (
    <View style={[styles.container, { backgroundColor: adaptive.background }]}>
      {/* 검색 헤더 */}
      <View style={styles.header}>
        <View style={styles.searchInputContainer}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="이벤트, 장소, 키워드 검색"
            placeholderTextColor="#B0B8C1"
            value={query}
            onChangeText={handleSearchTextChange}
            onSubmitEditing={handleSearchSubmit}
            autoFocus
            returnKeyType="search"
          />
          {renderSearchAccessory()}
        </View>
        <Pressable onPress={handleClose} style={styles.cancelButton}>
          <Txt typography="label1" style={styles.cancelText}>취소</Txt>
        </Pressable>
      </View>

      {/* 활성 필터 칩 — category / region / quickFilter X 버튼으로 개별 해제 */}
      {hasAnyFilter && (
        <View style={styles.filterChipsBar}>
          <Txt typography="label3" style={styles.filterLabel}>검색 범위</Txt>
          {activeCategory && (
            <Pressable style={styles.activeChip} onPress={handleRemoveCategory}>
              <Txt typography="label3" style={styles.activeChipText}>{activeCategory}</Txt>
              <Text style={styles.chipRemoveIcon}> ✕</Text>
            </Pressable>
          )}
          {activeRegion && (
            <Pressable style={styles.activeChip} onPress={handleRemoveRegion}>
              <Txt typography="label3" style={styles.activeChipText}>{activeRegion}</Txt>
              <Text style={styles.chipRemoveIcon}> ✕</Text>
            </Pressable>
          )}
          {activeQuickFilter && QUICK_FILTER_MAP[activeQuickFilter] && (
            <Pressable style={[styles.activeChip, styles.activeChipQuick]} onPress={handleRemoveQuickFilter}>
              <Txt typography="label3" style={styles.activeChipText}>
                {QUICK_FILTER_MAP[activeQuickFilter].label}
              </Txt>
              <Text style={styles.chipRemoveIcon}> ✕</Text>
            </Pressable>
          )}
        </View>
      )}

      {/* 검색 전: 최근/인기 검색어 */}
      {!query.trim() && (
        <SearchSuggestions
          recentSearches={recentSearches}
          popularKeywords={displayKeywords}
          onSelectRecent={handleRecentSelect}
          onSelectPopular={handlePopularKeywordSelect}
          onDeleteTerm={handleDeleteRecentSearch}
          onClearAll={handleClearAllSearches}
        />
      )}

      {/* 검색 후: 결과 리스트 */}
      {query.trim() && (
        <SearchResults
          query={query}
          results={results}
          totalCount={totalCount}
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

      {/* 정렬 BottomSheet */}
      <BottomSheet.Root
        open={showSortSheet}
        onClose={() => setShowSortSheet(false)}
        onDimmerClick={() => setShowSortSheet(false)}
      >
        <BottomSheet.Header title="정렬" />
        <ScrollView
          style={styles.sortSheetList}
          contentContainerStyle={{ paddingBottom: 40 }}
          showsVerticalScrollIndicator={false}
        >
          {SORT_OPTIONS.map(opt => (
            <Pressable
              key={opt.id}
              style={styles.sortSheetItem}
              onPress={() => {
                setSortOption(opt);
                setShowSortSheet(false);
              }}
            >
              <Txt
                typography="body1"
                style={[
                  styles.sortSheetText,
                  sortOption.id === opt.id && styles.sortSheetTextActive,
                ]}
              >
                {opt.label}
              </Txt>
              {sortOption.id === opt.id && (
                <Text style={styles.sortCheckmark}>✓</Text>
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
  },
  searchInputContainer: {
    flex: 1,
    height: 46,
    backgroundColor: '#F5F6F7',
    borderRadius: 12,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  searchIcon: {
    fontSize: 15,
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: '#191F28',
    padding: 0,
  },
  searchAccessory: {
    marginLeft: 6,
  },
  clearButtonIcon: {
    fontSize: 14,
    color: '#B0B8C1',
    fontWeight: '600',
  },
  cancelButton: {
    paddingVertical: 8,
    paddingLeft: 4,
  },
  cancelText: {
    color: '#4E5968',
  },

  // ── 필터 칩 ──────────────────────────────────────
  filterChipsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F2F4F6',
    flexWrap: 'wrap',
  },
  filterLabel: {
    color: '#8B95A1',
    marginRight: 2,
  },
  activeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 5,
    backgroundColor: '#E9F0FF',
    borderRadius: 16,
  },
  activeChipQuick: {
    backgroundColor: '#FFF3E6',
  },
  activeChipText: {
    color: '#1A56C7',
    fontWeight: '600',
  },
  chipRemoveIcon: {
    fontSize: 11,
    color: '#1A56C7',
    fontWeight: '700',
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
    borderBottomColor: '#F2F4F6',
  },
  sortSheetText: {
    color: '#6B7684',
  },
  sortSheetTextActive: {
    color: '#191F28',
    fontWeight: '700',
  },
  sortCheckmark: {
    fontSize: 16,
    color: '#3182F6',
    fontWeight: '700',
  },
});
