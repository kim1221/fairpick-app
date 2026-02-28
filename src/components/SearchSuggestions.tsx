import React from 'react';
import { View, Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { Txt, Icon } from '@toss/tds-react-native';
import { useAdaptive } from '@toss/tds-react-native/private';

type Adaptive = ReturnType<typeof useAdaptive>;

// search.tsx의 KeywordEntry와 동일 구조 (filters 포함)
interface PopularKeyword {
  term: string;
  isNew?: boolean;
  filters?: Record<string, unknown>;
}

interface SearchSuggestionsProps {
  recentSearches: string[];
  popularKeywords: PopularKeyword[];
  onSelectRecent: (term: string) => void;
  onSelectPopular: (keyword: PopularKeyword) => void;
  onDeleteTerm: (term: string) => void;
  onClearAll: () => void;
}

const createStyles = (a: Adaptive) => StyleSheet.create({
  container: {
    flex: 1,
  },
  contentContainer: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 40,
  },
  section: {
    marginBottom: 32,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sectionTitle: {
    color: a.grey900,
  },
  clearAllText: {
    color: a.grey500,
  },
  // 최근 검색어 리스트
  recentItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: a.grey100,
  },
  recentText: {
    flex: 1,
    color: a.grey800,
  },
  deleteButton: {
    paddingLeft: 12,
  },

  // 인기 검색어 칩
  keywordGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  keywordChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: a.grey100,
    borderRadius: 20,
    gap: 5,
  },
  keywordText: {
    color: a.grey700,
  },
  newBadge: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    backgroundColor: a.blue500,
    borderRadius: 4,
  },
  newBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#FFFFFF',
  },
});

export default function SearchSuggestions({
  recentSearches,
  popularKeywords,
  onSelectRecent,
  onSelectPopular,
  onDeleteTerm,
  onClearAll,
}: SearchSuggestionsProps) {
  const adaptive = useAdaptive();
  const styles = React.useMemo(() => createStyles(adaptive), [adaptive]);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {/* 최근 검색어 — 개인화 정보이므로 상단 */}
      {recentSearches.length > 0 && (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Txt typography="t5" style={styles.sectionTitle}>최근 검색</Txt>
            <Pressable onPress={onClearAll} hitSlop={8}>
              <Txt typography="t7" style={styles.clearAllText}>전체 삭제</Txt>
            </Pressable>
          </View>

          {recentSearches.map((term, index) => (
            <Pressable
              key={`recent-${index}`}
              style={styles.recentItem}
              onPress={() => onSelectRecent(term)}
            >
              <Icon name="icon-clock-mono" size={14} color={adaptive.grey500} style={{ marginRight: 10 }} />
              <Txt typography="t6" style={styles.recentText}>{term}</Txt>
              <Pressable
                onPress={() => onDeleteTerm(term)}
                hitSlop={8}
                style={styles.deleteButton}
              >
                <Icon name="icon-x-mono" size={13} color={adaptive.grey400} />
              </Pressable>
            </Pressable>
          ))}
        </View>
      )}

      {/* 인기 검색어 — 주차 레이블 + isNew 뱃지 */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Txt typography="t5" style={styles.sectionTitle}>인기 검색어</Txt>
        </View>
        <View style={styles.keywordGrid}>
          {popularKeywords.map((keyword, index) => (
            <Pressable
              key={`popular-${index}`}
              style={styles.keywordChip}
              onPress={() => onSelectPopular(keyword)}
            >
              <Txt typography="t7" style={styles.keywordText}>{keyword.term}</Txt>
              {keyword.isNew && (
                <View style={styles.newBadge}>
                  <Text style={styles.newBadgeText}>N</Text>
                </View>
              )}
            </Pressable>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}
