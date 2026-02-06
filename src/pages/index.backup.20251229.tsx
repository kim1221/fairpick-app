import { createRoute } from '@granite-js/react-native';
import React, { useEffect, useState, useMemo } from 'react';
import { ScrollView, StyleSheet, View, Pressable, ActivityIndicator } from 'react-native';
import { Txt, Tab, Top, Border, Badge, Post } from '@toss/tds-react-native';
import { useAdaptive } from '@toss/tds-react-native/private';
import {
  EVENT_CATEGORIES,
  REGIONS,
  EventCategory,
  Region,
  EventCardData,
} from '../data/events';
import eventService from '../services/eventService';
import { EventImage } from '../components/EventImage';
import { RecommendSection } from '../components/RecommendSection';
import { NewArrivalSection } from '../components/NewArrivalSection';

export const Route = createRoute('/', {
  component: Page,
});

type AdaptiveColorToken = ReturnType<typeof useAdaptive>;

// 서브카테고리 정의
const SUB_CATEGORIES: Record<Exclude<EventCategory, '전체'>, string[]> = {
  공연: ['전체', '뮤지컬', '연극', '콘서트', '클래식', '무용', '국악', '기타 공연'],
  전시: ['전체', '미술 전시', '사진 전시', '미디어아트', '체험형 전시', '어린이 전시', '특별전'],
  축제: ['전체', '지역 축제', '음악 축제', '불꽃 / 드론 / 빛 축제', '계절 축제', '전통 / 문화 축제'],
  행사: ['전체', '문화 행사', '체험 행사', '교육 / 강연', '마켓 / 플리마켓', '기념 행사', '가족 / 어린이'],
};

function Page() {
  const adaptive = useAdaptive();
  const navigation = Route.useNavigation();
  const [selectedCategory, setSelectedCategory] = useState<EventCategory>('전체');
  const [selectedSubCategory, setSelectedSubCategory] = useState<string>('전체');
  const [selectedRegion, setSelectedRegion] = useState<Region>('전국');
  const [currentPage, setCurrentPage] = useState(1);
  const [events, setEvents] = useState<EventCardData[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  // 현재 메인 카테고리에 해당하는 서브카테고리 목록
  const availableSubCategories = useMemo(() => {
    if (selectedCategory === '전체') {
      return [];
    }
    return SUB_CATEGORIES[selectedCategory] || [];
  }, [selectedCategory]);

  useEffect(() => {
    let mounted = true;

    const fetchEvents = async () => {
      setStatus('loading');
      try {
        const result = await eventService.getEventList({
          category: selectedCategory,
          subCategory: selectedSubCategory !== '전체' ? selectedSubCategory : undefined,
          region: selectedRegion,
          page: currentPage,
          size: 10,
        });
        if (!mounted) {
          return;
        }
        setEvents(result.items);
        setTotalCount(result.totalCount);
        setStatus('ready');
      } catch {
        if (mounted) {
          setStatus('error');
        }
      }
    };

    fetchEvents();

    return () => {
      mounted = false;
    };
  }, [selectedCategory, selectedSubCategory, selectedRegion, currentPage]);

  const handleSelectEvent = (event: EventCardData) => {
    navigation.navigate('/events/:id', { id: event.id });
  };

  const handleCategoryChange = (category: EventCategory) => {
    setSelectedCategory(category);
    setSelectedSubCategory('전체'); // 메인 카테고리 변경 시 서브 카테고리 리셋
    setCurrentPage(1);
  };

  const handleSubCategoryChange = (subCategory: string) => {
    setSelectedSubCategory(subCategory);
    setCurrentPage(1);
  };

  const handleRegionChange = (region: Region) => {
    setSelectedRegion(region);
    setCurrentPage(1);
  };

  const totalPages = Math.ceil(totalCount / 10);

  return (
    <View style={[styles.screen, { backgroundColor: adaptive.background }]}>
      <View style={[styles.stickyHeader, { backgroundColor: adaptive.background }]}>
        <CategoryTabs value={selectedCategory} onChange={handleCategoryChange} />
        {availableSubCategories.length > 0 && (
          <SubCategoryChips
            subCategories={availableSubCategories}
            value={selectedSubCategory}
            onChange={handleSubCategoryChange}
            adaptive={adaptive}
          />
        )}
        <Top
          title={
            <Top.TitleParagraph size={28} color={adaptive.grey900}>
              모든 볼거리
            </Top.TitleParagraph>
          }
          subtitle2={
            <Top.SubtitleParagraph size={15} color={adaptive.grey600}>
              모든 볼거리를 한 곳에
            </Top.SubtitleParagraph>
          }
          style={styles.sectionSpacing}
        />
        <Border type="full" />
        <RegionChips value={selectedRegion} onChange={handleRegionChange} adaptive={adaptive} />
      </View>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        {selectedCategory === '전체' && <RecommendSection onSelectEvent={handleSelectEvent} />}
        {selectedCategory === '전체' && <NewArrivalSection onSelectEvent={handleSelectEvent} />}
        <View style={styles.cardList}>{renderEventSection(status, events, adaptive, handleSelectEvent)}</View>
        {status === 'ready' && totalPages > 1 && (
          <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} adaptive={adaptive} />
        )}
      </ScrollView>
    </View>
  );
}

function CategoryTabs({
  value,
  onChange,
}: {
  value: EventCategory;
  onChange: (category: EventCategory) => void;
}) {
  return (
    <Tab fluid={false} value={value} onChange={(next) => onChange(next as EventCategory)} style={styles.categoryTabs}>
      {EVENT_CATEGORIES.map((category) => (
        <Tab.Item key={category} value={category}>
          {category}
        </Tab.Item>
      ))}
    </Tab>
  );
}

function SubCategoryChips({
  subCategories,
  value,
  onChange,
  adaptive,
}: {
  subCategories: string[];
  value: string;
  onChange: (subCategory: string) => void;
  adaptive: AdaptiveColorToken;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.subCategoryScroll}
      contentContainerStyle={styles.chipRow}
    >
      {subCategories.map((subCategory) => {
        const selected = subCategory === value;
        return (
          <Pressable
            key={subCategory}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(subCategory)}
            style={[
              styles.subCategoryChip,
              {
                backgroundColor: selected ? adaptive.blue500 : 'transparent',
                borderColor: selected ? adaptive.blue500 : adaptive.greyOpacity200,
              },
            ]}
          >
            <Txt typography="t7" fontWeight="medium" color={selected ? '#FFFFFF' : adaptive.grey700}>
              {subCategory}
            </Txt>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function RegionChips({
  value,
  onChange,
  adaptive,
}: {
  value: Region;
  onChange: (region: Region) => void;
  adaptive: AdaptiveColorToken;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.chipScroll}
      contentContainerStyle={styles.chipRow}
    >
      {REGIONS.map((region) => {
        const selected = region === value;
        return (
          <Pressable
            key={region}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(region)}
            style={[
              styles.chip,
              {
                backgroundColor: selected ? adaptive.grey900 : adaptive.greyOpacity50,
                borderColor: selected ? adaptive.grey900 : adaptive.greyOpacity200,
              },
            ]}
          >
            <Txt typography="t7" fontWeight="medium" color={selected ? '#FFFFFF' : adaptive.grey900}>
              {region}
            </Txt>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function Pagination({
  currentPage,
  totalPages,
  onPageChange,
  adaptive,
}: {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  adaptive: AdaptiveColorToken;
}) {
  const visiblePages = [];
  const maxVisible = 5;

  let startPage = Math.max(1, currentPage - Math.floor(maxVisible / 2));
  const endPage = Math.min(totalPages, startPage + maxVisible - 1);

  if (endPage - startPage < maxVisible - 1) {
    startPage = Math.max(1, endPage - maxVisible + 1);
  }

  for (let i = startPage; i <= endPage; i++) {
    visiblePages.push(i);
  }

  return (
    <View style={styles.pagination}>
      {visiblePages.map((page) => {
        const selected = page === currentPage;
        return (
          <Pressable
            key={page}
            onPress={() => onPageChange(page)}
            style={[
              styles.pageButton,
              {
                backgroundColor: selected ? adaptive.blue500 : adaptive.greyOpacity50,
                borderColor: selected ? adaptive.blue500 : adaptive.greyOpacity200,
              },
            ]}
          >
            <Txt typography="t7" fontWeight="medium" color={selected ? '#FFFFFF' : adaptive.grey700}>
              {page}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

function EventCard({
  event,
  adaptive,
  onPress,
}: {
  event: EventCardData;
  adaptive: AdaptiveColorToken;
  onPress: (event: EventCardData) => void;
}) {
  const displayTags = getDisplayTagsForCard(event);

  return (
    <Pressable
      style={[styles.card, { backgroundColor: adaptive.background }]}
      accessibilityRole="button"
      accessibilityLabel={`${event.title} 상세 보기`}
      onPress={() => onPress(event)}
    >
      <EventImage
        uri={event.thumbnailUrl}
        height={180}
        accessibilityLabel={`${event.title} 대표 이미지`}
        style={styles.cardImage}
        category={event.category}
      />
      <View style={styles.badgeRow}>
        <Badge key={`${event.id}-region`} style={styles.badge}>
          {event.region}
        </Badge>
        {displayTags.map((tag, index) => (
          <Badge key={`${event.id}-tag-${index}-${tag}`} style={styles.badge}>
            {tag}
          </Badge>
        ))}
      </View>
      <Post.H2 paddingBottom={8}>{event.title}</Post.H2>
      <Post.Paragraph paddingBottom={4} color={adaptive.grey800}>
        {event.periodText}
      </Post.Paragraph>
      {event.venue ? (
        <Post.Paragraph paddingBottom={4} color={adaptive.grey700}>
          {event.venue}
        </Post.Paragraph>
      ) : null}
      {event.description ? (
        <Post.Paragraph typography="t7" color={adaptive.grey600}>
          {event.description}
        </Post.Paragraph>
      ) : null}
    </Pressable>
  );
}

function getDisplayTagsForCard(event: EventCardData): string[] {
  // 과거 데이터에 "주소"가 tags로 들어갔을 수 있어 방어적으로 필터링합니다.
  const isLikelyAddress = (value: string) =>
    value.length >= 12 ||
    /\d/.test(value) ||
    value.includes('특별시') ||
    value.includes('광역시') ||
    value.includes('대로') ||
    value.includes('로 ') ||
    value.includes('길 ') ||
    value.includes('번길') ||
    value.includes('번지') ||
    value.includes('동 ') ||
    value.includes('구 ') ||
    value.includes('시 ') ||
    value.includes('군 ');

  const raw = event.tags ?? [];
  const filtered = raw
    .filter((t) => Boolean(t) && t !== event.region)
    .filter((t) => !isLikelyAddress(t))
    .slice(0, 4);

  return [...new Set(filtered)];
}

function renderEventSection(
  status: 'loading' | 'ready' | 'error',
  events: EventCardData[],
  adaptive: AdaptiveColorToken,
  onSelect: (event: EventCardData) => void,
) {
  if (status === 'loading') {
    return (
      <View style={styles.stateContainer}>
        <ActivityIndicator color={adaptive.grey600} />
      </View>
    );
  }

  if (status === 'error') {
    return (
      <View style={styles.stateContainer}>
        <Txt typography="t6" color={adaptive.grey600}>
          데이터를 불러오지 못했어요.
        </Txt>
      </View>
    );
  }

  if (events.length === 0) {
    return (
      <View style={styles.stateContainer}>
        <Txt typography="t6" color={adaptive.grey600}>
          조건에 맞는 행사가 없어요.
        </Txt>
      </View>
    );
  }

  return events.map((event) => (
    <EventCard key={event.id} event={event} adaptive={adaptive} onPress={onSelect} />
  ));
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  stickyHeader: {
    position: 'sticky' as any,
    top: 0,
    zIndex: 100,
    paddingTop: 12,
    paddingHorizontal: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0, 0, 0, 0.06)',
    // iOS safe area 고려
    // @ts-ignore - React Native Web에서만 작동
    paddingTop: 'max(12px, env(safe-area-inset-top))',
  },
  scrollView: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  categoryTabs: {
    marginBottom: 8,
  },
  subCategoryScroll: {
    marginBottom: 12,
  },
  subCategoryChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    marginRight: 6,
  },
  sectionSpacing: {
    marginBottom: 16,
  },
  chipScroll: {
    marginVertical: 12,
  },
  chipRow: {
    paddingRight: 20,
  },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    marginRight: 8,
  },
  cardList: {
    paddingVertical: 8,
  },
  card: {
    borderRadius: 20,
    padding: 20,
    marginBottom: 24,
    shadowColor: '#001733',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 4,
  },
  cardImage: {
    marginBottom: 16,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 16,
  },
  badge: {
    marginRight: 8,
    marginBottom: 8,
  },
  stateContainer: {
    paddingVertical: 40,
    alignItems: 'center',
  },
  pagination: {
    flexDirection: 'row',
    justifyContent: 'center',
    paddingVertical: 24,
    gap: 8,
  },
  pageButton: {
    width: 40,
    height: 40,
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
