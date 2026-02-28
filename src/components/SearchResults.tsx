import React from 'react';
import {
  View,
  Text,
  FlatList,
  Pressable,
  StyleSheet,
} from 'react-native';
import { Txt, Loader, Icon } from '@toss/tds-react-native';
import { useAdaptive } from '@toss/tds-react-native/private';
import { EventCardData } from '../data/events';
import { EventImage } from './EventImage';

type Adaptive = ReturnType<typeof useAdaptive>;

// ─────────────────────────────────────────────────
// 카테고리별 컬러
// ─────────────────────────────────────────────────
const CATEGORY_COLORS: Record<string, { bg: string; text: string }> = {
  '팝업': { bg: '#FFF0E6', text: '#C04000' },
  '전시': { bg: '#F0EAFF', text: '#5B2BBF' },
  '공연': { bg: '#FFF0F0', text: '#B91C1C' },
  '축제': { bg: '#E6FAF2', text: '#0D7A52' },
  '행사': { bg: '#EAF2FF', text: '#1A56C7' },
};

// ─────────────────────────────────────────────────
// 검색어 하이라이팅
// ─────────────────────────────────────────────────
function HighlightText({
  text,
  query,
  baseStyle,
  highlightStyle,
}: {
  text: string;
  query: string;
  baseStyle?: object;
  highlightStyle?: object;
}) {
  if (!query.trim()) {
    return <Text style={baseStyle}>{text}</Text>;
  }

  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // 캡처링 그룹: split 결과에서 홀수 인덱스 = 매치된 부분
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'));

  return (
    <Text style={baseStyle}>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <Text key={i} style={highlightStyle}>{part}</Text>
        ) : (
          <Text key={i}>{part}</Text>
        )
      )}
    </Text>
  );
}

// ─────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────
interface SearchResultsProps {
  query: string;
  results: EventCardData[];
  totalCount: number;
  searchMode?: 'text' | 'vector' | null;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  activeCategory?: string | null;
  activeRegion?: string | null;
  activeQuickFilter?: string | null;
  sortLabel: string;
  onEventPress: (eventId: string) => void;
  onLoadMore: () => void;
  onResetFilters: () => void;
  onSortPress: () => void;
  popularKeywords: string[];
  onPopularKeywordPress: (keyword: string) => void;
}

const createStyles = (a: Adaptive) => StyleSheet.create({
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // ── 결과 없음 ──────────────────────────────────────
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    paddingTop: 60,
    paddingHorizontal: 24,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 3,
  },
  emptyTitle: {
    color: a.grey800,
    textAlign: 'center',
    lineHeight: 26,
  },
  emptyHint: {
    marginTop: 8,
    color: a.grey500,
    textAlign: 'center',
  },
  resetButton: {
    marginTop: 20,
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: a.grey900,
    borderRadius: 10,
  },
  resetButtonText: {
    color: a.background,
  },
  emptyPopular: {
    marginTop: 40,
    alignSelf: 'stretch',
  },
  emptyPopularTitle: {
    color: a.grey500,
    marginBottom: 12,
  },
  emptyPopularChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  emptyPopularChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: a.grey100,
    borderRadius: 20,
  },
  emptyPopularChipText: {
    color: a.grey700,
  },

  // ── 결과 헤더 (카운트 + 정렬) ─────────────────────
  resultHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  resultCountGroup: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  resultCount: {
    color: a.grey800,
  },
  filterContext: {
    color: a.grey500,
  },
  vectorBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    backgroundColor: a.blue50,
    borderRadius: 4,
    color: a.blue500,
  },
  sortButton: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: a.grey100,
    borderRadius: 8,
  },
  sortButtonText: {
    color: a.grey700,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  eventItem: {
    flexDirection: 'row',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: a.grey100,
    alignItems: 'flex-start',
  },
  thumbWrapper: {
    borderRadius: 10,
    overflow: 'hidden',
  },
  eventInfo: {
    flex: 1,
    marginLeft: 12,
  },
  categoryBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 5,
    marginBottom: 6,
  },
  categoryText: {
    fontSize: 11,
    fontWeight: '600',
  },
  title: {
    fontSize: 14,
    fontWeight: '600',
    color: a.grey900,
    lineHeight: 20,
    marginBottom: 6,
  },
  highlightText: {
    fontWeight: '800',
    color: a.blue500,
  },
  metaText: {
    color: a.grey600,
    marginBottom: 3,
  },
  metaPeriod: {
    color: a.grey500,
  },
  tagRow: {
    flexDirection: 'row',
    marginTop: 8,
    gap: 6,
  },
  freeTag: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    backgroundColor: '#E6FAF0',
    borderRadius: 5,
  },
  freeTagText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#0D7A52',
  },
  endingTag: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    backgroundColor: '#FFF0F0',
    borderRadius: 5,
  },
  endingTagText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#B91C1C',
  },

  // ── 푸터 ──────────────────────────────────────────
  footerLoader: {
    marginVertical: 20,
  },
  endText: {
    textAlign: 'center',
    color: a.grey400,
    paddingVertical: 20,
  },
});

export default function SearchResults({
  query,
  results,
  totalCount,
  searchMode,
  loading,
  loadingMore,
  hasMore,
  activeCategory,
  activeRegion,
  activeQuickFilter,
  sortLabel,
  onEventPress,
  onLoadMore,
  onResetFilters,
  onSortPress,
  popularKeywords,
  onPopularKeywordPress,
}: SearchResultsProps) {
  const adaptive = useAdaptive();
  const styles = React.useMemo(() => createStyles(adaptive), [adaptive]);

  const isVectorSearch = searchMode === 'vector';
  // 필터 컨텍스트 레이블 ("팝업 · 서울 내 검색결과")
  const filterContextParts: string[] = [];
  if (activeCategory) filterContextParts.push(activeCategory);
  if (activeRegion) filterContextParts.push(activeRegion);
  if (activeQuickFilter) filterContextParts.push(activeQuickFilter);
  const filterContext = filterContextParts.length > 0
    ? `${filterContextParts.join(' · ')} 내 검색결과`
    : null;
  // ── 초기 로딩 ────────────────────────────────────
  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <Loader size="large" type="primary" />
      </View>
    );
  }

  // ── 결과 없음 ────────────────────────────────────
  if (results.length === 0) {
    const hasFilter = activeCategory || activeRegion;
    const filterDesc = [activeCategory, activeRegion].filter(Boolean).join(' · ');

    return (
      <View style={styles.emptyContainer}>
        <Icon name="icon-search-bold-mono" size={40} color={adaptive.grey400} style={{ marginBottom: 16 }} />

        {hasFilter ? (
          <>
            <Txt typography="t5" style={styles.emptyTitle}>
              '{filterDesc}' 범위에서
            </Txt>
            <Txt typography="t5" style={styles.emptyTitle}>
              '{query}'에 대한 결과가 없어요
            </Txt>
            <Pressable style={styles.resetButton} onPress={onResetFilters}>
              <Txt typography="t6" style={styles.resetButtonText}>
                필터 초기화하고 전체 검색하기
              </Txt>
            </Pressable>
          </>
        ) : (
          <>
            <Txt typography="t5" style={styles.emptyTitle}>
              '{query}'에 대한 결과가 없어요
            </Txt>
            <Txt typography="t6" style={styles.emptyHint}>
              다른 키워드로 검색해보세요
            </Txt>
          </>
        )}

        {/* 인기 검색어 제안 */}
        <View style={styles.emptyPopular}>
          <Txt typography="t6" style={styles.emptyPopularTitle}>인기 검색어</Txt>
          <View style={styles.emptyPopularChips}>
            {popularKeywords.slice(0, 6).map((keyword, i) => (
              <Pressable
                key={i}
                style={styles.emptyPopularChip}
                onPress={() => onPopularKeywordPress(keyword)}
              >
                <Txt typography="t7" style={styles.emptyPopularChipText}>{keyword}</Txt>
              </Pressable>
            ))}
          </View>
        </View>
      </View>
    );
  }

  // ── 결과 있음 ────────────────────────────────────
  return (
    <FlatList
      data={results}
      keyExtractor={(item) => item.id}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={() => (
        <View style={styles.resultHeader}>
          <View style={styles.resultCountGroup}>
            <Txt typography="t6" style={styles.resultCount}>
              {isVectorSearch
                ? `연관 추천 ${totalCount.toLocaleString()}개`
                : `총 ${totalCount.toLocaleString()}개`}
            </Txt>
            {isVectorSearch && (
              <Txt typography="t7" style={styles.vectorBadge}>
                AI 추천
              </Txt>
            )}
            {filterContext && (
              <Txt typography="t7" style={styles.filterContext}>
                {filterContext}
              </Txt>
            )}
          </View>
          <Pressable style={styles.sortButton} onPress={onSortPress}>
            <Txt typography="t7" style={styles.sortButtonText}>{sortLabel} ▾</Txt>
          </Pressable>
        </View>
      )}
      renderItem={({ item }) => {
        const catColor = CATEGORY_COLORS[item.mainCategory ?? item.category] ?? { bg: '#F2F4F6', text: '#4E5968' };

        return (
          <Pressable style={styles.eventItem} onPress={() => onEventPress(item.id)}>
            {/* 썸네일 — 3:4 세로형 */}
            <View style={styles.thumbWrapper}>
              <EventImage
                uri={item.thumbnailUrl}
                width={80}
                height={107}
                borderRadius={10}
                category={item.category}
              />
            </View>

            {/* 정보 영역 */}
            <View style={styles.eventInfo}>
              {/* 카테고리 배지 */}
              <View style={[styles.categoryBadge, { backgroundColor: catColor.bg }]}>
                <Text style={[styles.categoryText, { color: catColor.text }]}>
                  {item.mainCategory ?? item.category}
                </Text>
              </View>

              {/* 제목 — 검색어 하이라이팅 */}
              <HighlightText
                text={item.title}
                query={query}
                baseStyle={styles.title}
                highlightStyle={styles.highlightText}
              />

              {/* 장소 */}
              <View style={styles.metaRow}>
                <Icon name="icon-pin-mono" size={11} color={adaptive.grey600} style={{ marginRight: 3 }} />
                <Txt typography="t7" style={[styles.metaText, { flex: 1 }]} numberOfLines={1}>
                  {item.venue || item.region}
                </Txt>
              </View>

              {/* 기간 */}
              <View style={styles.metaRow}>
                <Icon name="icon-calendar-check-mono" size={11} color={adaptive.grey500} style={{ marginRight: 3 }} />
                <Txt typography="t7" style={styles.metaPeriod}>
                  {item.periodText}
                </Txt>
              </View>

              {/* 무료/마감임박 태그 */}
              {(item.isFree || item.isEndingSoon) && (
                <View style={styles.tagRow}>
                  {item.isFree && (
                    <View style={styles.freeTag}>
                      <Text style={styles.freeTagText}>무료</Text>
                    </View>
                  )}
                  {item.isEndingSoon && (
                    <View style={styles.endingTag}>
                      <Text style={styles.endingTagText}>마감임박</Text>
                    </View>
                  )}
                </View>
              )}
            </View>
          </Pressable>
        );
      }}
      onEndReached={onLoadMore}
      onEndReachedThreshold={0.1}
      ListFooterComponent={
        loadingMore ? (
          <Loader size="small" type="primary" style={styles.footerLoader} />
        ) : !hasMore && results.length > 0 ? (
          <Txt typography="t7" style={styles.endText}>모든 결과를 불러왔어요</Txt>
        ) : null
      }
      contentContainerStyle={styles.listContent}
      showsVerticalScrollIndicator={false}
    />
  );
}
