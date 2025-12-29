import { createRoute } from '@granite-js/react-native';
import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View, Text, TouchableOpacity, Alert, Image } from 'react-native';
import { Txt } from '@toss/tds-react-native';
import eventService from '../services/eventService';
import { EventCardData } from '../data/events';

// Components
import { SearchBar } from '../components/SearchBar';
import { FilterChips } from '../components/FilterChips';
import { SectionHeader } from '../components/SectionHeader';
import { RankingCard } from '../components/RankingCard';
import { BottomTabBar } from '../components/BottomTabBar';

// Utils
import { getDynamicGreeting } from '../utils/dynamicGreeting';
import { parseDate, formatShortDate } from '../lib/dateUtils';
import { getImageSource } from '../utils/imageHelpers';

export const Route = createRoute('/', {
  component: HomePage,
});

function HomePage() {
  const navigation = Route.useNavigation();
  const [hotEvents, setHotEvents] = useState<EventCardData[]>([]);
  const [endingEvents, setEndingEvents] = useState<EventCardData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadEvents();
  }, []);

  const loadEvents = async () => {
    try {
      const [hot, ending] = await Promise.all([
        eventService.getHotEvents(1, 10),
        eventService.getEndingEvents(1, 5),
      ]);
      setHotEvents(hot.items);
      setEndingEvents(ending.items);
    } catch (error) {
      console.error('Failed to load events:', error);
      Alert.alert('오류', '데이터를 불러오는 데 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const handleRegionSelect = (region: string) => {
    // TODO: /events 페이지 구현 필요
    Alert.alert('준비 중', '전체 이벤트 페이지는 곧 추가될 예정입니다.');
  };

  const handleCategorySelect = (category: string) => {
    // TODO: /events 페이지 구현 필요
    Alert.alert('준비 중', '전체 이벤트 페이지는 곧 추가될 예정입니다.');
  };

  const formatEndDate = (endAt: string | undefined) => {
    console.log('[DEBUG] formatEndDate input:', endAt);
    const date = parseDate(endAt);
    console.log('[DEBUG] formatEndDate parsed date:', date);
    if (!date) return '일정 미정';
    const result = formatShortDate(date);
    console.log('[DEBUG] formatEndDate result:', result);
    return result;
  };

  return (
    <View style={styles.container}>
      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {/* 헤더 */}
        <View style={styles.header}>
          <Text style={styles.appName}>페어픽</Text>
        </View>

        {/* 다이내믹 인사말 */}
        <View style={styles.greetingSection}>
          <Text style={styles.greeting}>{getDynamicGreeting()}</Text>
        </View>

        {/* 검색바 */}
        <View style={styles.searchSection}>
          <SearchBar />
        </View>

        {/* 필터 칩 */}
        <View style={styles.filterSection}>
          <FilterChips
            onRegionSelect={handleRegionSelect}
            onCategorySelect={handleCategorySelect}
          />
        </View>

        {/* HOT 섹션 */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderWrapper}>
            <SectionHeader
              icon="🔥"
              title="HOT 지금 가장 인기 있는 이벤트"
              onViewAll={() => Alert.alert('준비 중', '전체보기 페이지는 곧 추가될 예정입니다.')}
            />
          </View>

          {loading ? (
            <Text style={styles.loadingText}>로딩 중...</Text>
          ) : hotEvents.length > 0 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.horizontalScroll}
            >
              {hotEvents.map((event, index) => (
                <RankingCard
                  key={event.id}
                  event={event}
                  rank={index + 1}
                  onPress={() => navigation.navigate('/events/:id', { id: event.id })}
                />
              ))}
            </ScrollView>
          ) : (
            <Text style={styles.emptyText}>현재 인기 이벤트가 없습니다</Text>
          )}
        </View>

        {/* 마감임박 섹션 */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderWrapper}>
            <SectionHeader
              icon="⏳"
              title="마감임박 곧 마감되는 이벤트"
              onViewAll={() => Alert.alert('준비 중', '전체보기 페이지는 곧 추가될 예정입니다.')}
            />
          </View>

          {loading ? (
            <Text style={styles.loadingText}>로딩 중...</Text>
          ) : endingEvents.length > 0 ? (
            <View style={styles.endingListContainer}>
              {endingEvents.map((event) => (
                <TouchableOpacity
                  key={event.id}
                  style={styles.endingListItem}
                  onPress={() => navigation.navigate('/events/:id', { id: event.id })}
                  activeOpacity={0.7}
                >
                  {/* 왼쪽 이미지 */}
                  <View style={styles.endingListImage}>
                    <Image
                      source={getImageSource(event.thumbnailUrl, event.category)}
                      style={styles.endingListImageContent}
                      resizeMode="cover"
                    />
                  </View>
                  
                  {/* 오른쪽 정보 */}
                  <View style={styles.endingListInfo}>
                    {/* 마감임박 배지 */}
                    <View style={styles.endingListBadge}>
                      <Text style={styles.endingListBadgeText}>마감임박</Text>
                    </View>
                    
                    {/* 제목 */}
                    <Text style={styles.endingListTitle} numberOfLines={2}>
                      {event.title}
                    </Text>
                    
                    {/* 날짜와 장소 */}
                    <Text style={styles.endingListMeta} numberOfLines={1}>
                      {formatEndDate(event.endAt)}까지 · {event.venue}
                    </Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          ) : (
            <Text style={styles.emptyText}>마감 임박 이벤트가 없습니다</Text>
          )}
        </View>

        {/* 하단 여백 (탭 바 공간 확보) */}
        <View style={{ height: 100 }} />
      </ScrollView>

      {/* 하단 탭 바 */}
      <BottomTabBar currentTab="home" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F2F4F6',
  },
  scrollView: {
    flex: 1,
  },
  header: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 20,
    paddingVertical: 16,
    paddingTop: 50, // iOS safe area
  },
  appName: {
    fontSize: 24,
    fontWeight: '700',
    color: '#191F28',
  },
  greetingSection: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  greeting: {
    fontSize: 22,
    fontWeight: '700',
    color: '#191F28',
    lineHeight: 32,
  },
  searchSection: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  filterSection: {
    backgroundColor: '#FFFFFF',
    paddingVertical: 12,
    paddingBottom: 20,
  },
  section: {
    marginTop: 24,
  },
  sectionHeaderWrapper: {
    paddingHorizontal: 20,
  },
  horizontalScroll: {
    paddingLeft: 20,
    paddingRight: 4,
  },
  endingListContainer: {
    paddingHorizontal: 20,
  },
  endingListItem: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    marginBottom: 12,
    padding: 12,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  endingListImage: {
    width: 80,
    height: 80,
    borderRadius: 8,
    overflow: 'hidden',
    marginRight: 12,
  },
  endingListImageContent: {
    width: '100%',
    height: '100%',
  },
  endingListInfo: {
    flex: 1,
    justifyContent: 'center',
  },
  endingListBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#FFE5E5',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    marginBottom: 6,
  },
  endingListBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#FF4848',
  },
  endingListTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#191F28',
    marginBottom: 6,
    lineHeight: 20,
  },
  endingListMeta: {
    fontSize: 13,
    color: '#6B7684',
  },
  loadingText: {
    textAlign: 'center',
    color: '#8B95A1',
    paddingVertical: 40,
  },
  emptyText: {
    textAlign: 'center',
    color: '#B0B8C1',
    paddingVertical: 40,
  },
});
