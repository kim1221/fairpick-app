import React from 'react';
import { View, Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { Txt } from '@toss/tds-react-native';

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

export default function SearchSuggestions({
  recentSearches,
  popularKeywords,
  onSelectRecent,
  onSelectPopular,
  onDeleteTerm,
  onClearAll,
}: SearchSuggestionsProps) {
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
            <Txt typography="label1" style={styles.sectionTitle}>최근 검색</Txt>
            <Pressable onPress={onClearAll} hitSlop={8}>
              <Txt typography="label3" style={styles.clearAllText}>전체 삭제</Txt>
            </Pressable>
          </View>

          {recentSearches.map((term, index) => (
            <Pressable
              key={`recent-${index}`}
              style={styles.recentItem}
              onPress={() => onSelectRecent(term)}
            >
              <Text style={styles.recentIcon}>🕐</Text>
              <Txt typography="body2" style={styles.recentText}>{term}</Txt>
              <Pressable
                onPress={() => onDeleteTerm(term)}
                hitSlop={8}
                style={styles.deleteButton}
              >
                <Text style={styles.deleteIcon}>✕</Text>
              </Pressable>
            </Pressable>
          ))}
        </View>
      )}

      {/* 인기 검색어 — 주차 레이블 + isNew 뱃지 */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Txt typography="label1" style={styles.sectionTitle}>인기 검색어</Txt>
        </View>
        <View style={styles.keywordGrid}>
          {popularKeywords.map((keyword, index) => (
            <Pressable
              key={`popular-${index}`}
              style={styles.keywordChip}
              onPress={() => onSelectPopular(keyword)}
            >
              <Txt typography="label3" style={styles.keywordText}>{keyword.term}</Txt>
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

const styles = StyleSheet.create({
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
    color: '#191F28',
  },
  clearAllText: {
    color: '#8B95A1',
  },
  // 최근 검색어 리스트
  recentItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: '#F2F4F6',
  },
  recentIcon: {
    fontSize: 14,
    marginRight: 10,
    color: '#8B95A1',
  },
  recentText: {
    flex: 1,
    color: '#333D4B',
  },
  deleteButton: {
    paddingLeft: 12,
  },
  deleteIcon: {
    fontSize: 13,
    color: '#B0B8C1',
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
    backgroundColor: '#F5F6F7',
    borderRadius: 20,
    gap: 5,
  },
  keywordText: {
    color: '#4E5968',
  },
  newBadge: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    backgroundColor: '#3182F6',
    borderRadius: 4,
  },
  newBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#FFFFFF',
  },
});
