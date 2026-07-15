import type {
  PassportCollectionStatus,
  PassportDiscoveredCard,
  PassportStamp,
} from '../../services/passportService';
import type {
  CollectionOverviewCard,
  CollectionVisitRecord,
} from './CollectionOverviewSections';
import type { CollectionSessionCache } from '../../lib/collectionSessionCache';

export function toLastKnownStatus(
  status: PassportCollectionStatus | undefined,
): CollectionOverviewCard['lastKnownStatus'] {
  if (status === 'removed') return 'deleted';
  if (status === 'ended') return 'ended';
  return 'active';
}

export function uniqueDiscoveredCards(
  cards: readonly PassportDiscoveredCard[],
): PassportDiscoveredCard[] {
  return Array.from(new Map(cards.map((card) => [card.eventId, card])).values()).sort((a, b) => {
    const aTime = new Date(a.discoveredAt).getTime();
    const bTime = new Date(b.discoveredAt).getTime();
    const safeATime = Number.isFinite(aTime) ? aTime : 0;
    const safeBTime = Number.isFinite(bTime) ? bTime : 0;
    return safeBTime - safeATime || b.eventId.localeCompare(a.eventId);
  });
}

export function mergeDiscoveredCards(
  previous: readonly PassportDiscoveredCard[],
  incoming: readonly PassportDiscoveredCard[],
): PassportDiscoveredCard[] {
  return uniqueDiscoveredCards([...previous, ...incoming]);
}

export function mergeVisitStamps(
  previous: readonly PassportStamp[],
  incoming: readonly PassportStamp[],
): PassportStamp[] {
  const byEventId = new Map<string, PassportStamp>();
  for (const stamp of [...previous, ...incoming]) {
    const current = byEventId.get(stamp.eventId);
    if (!current || new Date(stamp.visitedAt).getTime() >= new Date(current.visitedAt).getTime()) {
      byEventId.set(stamp.eventId, stamp);
    }
  }
  return [...byEventId.values()].sort(
    (a, b) => {
      const aTime = new Date(a.visitedAt).getTime();
      const bTime = new Date(b.visitedAt).getTime();
      const safeATime = Number.isFinite(aTime) ? aTime : 0;
      const safeBTime = Number.isFinite(bTime) ? bTime : 0;
      return safeBTime - safeATime || b.eventId.localeCompare(a.eventId);
    },
  );
}

export function toCollectionOverviewCards(
  cards: readonly PassportDiscoveredCard[],
  savedIds: ReadonlySet<string>,
  visitedIds: ReadonlySet<string>,
  stamps: readonly PassportStamp[],
): CollectionOverviewCard[] {
  const visitDateById = new Map(stamps.map((stamp) => [stamp.eventId, stamp.visitedAt]));
  return cards.map((card) => ({
    id: card.eventId,
    title: card.title,
    category: card.category,
    region: card.region,
    venue: card.venue,
    imageUrl: card.imageUrl,
    startAt: card.startAt,
    endAt: card.endAt,
    lat: card.lat,
    lng: card.lng,
    lastKnownStatus: toLastKnownStatus(card.status),
    openedAt: card.discoveredAt,
    isSaved: savedIds.has(card.eventId),
    isVisited: visitedIds.has(card.eventId),
    visitedAt: visitDateById.get(card.eventId) ?? null,
  }));
}

export function toCollectionVisitRecords(
  stamps: readonly PassportStamp[],
): CollectionVisitRecord[] {
  return stamps.map((stamp) => ({
    eventId: stamp.eventId,
    title: stamp.title,
    category: stamp.category,
    region: stamp.region,
    venue: stamp.venue,
    imageUrl: stamp.imageUrl,
    visitedAt: stamp.visitedAt,
    status: stamp.status,
  }));
}

/**
 * 컬렉션 홈이 화면 아래에 살아 있는 동안 전체보기 화면이 더 깊은 페이지를
 * 캐시에 쓸 수 있다. 홈의 저장/방문 상태 변경이 그 페이지를 되돌리지 않도록
 * 데이터 최신 시각과 로드 깊이를 각각 비교해 합친다.
 */
export function mergeCollectionSessionSnapshots(
  current: CollectionSessionCache | null,
  incoming: CollectionSessionCache,
): CollectionSessionCache {
  if (!current) return incoming;

  const currentIsNewer = current.fetchedAt > incoming.fetchedAt;
  const openedCards = currentIsNewer
    ? mergeDiscoveredCards(incoming.openedCards, current.openedCards)
    : mergeDiscoveredCards(current.openedCards, incoming.openedCards);
  const incomingVisitedIds = new Set(incoming.visitedEventIds);
  const currentValidStamps = current.visitStamps.filter((stamp) => incomingVisitedIds.has(stamp.eventId));
  const visitStamps = currentIsNewer
    ? mergeVisitStamps(incoming.visitStamps, currentValidStamps)
    : mergeVisitStamps(currentValidStamps, incoming.visitStamps);

  const pageInfo = current.openedCards.length > incoming.openedCards.length
    ? current.pageInfo
    : current.openedCards.length < incoming.openedCards.length
      ? incoming.pageInfo
      : currentIsNewer
        ? current.pageInfo
        : incoming.pageInfo;

  return {
    passport: currentIsNewer ? current.passport : incoming.passport,
    openedCards,
    pageInfo,
    visitStamps,
    nextStampBook: Math.max(current.nextStampBook, incoming.nextStampBook),
    savedEventIds: incoming.savedEventIds,
    visitedEventIds: incoming.visitedEventIds,
    fetchedAt: Math.max(current.fetchedAt, incoming.fetchedAt),
  };
}
