// @ts-nocheck
import { createRoute } from '@granite-js/react-native';
import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View, Text, Pressable, ActivityIndicator, Image, TextInput } from 'react-native';
import eventService from '../services/eventService';
import { EventCardData, EVENT_CATEGORIES, REGIONS, EventCategory, Region } from '../data/events';
import { BottomTabBar } from '../components/BottomTabBar';
import { getImageSource } from '../utils/imageHelpers';
import { parseDate, formatShortDate } from '../lib/dateUtils';
import { normalizeTitle, titleSimilarity, isPlaceholderImage } from '../utils/normalizeTitle';


interface DuplicateInfo {
  id: string;
  title: string;
  normalizedTitle: string;
  reason: string;
  kept: 'existing' | 'new';
  existingHasImage: boolean;
  newHasImage: boolean;
  similarity?: number;
}

interface DupCandidateGroup {
  key: string;
  items: Array<{
    id: string;
    title: string;
    normalizedTitle: string;
    imageUrl: string | null;
    isPlaceholder: boolean;
    startAt: string | undefined;
    endAt: string | undefined;
    venue: string | undefined;
    region: string;
    category: string;
  }>;
}

/**
 * 중복 후보 그룹 생성 (디버깅용)
 * 같은 날짜+장소+지역+카테고리 기준으로 그룹화
 */
function buildDupCandidateGroups(events: EventCardData[]): DupCandidateGroup[] {
  const groups = new Map<string, DupCandidateGroup['items']>();

  for (const event of events) {
    // 그룹 키: startAt + endAt + venue + region + category
    const groupKey = event.contentKey
      ? `contentKey:${event.contentKey}`
      : `${event.startAt || ''}|${event.endAt || ''}|${event.venue || ''}|${event.region}|${event.category}`;
    
    if (!groups.has(groupKey)) {
      groups.set(groupKey, []);
    }

    const normalized = normalizeTitle(event.title, event.region);
    groups.get(groupKey)!.push({
      id: event.id,
      title: event.title,
      normalizedTitle: normalized,
      imageUrl: event.thumbnailUrl || null,
      isPlaceholder: isPlaceholderImage(event.thumbnailUrl),
      startAt: event.startAt,
      endAt: event.endAt,
      venue: event.venue,
      region: event.region,
      category: event.category,
    });
  }

  // 2개 이상인 그룹만 반환
  return Array.from(groups.entries())
    .filter(([_, items]) => items.length > 1)
    .map(([key, items]) => ({ key, items }));
}

/**
 * 이미지 우선순위 점수 계산
 * 높을수록 우선
 */
function getImagePriorityScore(event: EventCardData): number {
  const url = event.thumbnailUrl;
  if (!url) return 0;
  if (isPlaceholderImage(url)) return 1;
  // 실제 이미지 URL 길이가 길수록 우선 (CDN URL 등)
  return 100 + Math.min(url.length, 100);
}

/**
 * 중복 그룹 내에서 우선 노출할 이벤트 선택
 * 1. 실제 이미지가 있는 항목 우선
 * 2. 이미지 URL이 더 긴 쪽 우선
 * 3. 제목이 더 짧은 쪽 우선
 */
function selectBestEvent(events: EventCardData[]): EventCardData {
  return (events.sort((a, b) => {
    // 1. 이미지 우선순위
    const imgScoreA = getImagePriorityScore(a);
    const imgScoreB = getImagePriorityScore(b);
    if (imgScoreB !== imgScoreA) return imgScoreB - imgScoreA;

    // 2. 제목 길이 (짧은 쪽 우선 - 정규화된 제목)
    const normA = normalizeTitle(a.title);
    const normB = normalizeTitle(b.title);
    return normA.length - normB.length;
  })[0] as EventCardData);
}

/**
 * [FIX A] 개선된 중복 이벤트 제거 함수
 * - 1차: 동일 ID 제거
 * - 2차: normalizedTitle + startAt + endAt + venue + region 기반 정확 매칭
 * - 3차: 유사도 기반 퍼지 매칭 (같은 startAt + endAt + venue + region 그룹 내에서)
 * - 이미지가 있는 항목 우선 선택
 */
function deduplicateEvents(events: EventCardData[]): { deduplicated: EventCardData[], duplicateInfo: DuplicateInfo[] } {
  const duplicateInfo: DuplicateInfo[] = [];
  const SIMILARITY_THRESHOLD = 0.8;

  // [디버깅] 중복 후보 그룹 로그
  if (__DEV__) {
    const dupGroups = buildDupCandidateGroups(events);
    if (dupGroups.length > 0) {
      console.log('[Explore][DupCandidateGroups] Found', dupGroups.length, 'potential duplicate groups');
      dupGroups.slice(0, 10).forEach((group, idx) => {
        console.log(`[Explore][DupCandidateGroup ${idx + 1}]`, {
          key: group.key.substring(0, 50) + '...',
          items: group.items.map(item => ({
            id: item.id.substring(0, 8),
            title: item.title.substring(0, 30),
            normalizedTitle: item.normalizedTitle.substring(0, 30),
            isPlaceholder: item.isPlaceholder,
          })),
        });
      });
    }
  }

  // 1차: ID 기반 dedupe (이미지 우선)
  const byId = new Map<string, EventCardData>();
  events.forEach((event) => {
    const existing = byId.get(event.id);
    if (!existing) {
      byId.set(event.id, event);
    } else {
      const hasExistingImage = !isPlaceholderImage(existing.thumbnailUrl);
      const hasNewImage = !isPlaceholderImage(event.thumbnailUrl);

      if (!hasExistingImage && hasNewImage) {
        byId.set(event.id, event);
        duplicateInfo.push({
          id: event.id,
          title: event.title,
          normalizedTitle: normalizeTitle(event.title),
          reason: 'id_dup_replaced_with_image',
          kept: 'new',
          existingHasImage: hasExistingImage,
          newHasImage: hasNewImage,
        });
      } else {
        duplicateInfo.push({
          id: event.id,
          title: event.title,
          normalizedTitle: normalizeTitle(event.title),
          reason: 'id_dup_kept_existing',
          kept: 'existing',
          existingHasImage: hasExistingImage,
          newHasImage: hasNewImage,
        });
      }
    }
  });

  // 2차: 정규화된 제목 기반 정확 매칭
  const byNormalizedContent = new Map<string, EventCardData>();
  Array.from(byId.values()).forEach((event) => {
    const normalized = normalizeTitle(event.title, event.region);
    // 콘텐츠 키: normalizedTitle + startAt + endAt + venue + region
    const contentKey = event.contentKey
      ? `contentKey:${event.contentKey}`
      : `${normalized}|${event.startAt || ''}|${event.endAt || ''}|${event.venue || ''}|${event.region}`;
    const existing = byNormalizedContent.get(contentKey);

    if (!existing) {
      byNormalizedContent.set(contentKey, event);
    } else {
      const bestEvent = selectBestEvent([existing, event]);
      const removedEvent = bestEvent.id === event.id ? existing : event;

      byNormalizedContent.set(contentKey, bestEvent);

      const hasExistingImage = !isPlaceholderImage(existing.thumbnailUrl);
      const hasNewImage = !isPlaceholderImage(event.thumbnailUrl);

      console.log('[Explore][Dedupe][EXACT]', {
        keptId: bestEvent.id.substring(0, 8),
        removedId: removedEvent.id.substring(0, 8),
        normalizedTitle: normalized.substring(0, 30),
        reason: bestEvent.id === event.id ? 'new has better image' : 'existing has better image or first',
      });

      duplicateInfo.push({
        id: removedEvent.id,
        title: removedEvent.title,
        normalizedTitle: normalized,
        reason: 'exact_match_removed',
        kept: bestEvent.id === event.id ? 'new' : 'existing',
        existingHasImage: hasExistingImage,
        newHasImage: hasNewImage,
      });
    }
  });

  // 3차: 유사도 기반 퍼지 매칭 (같은 startAt + endAt + region 그룹 내에서만)
  // venueName이 없거나 다를 수 있으므로 완화된 그룹
  const softGroups = new Map<string, EventCardData[]>();
  Array.from(byNormalizedContent.values()).forEach((event) => {
    // 소프트 그룹 키: startAt + endAt + region + category (venue 제외)
    const softKey = `${event.startAt || ''}|${event.endAt || ''}|${event.region}|${event.category}`;
    if (!softGroups.has(softKey)) {
      softGroups.set(softKey, []);
    }
    softGroups.get(softKey)!.push(event);
  });

  const finalEvents: EventCardData[] = [];
  const processedIds = new Set<string>();

  for (const [softKey, groupEvents] of softGroups.entries()) {
    if (groupEvents.length === 1) {
      // 단일 이벤트 그룹
      if (!processedIds.has(groupEvents[0]!.id)) {
        finalEvents.push(groupEvents[0]!);
        processedIds.add(groupEvents[0]!.id);
      }
      continue;
    }

    // startAt, endAt 유효성 검사 (빈값이면 퍼지 dedupe 스킵)
    const hasValidDates = groupEvents[0]?.startAt && groupEvents[0]?.endAt;
    if (!hasValidDates) {
      // 날짜 정보 없으면 퍼지 dedupe 하지 않음
      if (__DEV__) {
        console.log('[Explore][Dedupe][SKIP_FUZZY] No valid dates for soft group', softKey.substring(0, 30));
      }
      for (const event of groupEvents) {
        if (!processedIds.has(event.id)) {
          finalEvents.push(event);
          processedIds.add(event.id);
        }
      }
      continue;
    }

    // 유사도 기반 그룹핑
    const clusters: EventCardData[][] = [];

    for (const event of groupEvents) {
      if (processedIds.has(event.id)) continue;

      let addedToCluster = false;
      const normTitle = normalizeTitle(event.title);

      for (const cluster of clusters) {
        // 클러스터의 첫 번째 이벤트와 유사도 비교
        const clusterNormTitle = normalizeTitle(cluster[0].title);
        const similarity = titleSimilarity(normTitle, clusterNormTitle);

        if (similarity >= SIMILARITY_THRESHOLD) {
          cluster.push(event);
          addedToCluster = true;

          if (__DEV__) {
            console.log('[Explore][Dedupe][FUZZY_MATCH]', {
              title1: cluster[0].title.substring(0, 25),
              title2: event.title.substring(0, 25),
              similarity: similarity.toFixed(2),
            });
          }

          duplicateInfo.push({
            id: event.id,
            title: event.title,
            normalizedTitle: normTitle,
            reason: 'fuzzy_match_clustered',
            kept: 'existing', // 나중에 best 선택 시 업데이트
            existingHasImage: !isPlaceholderImage(cluster[0].thumbnailUrl),
            newHasImage: !isPlaceholderImage(event.thumbnailUrl),
            similarity,
          });

          break;
        }
      }

      if (!addedToCluster) {
        clusters.push([event]);
      }
    }

    // 각 클러스터에서 best 이벤트 선택
    for (const cluster of clusters) {
      const bestEvent = selectBestEvent(cluster);
      if (!processedIds.has(bestEvent.id)) {
        finalEvents.push(bestEvent);
        processedIds.add(bestEvent.id);

        if (cluster.length > 1 && __DEV__) {
          console.log('[Explore][Dedupe][KEEP]', {
            keptId: bestEvent.id.substring(0, 8),
            removedIds: cluster.filter(e => e.id !== bestEvent.id).map(e => e.id.substring(0, 8)),
            reason: 'has_real_image',
            normalizedTitle: normalizeTitle(bestEvent.title).substring(0, 30),
          });
        }
      }

      // 나머지는 processedIds에 추가하여 제외
      for (const event of cluster) {
        processedIds.add(event.id);
      }
    }
  }

  return { deduplicated: finalEvents, duplicateInfo };
}

export const Route = createRoute('/explore', {
  component: ExplorePage,
});

function ExplorePage() {
  if (__DEV__) console.log('[RouteRender] ExplorePage rendered');

  const navigation = Route.useNavigation();
  const params = Route.useParams<{ query?: string; region?: string; category?: string }>();

  const [events, setEvents] = useState<EventCardData[]>([]);
  const [allEvents, setAllEvents] = useState<EventCardData[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  // 필터 상태
  const [searchQuery, setSearchQuery] = useState(params.query || '');
  const [searchInput, setSearchInput] = useState(params.query || '');
  const [selectedRegion, setSelectedRegion] = useState<Region>(params.region as Region || '전국');
  const [selectedCategory, setSelectedCategory] = useState<EventCategory>(params.category as EventCategory || '전체');

  const pageSize = 20;
  const regionOptions = REGIONS.filter((region) => region !== '기타');
  const filtersKey = `${selectedRegion}|${selectedCategory}|${searchQuery}`;
  const prevFiltersRef = useRef(filtersKey);

  // [FIX 5] race condition 방지용 requestId
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (filtersKey !== prevFiltersRef.current) {
      if (currentPage !== 1) {
        setCurrentPage(1);
        if (__DEV__) {
          console.log('[Explore][PageReset]', { reason: 'filter-change' });
        }
        return;
      }
      prevFiltersRef.current = filtersKey;
    }
    loadEvents();
  }, [filtersKey, currentPage]);

  useEffect(() => {
    if (__DEV__) {
      console.log('[Explore][TotalCount]', totalCount);
    }
  }, [totalCount]);

  const loadEvents = async () => {
    // [FIX 5] race condition 방지: 요청 시작 시 requestId 증가
    const thisRequestId = ++requestIdRef.current;

    try {
      setLoading(true);

      // 검색어가 있으면 서버사이드 검색으로 처리 (페이지네이션 가능)
      if (searchQuery.trim()) {
        console.log('[Explore] Search mode - using server-side search (q parameter)');

        // [FIX B] 요청 파라미터 로깅 (검색 모드)
        const searchParams = {
          category: selectedCategory === '전체' ? undefined : selectedCategory,
          region: selectedRegion === '전국' ? undefined : selectedRegion,
          query: searchQuery.trim(),
        };
        console.log('[Explore][SearchMode][Params]', {
          selectedCategory,
          selectedRegion,
          searchQuery,
          willSendCategory: searchParams.category,
          willSendRegion: searchParams.region,
          willSendQuery: searchParams.query,
          categoryIsUndefined: searchParams.category === undefined,
          regionIsUndefined: searchParams.region === undefined,
          page: currentPage,
          requestId: thisRequestId,
        });

        // 서버사이드 검색 (단일 페이지 요청)
        const result = await eventService.getEventList({
          category: searchParams.category,
          region: searchParams.region,
          query: searchParams.query,
          page: currentPage,
          size: pageSize,
        });

        const totalPages = Math.ceil(result.totalCount / pageSize);
        console.log('[Explore][API][Search]', {
          page: currentPage,
          size: pageSize,
          totalCount: result.totalCount,
          totalPages,
          returned: result.items.length,
          requestId: thisRequestId,
        });

        // [FIX A] 중복 제거 적용
        const { deduplicated, duplicateInfo } = deduplicateEvents(result.items);

        console.log('[Explore][Deduplication]', {
          beforeCount: result.items.length,
          afterCount: deduplicated.length,
          duplicatesRemoved: duplicateInfo.length,
        });

        // 중복 샘플 로그 (최대 10개)
        if (duplicateInfo.length > 0) {
          console.log('[Explore][Duplicates] Samples:', duplicateInfo.slice(0, 10));
        }

        // [FIX 5] race condition 방지: 이전 요청이면 무시
        if (thisRequestId !== requestIdRef.current) {
          console.log('[Explore][Race] Ignoring stale response (search)', { thisRequestId, currentId: requestIdRef.current });
          return;
        }

        setEvents(deduplicated);
        setTotalCount(result.totalCount);
      } else {
        // 검색어 없으면 서버 사이드 필터링
        // [FIX B] 요청 파라미터 로깅 (일반 모드)
        const filterParams = {
          category: selectedCategory === '전체' ? undefined : selectedCategory,
          region: selectedRegion === '전국' ? undefined : selectedRegion,
        };
        console.log('[Explore][NormalMode][Params]', {
          selectedCategory,
          selectedRegion,
          willSendCategory: filterParams.category,
          willSendRegion: filterParams.region,
          categoryIsUndefined: filterParams.category === undefined,
          regionIsUndefined: filterParams.region === undefined,
        });

        const result = await eventService.getEventList({
          category: filterParams.category,
          region: filterParams.region,
          page: currentPage,
          size: pageSize,
        });

        const totalPages = Math.ceil(result.totalCount / pageSize);
        console.log('[Explore][API]', {
          page: currentPage,
          size: pageSize,
          totalCount: result.totalCount,
          totalPages,
          returned: result.items.length,
        });

        console.log('[Explore] page:', currentPage, 'size:', pageSize, 'totalCount:', result.totalCount);
        console.log('[Explore] filters:', {
          category: selectedCategory,
          region: selectedRegion,
          query: searchQuery,
        });

        if (__DEV__) {
          console.log('[Explore][DataCount] API totalCount:', result.totalCount, 'items length:', result.items.length);

          // [FIX A] API 응답에서 중복 확인
          const idCounts = new Map<string, number>();
          result.items.forEach(item => {
            idCounts.set(item.id, (idCounts.get(item.id) || 0) + 1);
          });
          const duplicates = Array.from(idCounts.entries()).filter(([_, count]) => count > 1);
          if (duplicates.length > 0) {
            console.warn('[Explore][API_DUPLICATES] Found duplicates in API response:', duplicates.slice(0, 10));
          }
        }

        // [FIX A] 일반 모드에도 dedupe 적용
        const { deduplicated, duplicateInfo } = deduplicateEvents(result.items);

        if (duplicateInfo.length > 0) {
          console.log('[Explore][NormalMode][Deduplication]', {
            beforeCount: result.items.length,
            afterCount: deduplicated.length,
            duplicatesRemoved: duplicateInfo.length,
            samples: duplicateInfo.slice(0, 5),
          });
        }

        // [FIX 5] race condition 방지: 이전 요청이면 무시
        if (thisRequestId !== requestIdRef.current) {
          console.log('[Explore][Race] Ignoring stale response (normal)', { thisRequestId, currentId: requestIdRef.current });
          return;
        }

        setEvents(deduplicated);
        setTotalCount(result.totalCount);
      }
    } catch (error) {
      console.error('Failed to load events:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = () => {
    setSearchQuery(searchInput);
  };

  const handleRegionSelect = (region: Region) => {
    setSelectedRegion(region);
  };

  const handleCategorySelect = (category: EventCategory) => {
    setSelectedCategory(category);
  };

  const totalPages = Math.ceil(totalCount / pageSize);
  const pageGroupSize = 5;
  const currentGroupStart = Math.floor((currentPage - 1) / pageGroupSize) * pageGroupSize + 1;
  const currentGroupEnd = Math.min(currentGroupStart + pageGroupSize - 1, totalPages);

  // 검색/일반 모드 모두 서버에서 페이지네이션된 결과를 받음
  const currentEvents = events;

  // DEV 로그: 렌더링 직전 최종 데이터 개수 + ID 중복 체크
  if (__DEV__) {
    console.log('[Explore][RenderCount] Total events:', events.length, 'Current page events:', currentEvents.length, 'totalCount:', totalCount);

    // ID 중복 체크
    const idCounts = new Map<string, number>();
    currentEvents.forEach(event => {
      idCounts.set(event.id, (idCounts.get(event.id) || 0) + 1);
    });
    const duplicateIds = Array.from(idCounts.entries()).filter(([_, count]) => count > 1);

    if (duplicateIds.length > 0) {
      console.warn('[Explore][DUPLICATE_IDS] Found duplicate IDs in render:', duplicateIds.length);
      duplicateIds.slice(0, 5).forEach(([id, count]) => {
        const event = currentEvents.find(e => e.id === id);
        console.warn(`  - ${event?.title} (${id.substring(0, 12)}...): ${count}번`);
      });
    } else {
      console.log('[Explore][DUPLICATE_CHECK] ✅ No duplicate IDs in currentEvents');
    }
  }

  const formatEndDate = (endAt: string | undefined) => {
    const date = parseDate(endAt);
    if (!date) return '일정 미정';
    return formatShortDate(date);
  };

  return (
    <View style={styles.container}>
      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {/* 헤더 */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>탐색</Text>
          <Text style={styles.headerSubtitle}>
            총 {totalCount.toLocaleString()}개의 이벤트
          </Text>
        </View>

        {/* 검색바 */}
        <View style={styles.searchSection}>
          <View style={styles.searchContainer}>
            <TextInput
              style={styles.searchInput}
              placeholder="이벤트, 장소 검색"
              value={searchInput}
              onChangeText={setSearchInput}
              onSubmitEditing={handleSearch}
              returnKeyType="search"
            />
            <Pressable style={styles.searchButton} onPress={handleSearch}>
              <Text style={styles.searchButtonText}>🔍</Text>
            </Pressable>
          </View>
        </View>

        {/* 지역 필터 */}
        <View style={styles.filterSection}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterScroll}
          >
            {regionOptions.map((region) => (
              <Pressable
                key={region}
                style={[
                  styles.filterChip,
                  selectedRegion === region && styles.filterChipActive,
                ]}
                onPress={() => handleRegionSelect(region)}
              >
                <Text
                  style={[
                    styles.filterChipText,
                    selectedRegion === region && styles.filterChipTextActive,
                  ]}
                >
                  {region}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>

        {/* 카테고리 필터 */}
        <View style={styles.filterSection}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterScroll}
          >
            {EVENT_CATEGORIES.map((category) => (
              <Pressable
                key={category}
                style={[
                  styles.filterChip,
                  selectedCategory === category && styles.filterChipActive,
                ]}
                onPress={() => handleCategorySelect(category)}
              >
                <Text
                  style={[
                    styles.filterChipText,
                    selectedCategory === category && styles.filterChipTextActive,
                  ]}
                >
                  {category}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>

        {/* 이벤트 리스트 */}
        <View style={styles.eventsContainer}>
          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#3182F6" />
              <Text style={styles.loadingText}>로딩 중...</Text>
            </View>
          ) : currentEvents.length > 0 ? (
            currentEvents.map((event) => (
              <Pressable
                key={event.id}
                style={styles.eventCard}
                onPress={() => navigation.navigate('/events/:id', { id: event.id })}
                activeOpacity={0.7}
              >
                <Image
                  source={getImageSource(event.thumbnailUrl, event.category)}
                  style={styles.eventImage}
                  resizeMode="cover"
                />
                <View style={styles.eventInfo}>
                  <View style={styles.eventBadges}>
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>{event.region}</Text>
                    </View>
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>{event.category}</Text>
                    </View>
                  </View>
                  <Text style={styles.eventTitle} numberOfLines={2}>
                    {event.title}
                  </Text>
                  <Text style={styles.eventMeta}>{event.periodText}</Text>
                  {event.venue && (
                    <Text style={styles.eventVenue} numberOfLines={1}>
                      📍 {event.venue}
                    </Text>
                  )}
                </View>
              </Pressable>
            ))
          ) : (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>검색 결과가 없습니다</Text>
            </View>
          )}
        </View>

        {/* 페이지네이션 */}
        {totalPages > 1 && (
          <View style={styles.pagination}>
            {currentGroupStart > 1 && (
              <Pressable
                style={styles.pageButton}
                onPress={() => setCurrentPage(currentGroupStart - pageGroupSize)}
              >
                <Text style={styles.pageButtonText}>{'<'}</Text>
              </Pressable>
            )}
            {Array.from({ length: currentGroupEnd - currentGroupStart + 1 }, (_, i) => currentGroupStart + i).map((page) => (
              <Pressable
                key={page}
                style={[
                  styles.pageButton,
                  currentPage === page && styles.pageButtonActive,
                ]}
                onPress={() => setCurrentPage(page)}
              >
                <Text
                  style={[
                    styles.pageButtonText,
                    currentPage === page && styles.pageButtonTextActive,
                  ]}
                >
                  {page}
                </Text>
              </Pressable>
            ))}
            {currentGroupEnd < totalPages && (
              <Pressable
                style={styles.pageButton}
                onPress={() => setCurrentPage(currentGroupEnd + 1)}
              >
                <Text style={styles.pageButtonText}>{'>'}</Text>
              </Pressable>
            )}
          </View>
        )}

        {/* 하단 여백 */}
        <View style={{ height: 100 }} />
      </ScrollView>

      <BottomTabBar currentTab="explore" />
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
    paddingTop: 50,
    paddingBottom: 16,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: '#191F28',
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#6B7684',
  },
  searchSection: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F2F4F6',
    borderRadius: 12,
    paddingHorizontal: 16,
  },
  searchInput: {
    flex: 1,
    height: 48,
    fontSize: 15,
    color: '#191F28',
  },
  searchButton: {
    padding: 8,
  },
  searchButtonText: {
    fontSize: 20,
  },
  filterSection: {
    backgroundColor: '#FFFFFF',
    paddingVertical: 8,
  },
  filterScroll: {
    paddingHorizontal: 20,
  },
  filterChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#F2F4F6',
    marginRight: 8,
  },
  filterChipActive: {
    backgroundColor: '#3182F6',
  },
  filterChipText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#4E5968',
  },
  filterChipTextActive: {
    color: '#FFFFFF',
  },
  eventsContainer: {
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  loadingContainer: {
    paddingVertical: 60,
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 14,
    color: '#8B95A1',
  },
  eventCard: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    marginBottom: 12,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  eventImage: {
    width: 100,
    height: 100,
  },
  eventInfo: {
    flex: 1,
    padding: 12,
  },
  eventBadges: {
    flexDirection: 'row',
    marginBottom: 6,
  },
  badge: {
    backgroundColor: '#E5EDFF',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    marginRight: 6,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#3182F6',
  },
  eventTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#191F28',
    marginBottom: 4,
    lineHeight: 20,
  },
  eventMeta: {
    fontSize: 13,
    color: '#6B7684',
    marginBottom: 4,
  },
  eventVenue: {
    fontSize: 13,
    color: '#8B95A1',
  },
  emptyContainer: {
    paddingVertical: 60,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 15,
    color: '#B0B8C1',
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
    backgroundColor: '#F2F4F6',
    justifyContent: 'center',
    alignItems: 'center',
  },
  pageButtonActive: {
    backgroundColor: '#3182F6',
  },
  pageButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#4E5968',
  },
  pageButtonTextActive: {
    color: '#FFFFFF',
  },
});
