import React, { useMemo, useState } from 'react';
import { ImageBackground, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { manilaTagTexture } from '../../assets';
import type { SavedTicketItem } from '../saved/SavedTicketRow';
import { CachedCollectionImageBackground } from './CachedCollectionImageBackground';
import {
  formatSavedTicketMeta,
  getDdayBadge,
  normalizeSavedCategory,
} from '../saved/savedTicketUtils';

const TEXT = '#171717';
const MUTED = '#716D66';
const RED = '#A52822';
const PAPER = '#EFE9D8';
const DAY_MS = 24 * 60 * 60 * 1000;

export type CollectionCardFilter = 'all' | 'active' | 'saved' | 'past';
export type CollectionCardStatus = 'active' | 'ended' | 'removed';
export type CollectionCurationThemeKey = 'ending-soon' | 'saved-unvisited' | 'unvisited-recent' | 'recent';

export interface CollectionCurationTheme {
  key: CollectionCurationThemeKey;
  eyebrow: string;
  title: string;
  description: string;
  cards: CollectionOverviewCard[];
}

/**
 * 컬렉션에는 광고 시청을 끝내고 공개된 카드만 전달한다.
 * 잠긴 카드나 아직 공개하지 않은 이벤트를 이 타입으로 변환하지 않는다.
 */
export interface CollectionOverviewCard extends SavedTicketItem {
  openedAt?: string | null;
  isSaved: boolean;
  isVisited: boolean;
  visitedAt?: string | null;
}

export interface CollectionVisitRecord {
  eventId: string;
  visitedAt: string;
  title?: string | null;
  category?: string | null;
  region?: string | null;
  venue?: string | null;
  imageUrl?: string | null;
  startAt?: string | null;
  endAt?: string | null;
  status?: CollectionCardStatus;
  note?: string | null;
}

export interface CollectionOverviewSectionsProps {
  openedCards: readonly CollectionOverviewCard[];
  visitRecords: readonly CollectionVisitRecord[];
  /** 큐레이션 섹션과 "내가 연 카드" 사이에 끼우는 슬롯(배너 광고 등). */
  midSlot?: React.ReactNode;
  filter?: CollectionCardFilter;
  defaultFilter?: CollectionCardFilter;
  onFilterChange?: (filter: CollectionCardFilter) => void;
  referenceDate?: Date;
  curationLimit?: number;
  openedPreviewLimit?: number;
  visitPreviewLimit?: number;
  hasMoreOpened?: boolean;
  isLoadingMoreOpened?: boolean;
  hasMoreVisits?: boolean;
  isLoadingMoreVisits?: boolean;
  onPressActiveCard: (card: CollectionOverviewCard) => void;
  onToggleSave?: (card: CollectionOverviewCard) => void;
  onToggleVisit?: (card: CollectionOverviewCard) => void;
  onDirections?: (card: CollectionOverviewCard) => void;
  onViewAllOpened?: (filter: CollectionCardFilter) => void;
  onViewAllVisits?: () => void;
  onOpenNewCard: () => void;
}

function localDayValue(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function parseDateOnly(value?: string | null): Date | null {
  if (!value) return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  return new Date(year, month - 1, day);
}

function daysUntil(endAt: string | null | undefined, referenceDate: Date): number | null {
  const endDate = parseDateOnly(endAt);
  if (!endDate) return null;
  return Math.round((localDayValue(endDate) - localDayValue(referenceDate)) / DAY_MS);
}

export function getCollectionCardStatus(
  card: Pick<CollectionOverviewCard, 'endAt' | 'lastKnownStatus'>,
  referenceDate = new Date()
): CollectionCardStatus {
  if (card.lastKnownStatus === 'deleted') return 'removed';
  if (card.lastKnownStatus === 'ended') return 'ended';
  const remaining = daysUntil(card.endAt, referenceDate);
  return remaining !== null && remaining < 0 ? 'ended' : 'active';
}

export function filterCollectionCards(
  cards: readonly CollectionOverviewCard[],
  filter: CollectionCardFilter,
  referenceDate = new Date()
): CollectionOverviewCard[] {
  if (filter === 'all') return [...cards];
  if (filter === 'saved') return cards.filter((card) => card.isSaved);
  if (filter === 'active') {
    return cards.filter((card) => getCollectionCardStatus(card, referenceDate) === 'active');
  }
  return cards.filter((card) => getCollectionCardStatus(card, referenceDate) !== 'active');
}

function openedAtValue(card: CollectionOverviewCard): number {
  if (!card.openedAt) return 0;
  const parsed = new Date(card.openedAt).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeThemeLimit(limit: number): number {
  if (!Number.isFinite(limit)) return 6;
  return Math.max(4, Math.min(6, Math.floor(limit)));
}

/**
 * 공개된 진행 중 카드만 주제별 선반으로 나눈다.
 * 한 카드는 먼저 조건을 충족한 선반에만 들어가 선반 사이의 반복 노출을 피한다.
 */
export function buildCollectionCurationThemes(
  cards: readonly CollectionOverviewCard[],
  referenceDate = new Date(),
  limitPerTheme = 6
): CollectionCurationTheme[] {
  const safeLimit = normalizeThemeLimit(limitPerTheme);
  const seenIds = new Set<string>();
  const seenContent = new Set<string>();
  const uniqueActive = cards
    .map((card, index) => ({ card, index }))
    .filter(({ card }) => {
      if (seenIds.has(card.id)) return false;
      seenIds.add(card.id);
      if (getCollectionCardStatus(card, referenceDate) !== 'active') return false;
      // 제목+장소가 같은 데이터 중복(병합 안 된 다른 event_id)은 한 번만 노출한다.
      const title = (card.title ?? '').trim().toLowerCase();
      const contentKey = title ? `${title}|${(card.venue ?? '').trim().toLowerCase()}` : null;
      if (contentKey) {
        if (seenContent.has(contentKey)) return false;
        seenContent.add(contentKey);
      }
      return true;
    });
  const recentFirst = [...uniqueActive].sort(
    (a, b) => openedAtValue(b.card) - openedAtValue(a.card) || a.index - b.index
  );
  const endingFirst = [...uniqueActive].sort((a, b) => {
    const aDays = daysUntil(a.card.endAt, referenceDate) ?? Number.POSITIVE_INFINITY;
    const bDays = daysUntil(b.card.endAt, referenceDate) ?? Number.POSITIVE_INFINITY;
    return aDays - bDays || openedAtValue(b.card) - openedAtValue(a.card) || a.index - b.index;
  });
  const assignedIds = new Set<string>();
  const themes: CollectionCurationTheme[] = [];

  const appendTheme = (
    key: CollectionCurationThemeKey,
    eyebrow: string,
    title: string,
    description: string,
    candidates: Array<{ card: CollectionOverviewCard; index: number }>
  ) => {
    const selected = candidates
      .filter(({ card }) => !assignedIds.has(card.id))
      .slice(0, safeLimit)
      .map(({ card }) => card);
    if (selected.length === 0) return;
    selected.forEach((card) => assignedIds.add(card.id));
    themes.push({ key, eyebrow, title, description, cards: selected });
  };

  appendTheme(
    'ending-soon',
    'ENDING SOON',
    '놓치기 전에',
    '7일 안에 끝나는 공개 카드예요.',
    endingFirst.filter(({ card }) => {
      const remaining = daysUntil(card.endAt, referenceDate);
      return remaining !== null && remaining >= 0 && remaining <= 7;
    })
  );
  appendTheme(
    'saved-unvisited',
    'SAVED FOR LATER',
    '저장해 두고 아직 못 간 곳',
    '마음에 담아둔 카드부터 다시 골랐어요.',
    recentFirst.filter(({ card }) => card.isSaved && !card.isVisited)
  );
  appendTheme(
    'unvisited-recent',
    'UNVISITED',
    '최근 열고 아직 안 가본 카드',
    '새롭게 공개한 문화부터 살펴보세요.',
    recentFirst.filter(({ card }) => !card.isVisited)
  );
  appendTheme(
    'recent',
    'RECENTLY OPENED',
    '최근 공개한 카드',
    '앞선 추천과 겹치지 않는 최근 기록이에요.',
    recentFirst
  );

  return themes;
}

function formatShortDate(value?: string | null): string {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return `${String(parsed.getFullYear()).slice(2)}.${parsed.getMonth() + 1}.${parsed.getDate()}`;
}

function formatPeriod(card: CollectionOverviewCard): string {
  const start = parseDateOnly(card.startAt);
  const end = parseDateOnly(card.endAt);
  const format = (date: Date) => `${date.getFullYear()}.${date.getMonth() + 1}.${date.getDate()}`;
  if (start && end) return `${format(start)} - ${format(end)}`;
  if (end) return `${format(end)}까지`;
  if (start) return `${format(start)}부터`;
  return '기간 정보가 없어요';
}

function themeCardLabel(
  theme: CollectionCurationThemeKey,
  card: CollectionOverviewCard,
  referenceDate: Date
): string {
  if (theme === 'ending-soon') return getDdayBadge(card.endAt, referenceDate).label;
  if (theme === 'saved-unvisited') return '저장해 둔 카드';
  if (theme === 'unvisited-recent') return '아직 안 가본 카드';
  return '최근 공개';
}

function statusLabel(status: CollectionCardStatus): string {
  if (status === 'removed') return '정보 제공 종료';
  if (status === 'ended') return '지난 문화';
  return '진행 중';
}

type CardActions = Pick<CollectionOverviewSectionsProps, 'onToggleSave' | 'onToggleVisit' | 'onDirections'>;

function ActionButtons({
  card,
  status,
  onToggleSave,
  onToggleVisit,
  onDirections,
}: {
  card: CollectionOverviewCard;
  status: CollectionCardStatus;
} & CardActions) {
  if (status !== 'active') return null;
  if (!onToggleSave && !onToggleVisit && !onDirections) return null;
  return (
    <View style={styles.actions}>
      {onToggleSave ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${card.title} ${card.isSaved ? '저장 취소' : '저장'}`}
          onPress={(event) => {
            event.stopPropagation();
            onToggleSave(card);
          }}
          style={styles.actionPill}
        >
          <Text style={styles.actionText}>{card.isSaved ? '저장됨' : '저장'}</Text>
        </Pressable>
      ) : null}
      {onToggleVisit ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${card.title} ${card.isVisited ? '방문 기록 취소' : '다녀왔어요'}`}
          onPress={(event) => {
            event.stopPropagation();
            onToggleVisit(card);
          }}
          style={styles.actionPill}
        >
          <Text style={styles.actionText}>{card.isVisited ? '방문함' : '방문'}</Text>
        </Pressable>
      ) : null}
      {onDirections ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${card.title} 길찾기`}
          onPress={(event) => {
            event.stopPropagation();
            onDirections(card);
          }}
          style={styles.actionPill}
        >
          <Text style={styles.actionText}>길찾기</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function CollectionPosterCard({
  card,
  status,
  label,
  compact = false,
  visitDate,
  onPress,
  ...actions
}: {
  card: CollectionOverviewCard;
  status: CollectionCardStatus;
  label?: string;
  compact?: boolean;
  visitDate?: string | null;
  onPress: () => void;
} & CardActions) {
  const category = normalizeSavedCategory(card.category, card.subCategory);
  const content = (
    <>
      <View style={styles.posterShade} />
      <View style={styles.posterTop}>
        <Text style={styles.posterCategory}>{category}</Text>
        <Text style={[styles.statusBadge, status !== 'active' ? styles.statusBadgePast : null]}>
          {label ?? statusLabel(status)}
        </Text>
      </View>
      {visitDate ? (
        <View style={styles.visitStamp} pointerEvents="none">
          <Text style={styles.visitStampTitle}>다녀옴</Text>
          <Text style={styles.visitStampDate}>{formatShortDate(visitDate)}</Text>
        </View>
      ) : null}
      <View style={[styles.posterBottom, compact ? styles.posterBottomCompact : null]}>
        <Text style={[styles.posterTitle, compact ? styles.posterTitleCompact : null]} numberOfLines={2}>
          {card.title}
        </Text>
        <Text style={styles.posterMeta} numberOfLines={1}>
          {formatSavedTicketMeta(card)}
        </Text>
        {!compact ? <ActionButtons card={card} status={status} {...actions} /> : null}
      </View>
    </>
  );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${card.title} ${status === 'active' ? '상세 보기' : '보관 정보 보기'}`}
      onPress={onPress}
      style={({ pressed }) => [
        compact ? styles.posterCompact : styles.poster,
        pressed ? styles.pressed : null,
        status !== 'active' ? styles.posterPast : null,
      ]}
    >
      <CachedCollectionImageBackground
        uri={card.imageUrl}
        category={card.category}
        subCategory={card.subCategory}
        style={styles.posterImage}
      >
        {content}
      </CachedCollectionImageBackground>
    </Pressable>
  );
}

function SectionHeader({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description?: string;
}) {
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionHeaderCopy}>
        <Text style={styles.eyebrow}>{eyebrow}</Text>
        <Text style={styles.sectionTitle}>{title}</Text>
        {description ? <Text style={styles.sectionDescription}>{description}</Text> : null}
      </View>
    </View>
  );
}

function FullWidthListButton({
  title,
  unit,
  visibleCount,
  availableCount,
  hasMore,
  loading,
  onPress,
}: {
  title: string;
  unit: '장' | '개';
  visibleCount: number;
  availableCount: number;
  hasMore: boolean;
  loading: boolean;
  onPress?: () => void;
}) {
  if (!onPress || (visibleCount >= availableCount && !hasMore)) return null;
  const remaining = Math.max(0, availableCount - visibleCount);
  const countCopy = remaining > 0
    ? `${visibleCount}${unit} 표시 · ${remaining}${unit} 더 볼 수 있어요`
    : `${visibleCount}${unit} 표시 · 지난 기록을 더 불러올 수 있어요`;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${countCopy}`}
      disabled={loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.fullListButton,
        pressed ? styles.pressed : null,
        loading ? styles.fullListButtonDisabled : null,
      ]}
    >
      <View style={styles.fullListButtonCopy}>
        <Text style={styles.fullListButtonTitle}>{loading ? '불러오는 중' : title}</Text>
        <Text style={styles.fullListButtonCount}>{countCopy}</Text>
      </View>
      <Text style={styles.fullListButtonArrow}>→</Text>
    </Pressable>
  );
}

export function CollectionArchiveSnapshotModal({
  card,
  referenceDate,
  onClose,
}: {
  card: CollectionOverviewCard | null;
  referenceDate: Date;
  onClose: () => void;
}) {
  if (!card) return null;
  const status = getCollectionCardStatus(card, referenceDate);
  const body = (
    <>
      <View style={styles.modalPhotoShade} />
      <Text style={styles.modalStatus}>{statusLabel(status)}</Text>
    </>
  );
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="보관 정보 닫기"
        style={styles.modalDim}
        onPress={onClose}
      >
        <Pressable style={styles.modalCard} onPress={() => {}}>
          <CachedCollectionImageBackground
            uri={card.imageUrl}
            category={card.category}
            subCategory={card.subCategory}
            style={styles.modalPhoto}
          >
            {body}
          </CachedCollectionImageBackground>
          <View style={styles.modalBody}>
            <Text style={styles.modalEyebrow}>COLLECTION ARCHIVE</Text>
            <Text style={styles.modalTitle}>{card.title}</Text>
            <Text style={styles.modalMeta}>{formatSavedTicketMeta(card)}</Text>
            <Text style={styles.modalPeriod}>{formatPeriod(card)}</Text>
            <Text style={styles.modalNotice}>
              {status === 'removed'
                ? '현재 행사 정보는 제공되지 않지만, 공개했던 카드의 기록은 컬렉션에 남아 있어요.'
                : '기간이 지난 문화예요. 공개 당시의 정보를 기록으로 보관하고 있어요.'}
            </Text>
            <Pressable accessibilityRole="button" onPress={onClose} style={styles.modalClose}>
              <Text style={styles.modalCloseText}>컬렉션으로 돌아가기</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export const COLLECTION_CARD_FILTERS: ReadonlyArray<{ key: CollectionCardFilter; label: string }> = [
  { key: 'all', label: '전체' },
  { key: 'active', label: '진행 중' },
  { key: 'saved', label: '저장' },
  { key: 'past', label: '지난 문화' },
];

export function CollectionOverviewSections({
  openedCards,
  visitRecords,
  midSlot,
  filter,
  defaultFilter = 'all',
  onFilterChange,
  referenceDate = new Date(),
  curationLimit = 6,
  openedPreviewLimit = 12,
  visitPreviewLimit = 6,
  hasMoreOpened = false,
  isLoadingMoreOpened = false,
  hasMoreVisits = false,
  isLoadingMoreVisits = false,
  onPressActiveCard,
  onToggleSave,
  onToggleVisit,
  onDirections,
  onViewAllOpened,
  onViewAllVisits,
  onOpenNewCard,
}: CollectionOverviewSectionsProps) {
  const [internalFilter, setInternalFilter] = useState<CollectionCardFilter>(defaultFilter);
  const [archiveCard, setArchiveCard] = useState<CollectionOverviewCard | null>(null);
  const activeFilter = filter ?? internalFilter;

  const visitDateById = useMemo(
    () => new Map(visitRecords.map((record) => [record.eventId, record.visitedAt])),
    [visitRecords]
  );
  const hydratedCards = useMemo(
    () =>
      openedCards.map((card) => {
        const visitedAt = card.visitedAt ?? visitDateById.get(card.id) ?? null;
        if (visitedAt === card.visitedAt && card.isVisited === Boolean(visitedAt)) return card;
        return { ...card, isVisited: card.isVisited || Boolean(visitedAt), visitedAt };
      }),
    [openedCards, visitDateById]
  );
  const hydratedById = useMemo(() => new Map(hydratedCards.map((card) => [card.id, card])), [hydratedCards]);
  const curationThemes = useMemo(
    () => buildCollectionCurationThemes(hydratedCards, referenceDate, curationLimit),
    [curationLimit, hydratedCards, referenceDate]
  );
  const filtered = useMemo(
    () => filterCollectionCards(hydratedCards, activeFilter, referenceDate),
    [activeFilter, hydratedCards, referenceDate]
  );
  const shownOpened = onViewAllOpened ? filtered.slice(0, Math.max(1, openedPreviewLimit)) : filtered;
  const recentVisits = useMemo(
    () =>
      visitRecords
        .map((record, index) => {
          const opened = hydratedById.get(record.eventId);
          const fallbackStatus = record.status ?? 'active';
          const card: CollectionOverviewCard = opened ?? {
            id: record.eventId,
            title: record.title?.trim() || '다녀온 문화',
            category: record.category,
            region: record.region,
            venue: record.venue,
            imageUrl: record.imageUrl,
            startAt: record.startAt,
            endAt: record.endAt,
            lastKnownStatus: fallbackStatus === 'removed' ? 'deleted' : fallbackStatus === 'ended' ? 'ended' : 'active',
            openedAt: null,
            isSaved: false,
            isVisited: true,
            visitedAt: record.visitedAt,
          };
          return { record, card, index };
        })
        .sort((a, b) => {
          const bTime = new Date(b.record.visitedAt).getTime();
          const aTime = new Date(a.record.visitedAt).getTime();
          return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0) || a.index - b.index;
        }),
    [hydratedById, visitRecords]
  );
  const shownVisits = onViewAllVisits ? recentVisits.slice(0, Math.max(1, visitPreviewLimit)) : recentVisits;
  const counts = useMemo(
    () => ({
      all: hydratedCards.length,
      active: filterCollectionCards(hydratedCards, 'active', referenceDate).length,
      saved: filterCollectionCards(hydratedCards, 'saved', referenceDate).length,
      past: filterCollectionCards(hydratedCards, 'past', referenceDate).length,
    }),
    [hydratedCards, referenceDate]
  );

  const selectFilter = (next: CollectionCardFilter) => {
    if (filter === undefined) setInternalFilter(next);
    onFilterChange?.(next);
  };
  const pressCard = (card: CollectionOverviewCard) => {
    if (getCollectionCardStatus(card, referenceDate) === 'active') onPressActiveCard(card);
    else setArchiveCard(card);
  };
  const actions = { onToggleSave, onToggleVisit, onDirections };

  return (
    <View style={styles.container}>
      {curationThemes.length > 0 ? (
        <View style={styles.section}>
          <SectionHeader
            eyebrow="PICKS FROM YOUR CARDS"
            title="지금 가기 좋은 내 카드"
            description="이미 공개한 카드를 이유별로 다시 골랐어요."
          />
          <View style={styles.themeList}>
            {curationThemes.map((theme) => (
              <View key={theme.key} style={styles.themeShelf}>
                <Text style={styles.themeEyebrow}>{theme.eyebrow}</Text>
                <Text style={styles.themeTitle}>{theme.title}</Text>
                <Text style={styles.themeDescription}>{theme.description}</Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.themeCards}
                >
                  {theme.cards.map((card) => (
                    <View key={card.id} style={styles.themeCardCell}>
                      <CollectionPosterCard
                        card={card}
                        status="active"
                        label={themeCardLabel(theme.key, card, referenceDate)}
                        compact
                        onPress={() => pressCard(card)}
                      />
                    </View>
                  ))}
                </ScrollView>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {midSlot}

      <View style={styles.section}>
        <SectionHeader
          eyebrow="OPENED COLLECTION"
          title="내가 연 카드"
          description={`${counts.all}장의 공개 기록을 모았어요.`}
        />
        <View style={styles.filters}>
          {COLLECTION_CARD_FILTERS.map((item) => {
            const selected = item.key === activeFilter;
            return (
              <Pressable
                key={item.key}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => selectFilter(item.key)}
                style={[styles.filter, selected ? styles.filterSelected : null]}
              >
                <Text style={[styles.filterText, selected ? styles.filterTextSelected : null]}>
                  {item.label} {counts[item.key]}
                </Text>
              </Pressable>
            );
          })}
        </View>
        {shownOpened.length > 0 ? (
          <View style={styles.cardGrid}>
            {shownOpened.map((card) => {
              const status = getCollectionCardStatus(card, referenceDate);
              return (
                <View key={card.id} style={styles.gridCell}>
                  <CollectionPosterCard
                    card={card}
                    status={status}
                    compact
                    visitDate={card.isVisited ? card.visitedAt : null}
                    onPress={() => pressCard(card)}
                    {...actions}
                  />
                </View>
              );
            })}
          </View>
        ) : (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyTitle}>이 조건에 맞는 카드가 없어요</Text>
            <Text style={styles.emptyDescription}>다른 필터를 선택해 컬렉션을 살펴보세요.</Text>
          </View>
        )}
        <FullWidthListButton
          title="열린 카드 전체보기"
          unit="장"
          visibleCount={shownOpened.length}
          availableCount={filtered.length}
          hasMore={hasMoreOpened}
          loading={isLoadingMoreOpened}
          onPress={onViewAllOpened ? () => onViewAllOpened(activeFilter) : undefined}
        />
      </View>

      <View style={styles.section}>
        <SectionHeader
          eyebrow="VISIT NOTES"
          title="최근 방문 기록"
          description="공개한 카드에 다녀온 날짜를 차곡차곡 남겼어요."
        />
        {shownVisits.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.visitList}>
            {shownVisits.map(({ card, record }) => (
              <View key={`${record.eventId}-${record.visitedAt}`} style={styles.visitCell}>
                <CollectionPosterCard
                  card={card}
                  status={getCollectionCardStatus(card, referenceDate)}
                  compact
                  visitDate={record.visitedAt}
                  onPress={() => pressCard(card)}
                />
                {record.note ? (
                  <Text style={styles.visitNote} numberOfLines={2}>
                    {record.note}
                  </Text>
                ) : null}
              </View>
            ))}
          </ScrollView>
        ) : (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyTitle}>아직 방문 기록이 없어요</Text>
            <Text style={styles.emptyDescription}>다녀온 카드에 방문 표시를 남겨보세요.</Text>
          </View>
        )}
        <FullWidthListButton
          title="방문 기록 전체보기"
          unit="개"
          visibleCount={shownVisits.length}
          availableCount={recentVisits.length}
          hasMore={hasMoreVisits}
          loading={isLoadingMoreVisits}
          onPress={onViewAllVisits}
        />
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="홈에서 새 컬처카드 열기"
        onPress={onOpenNewCard}
        style={({ pressed }) => [styles.openCardCta, pressed ? styles.pressed : null]}
      >
        <ImageBackground source={manilaTagTexture} style={styles.openCardPaper} imageStyle={styles.openCardTexture}>
          <View style={styles.openCardSeal}>
            <Text style={styles.openCardSealText}>NEW</Text>
          </View>
          <View style={styles.openCardCopy}>
            <Text style={styles.openCardEyebrow}>ADD TO COLLECTION</Text>
            <Text style={styles.openCardTitle}>새 카드를 컬렉션에 더해볼까요?</Text>
            <Text style={styles.openCardDescription}>어떤 문화인지는 광고를 본 뒤 공개돼요.</Text>
          </View>
          <Text style={styles.openCardArrow}>→</Text>
        </ImageBackground>
      </Pressable>

      <CollectionArchiveSnapshotModal
        card={archiveCard}
        referenceDate={referenceDate}
        onClose={() => setArchiveCard(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 34, paddingBottom: 8 },
  section: { gap: 14 },
  sectionHeader: { flexDirection: 'row', alignItems: 'flex-end', gap: 12 },
  sectionHeaderCopy: { flex: 1, minWidth: 0 },
  eyebrow: { color: RED, fontSize: 9.5, lineHeight: 13, letterSpacing: 1.4, fontWeight: '900' },
  sectionTitle: {
    marginTop: 4,
    color: TEXT,
    fontSize: 22,
    lineHeight: 29,
    fontWeight: '900',
    fontFamily: 'Noto Serif KR',
  },
  sectionDescription: { marginTop: 5, color: MUTED, fontSize: 12, lineHeight: 18, fontWeight: '600' },
  themeList: { gap: 24 },
  themeShelf: { gap: 5 },
  themeEyebrow: { color: RED, fontSize: 8.5, lineHeight: 12, letterSpacing: 1.2, fontWeight: '900' },
  themeTitle: { color: TEXT, fontSize: 17, lineHeight: 23, fontWeight: '900', fontFamily: 'Noto Serif KR' },
  themeDescription: { color: MUTED, fontSize: 10.5, lineHeight: 15, fontWeight: '600' },
  themeCards: { gap: 9, paddingTop: 7, paddingRight: 20 },
  themeCardCell: { width: 168 },
  poster: { width: '100%', height: 238, borderRadius: 22, overflow: 'hidden', backgroundColor: '#2C2B2E' },
  posterCompact: { width: '100%', height: 176, borderRadius: 17, overflow: 'hidden', backgroundColor: '#2C2B2E' },
  posterPast: { opacity: 0.78 },
  posterImage: { flex: 1, justifyContent: 'space-between' },
  posterShade: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.24)' },
  posterTop: { padding: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  posterCategory: { color: '#F0C55F', fontSize: 9, lineHeight: 12, fontWeight: '900', letterSpacing: 0.7 },
  statusBadge: {
    color: '#FFFFFF',
    fontSize: 8.5,
    lineHeight: 12,
    fontWeight: '900',
    backgroundColor: RED,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    overflow: 'hidden',
  },
  statusBadgePast: { backgroundColor: 'rgba(30,28,25,0.72)' },
  posterBottom: { padding: 13, backgroundColor: 'rgba(24,22,20,0.79)' },
  posterBottomCompact: { padding: 10 },
  posterTitle: { color: '#FFFFFF', fontSize: 19, lineHeight: 25, fontWeight: '900', fontFamily: 'Noto Serif KR' },
  posterTitleCompact: { fontSize: 14, lineHeight: 19 },
  posterMeta: { marginTop: 4, color: 'rgba(255,255,255,0.72)', fontSize: 9.5, lineHeight: 13, fontWeight: '700' },
  actions: { marginTop: 9, flexDirection: 'row', gap: 5, flexWrap: 'wrap' },
  actionPill: {
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5,
    backgroundColor: 'rgba(255,255,255,0.17)',
  },
  actionText: { color: '#FFFFFF', fontSize: 8.5, fontWeight: '900' },
  visitStamp: {
    position: 'absolute',
    right: 10,
    top: 42,
    width: 59,
    height: 59,
    borderRadius: 30,
    borderWidth: 2,
    borderColor: '#F4DBD6',
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '-9deg' }],
    backgroundColor: 'rgba(165,40,34,0.72)',
  },
  visitStampTitle: { color: '#FFFFFF', fontSize: 10, fontWeight: '900' },
  visitStampDate: { marginTop: 2, color: '#FFFFFF', fontSize: 8, fontWeight: '800' },
  pressed: { opacity: 0.76 },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  filter: {
    minHeight: 36,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#DDD6C9',
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F7F5EF',
  },
  filterSelected: { borderColor: RED, backgroundColor: RED },
  filterText: { color: MUTED, fontSize: 10.5, fontWeight: '900' },
  filterTextSelected: { color: '#FFFFFF' },
  cardGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  gridCell: { width: '48.5%' },
  emptyBox: {
    minHeight: 112,
    borderRadius: 18,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: PAPER,
  },
  emptyTitle: { color: TEXT, fontSize: 14, lineHeight: 20, fontWeight: '900', textAlign: 'center' },
  emptyDescription: {
    marginTop: 5,
    color: MUTED,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '600',
    textAlign: 'center',
  },
  fullListButton: {
    width: '100%',
    minHeight: 62,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: 'rgba(165,40,34,0.24)',
    backgroundColor: '#F2E9E5',
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  fullListButtonDisabled: { opacity: 0.58 },
  fullListButtonCopy: { flex: 1, minWidth: 0 },
  fullListButtonTitle: { color: RED, fontSize: 13, lineHeight: 18, fontWeight: '900' },
  fullListButtonCount: { marginTop: 3, color: MUTED, fontSize: 10.5, lineHeight: 15, fontWeight: '700' },
  fullListButtonArrow: { color: RED, fontSize: 21, lineHeight: 24, fontWeight: '800' },
  visitList: { gap: 10, paddingRight: 20 },
  visitCell: { width: 168 },
  visitNote: { marginTop: 7, color: MUTED, fontSize: 10.5, lineHeight: 15, fontWeight: '700' },
  openCardCta: {
    minHeight: 150,
    borderRadius: 22,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#D8CBA8',
    backgroundColor: PAPER,
  },
  openCardPaper: { flex: 1, padding: 18, flexDirection: 'row', alignItems: 'center', gap: 14 },
  openCardTexture: { opacity: 0.22 },
  openCardSeal: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 2,
    borderColor: RED,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '-7deg' }],
  },
  openCardSealText: { color: RED, fontSize: 10, letterSpacing: 1, fontWeight: '900' },
  openCardCopy: { flex: 1, minWidth: 0 },
  openCardEyebrow: { color: RED, fontSize: 8.5, lineHeight: 12, letterSpacing: 1.2, fontWeight: '900' },
  openCardTitle: {
    marginTop: 5,
    color: TEXT,
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '900',
    fontFamily: 'Noto Serif KR',
  },
  openCardDescription: { marginTop: 5, color: MUTED, fontSize: 10.5, lineHeight: 15, fontWeight: '700' },
  openCardArrow: { color: RED, fontSize: 24, fontWeight: '800' },
  modalDim: { flex: 1, backgroundColor: 'rgba(8,6,3,0.82)', justifyContent: 'center', paddingHorizontal: 22 },
  modalCard: {
    borderRadius: 22,
    overflow: 'hidden',
    backgroundColor: '#F4EFE4',
    borderWidth: 1,
    borderColor: '#D8CBA8',
  },
  modalPhoto: { height: 210, justifyContent: 'flex-start', alignItems: 'flex-start', padding: 14 },
  modalPhotoFallback: { backgroundColor: '#4C5147' },
  modalPhotoShade: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.24)' },
  modalStatus: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '900',
    backgroundColor: 'rgba(30,28,25,0.78)',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    overflow: 'hidden',
  },
  modalBody: { padding: 18 },
  modalEyebrow: { color: RED, fontSize: 9, letterSpacing: 1.3, fontWeight: '900' },
  modalTitle: {
    marginTop: 7,
    color: TEXT,
    fontSize: 22,
    lineHeight: 29,
    fontWeight: '900',
    fontFamily: 'Noto Serif KR',
  },
  modalMeta: { marginTop: 7, color: MUTED, fontSize: 12, lineHeight: 17, fontWeight: '700' },
  modalPeriod: { marginTop: 3, color: MUTED, fontSize: 11, lineHeight: 16, fontWeight: '600' },
  modalNotice: { marginTop: 14, color: MUTED, fontSize: 11.5, lineHeight: 18, fontWeight: '600' },
  modalClose: {
    marginTop: 18,
    minHeight: 46,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: RED,
  },
  modalCloseText: { color: '#FFFFFF', fontSize: 12.5, fontWeight: '900' },
});
