import { Icon, Loader } from '@toss/tds-react-native';
import React from 'react';
import { ImageBackground, Pressable, StyleSheet, Text, View } from 'react-native';
import { manilaTagTexture } from '../../assets';
import type {
  PassportBookmarkSection,
  PassportContentSection,
  PassportSectionCopy,
} from '../../pages/passportLogic';
import {
  type SavedTicketItem,
  type SaveButtonState,
  type VisitButtonState,
} from '../saved/SavedTicketRow';
import { PassportEmblem } from './PassportEmblem';

const GOLD_SOFT = '#DDB877';
const INK = '#2C2A22';
const INK_SUB = '#6E6350';
const NAVY_STAMP = '#2A386A';
const RED_STAMP = '#A8331F';
const COLLECTION_FALLBACKS = ['#28272C', '#6C2D2B', '#4C5147', '#7A6754'] as const;

export type PassportBookmarkItem = {
  section: PassportBookmarkSection;
  label: string;
};

function CollectionStoryTile({
  item,
  index,
  visitState,
  saveState,
  onPress,
  onDirections,
  onVisit,
  onToggleSave,
}: {
  item: SavedTicketItem;
  index: number;
  visitState: VisitButtonState;
  saveState: SaveButtonState;
  onPress: () => void;
  onDirections: () => void;
  onVisit: () => void;
  onToggleSave: () => void;
}) {
  const content = (
    <>
      <View style={styles.tileShade} />
      <View style={styles.tileTop}>
        <Text style={styles.tileCategory}>{item.category ?? '문화'}</Text>
        <Text style={styles.tileIndex}>0{index + 1}</Text>
      </View>
      <View style={styles.tileCopy}>
        <Text style={styles.tileTitle} numberOfLines={2}>{item.title}</Text>
        <Text style={styles.tileMeta} numberOfLines={1}>
          {[item.venue, item.region].filter(Boolean).join(' · ') || '장소 확인 중'}
        </Text>
        <View style={styles.tileActions}>
          <Pressable accessibilityRole="button" onPress={(event) => { event.stopPropagation(); onToggleSave(); }} style={styles.tileAction}>
            <Text style={styles.tileActionText}>{saveState === 'saved' ? '저장됨' : '저장'}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={(event) => { event.stopPropagation(); onVisit(); }} style={styles.tileAction}>
            <Text style={styles.tileActionText}>{visitState === 'visited' ? '방문함' : '방문'}</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={(event) => { event.stopPropagation(); onDirections(); }} style={styles.tileAction}>
            <Text style={styles.tileActionText}>길찾기</Text>
          </Pressable>
        </View>
      </View>
      {visitState === 'visited' ? (
        <View style={styles.visitedStamp}><Text style={styles.visitedStampText}>VISITED</Text></View>
      ) : null}
    </>
  );

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${item.title} 상세 보기`}
      onPress={onPress}
      style={[styles.collectionTile, index % 4 === 0 || index % 4 === 3 ? styles.collectionTileWide : styles.collectionTileNarrow]}
    >
      {item.imageUrl ? (
        <ImageBackground source={{ uri: item.imageUrl }} style={styles.tileImage} resizeMode="cover">
          {content}
        </ImageBackground>
      ) : (
        <View style={[styles.tileImage, { backgroundColor: COLLECTION_FALLBACKS[index % COLLECTION_FALLBACKS.length] }]}>
          {content}
        </View>
      )}
    </Pressable>
  );
}

export function PassportTicketBookPage({
  width,
  copy,
  pageIndex,
  totalPages,
  items,
  getVisitState,
  getSaveState,
  onPressTicket,
  onDirections,
  onVisit,
  onToggleSave,
}: {
  width: number;
  copy: PassportSectionCopy;
  pageIndex: number;
  totalPages: number;
  items: SavedTicketItem[];
  getVisitState: (id: string) => VisitButtonState;
  getSaveState: (id: string) => SaveButtonState;
  onPressTicket: (item: SavedTicketItem) => void;
  onDirections: (item: SavedTicketItem) => void;
  onVisit: (item: SavedTicketItem) => void;
  onToggleSave: (item: SavedTicketItem) => void;
}) {
  const pageNo = `${pageIndex + 1}/${Math.max(totalPages, 1)}`;
  return (
    <View style={[styles.page, { width }]}>
      <ImageBackground
        source={manilaTagTexture}
        style={styles.paperFace}
        imageStyle={styles.paperFaceImg}
        resizeMode="cover"
      >
        <View style={styles.paperWash} pointerEvents="none" />
        <View style={styles.watermark} pointerEvents="none">
          <PassportEmblem size={150} color={INK} opacity={0.05} />
        </View>

        <View style={styles.headerRow}>
          <View style={styles.headerText}>
            <Text style={styles.eyebrow}>{copy.eyebrow}</Text>
            <Text style={styles.title}>{copy.title}</Text>
            <Text style={styles.description}>{copy.description}</Text>
          </View>
          <View style={styles.pageBadge}>
            <Text style={styles.pageBadgeText}>{pageNo}</Text>
          </View>
        </View>

        <View style={styles.divider} />

        <View style={styles.ticketList}>
          {items.map((item, index) => (
            <CollectionStoryTile
              key={item.id}
              item={item}
              index={index}
              visitState={getVisitState(item.id)}
              saveState={getSaveState(item.id)}
              onPress={() => onPressTicket(item)}
              onDirections={() => onDirections(item)}
              onVisit={() => onVisit(item)}
              onToggleSave={() => onToggleSave(item)}
            />
          ))}
        </View>
      </ImageBackground>
    </View>
  );
}

export function PassportBookStatePage({
  width,
  section,
  copy,
  state,
  onRetry,
}: {
  width: number;
  section: PassportContentSection;
  copy: PassportSectionCopy;
  state: 'loading' | 'empty' | 'error';
  onRetry: () => void;
}) {
  const iconName = section === 'wishlist' ? 'icon-bookmark-mono' : 'icon-ticket-mono';
  const title =
    state === 'loading'
      ? `${copy.title}를 불러오고 있어요`
      : state === 'error'
        ? `${copy.title}를 불러오지 못했어요`
        : copy.emptyTitle;
  const description =
    state === 'empty' ? copy.emptyDescription : state === 'error' ? '잠시 후 다시 확인해 주세요.' : '';

  return (
    <View style={[styles.page, { width }]}>
      <ImageBackground
        source={manilaTagTexture}
        style={styles.paperFace}
        imageStyle={styles.paperFaceImg}
        resizeMode="cover"
      >
        <View style={styles.paperWash} pointerEvents="none" />
        <View style={styles.stateBox}>
          {state === 'loading' ? (
            <Loader size="small" customStrokeColor={INK_SUB} />
          ) : (
            <Icon name={iconName} size={30} color={section === 'stamps' ? RED_STAMP : NAVY_STAMP} />
          )}
          <Text style={styles.stateTitle}>{title}</Text>
          {description ? <Text style={styles.stateDesc}>{description}</Text> : null}
          {state === 'error' ? (
            <Pressable accessibilityRole="button" onPress={onRetry} style={styles.retryButton}>
              <Text style={styles.retryText}>다시 불러오기</Text>
            </Pressable>
          ) : null}
        </View>
      </ImageBackground>
    </View>
  );
}

export function PassportIndexRail({
  items,
  activeSection,
  onPress,
}: {
  items: PassportBookmarkItem[];
  activeSection: PassportBookmarkSection;
  onPress: (section: PassportBookmarkSection) => void;
}) {
  return (
    <View pointerEvents="box-none" style={styles.indexRail}>
      {items.map((item) => {
        const active = item.section === activeSection;
        return (
          <Pressable
            key={item.section}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => onPress(item.section)}
            style={[styles.indexTab, active ? styles.indexTabActive : null]}
          >
            <Text style={[styles.indexText, active ? styles.indexTextActive : null]}>{item.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    height: 430,
    paddingHorizontal: 20,
  },
  paperFace: {
    flex: 1,
    borderRadius: 0,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#171717',
    paddingHorizontal: 14,
    paddingTop: 18,
    paddingBottom: 16,
  },
  paperFaceImg: {
    opacity: 0.16,
  },
  paperWash: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(247,245,239,0.86)',
  },
  watermark: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 160,
    alignItems: 'center',
  },
  headerRow: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  eyebrow: {
    color: '#A52822',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '900',
    letterSpacing: 2,
  },
  title: {
    marginTop: 3,
    color: INK,
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '900',
    fontFamily: 'Noto Serif KR',
  },
  description: {
    marginTop: 2,
    color: INK_SUB,
    fontSize: 12.5,
    lineHeight: 18,
    fontWeight: '700',
  },
  pageBadge: {
    minWidth: 42,
    height: 32,
    borderRadius: 0,
    borderWidth: 1,
    borderColor: '#171717',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  pageBadgeText: {
    color: INK,
    fontSize: 11,
    fontWeight: '900',
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(44,42,34,0.32)',
    marginBottom: 12,
  },
  ticketList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
    paddingBottom: 2,
  },
  collectionTile: {
    height: 139,
    overflow: 'hidden',
    borderRadius: 8,
    backgroundColor: '#2C2B2E',
  },
  collectionTileWide: {
    width: '57.5%',
  },
  collectionTileNarrow: {
    width: '40%',
  },
  tileImage: {
    flex: 1,
    justifyContent: 'space-between',
  },
  tileShade: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.38)',
  },
  tileTop: {
    paddingHorizontal: 9,
    paddingTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  tileCategory: {
    color: '#F0C55F',
    fontSize: 8.5,
    fontWeight: '900',
    letterSpacing: 0.6,
  },
  tileIndex: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 8,
    fontWeight: '900',
  },
  tileCopy: {
    padding: 9,
  },
  tileTitle: {
    color: '#FFFFFF',
    fontSize: 13.5,
    lineHeight: 18,
    fontWeight: '900',
    fontFamily: 'Noto Serif KR',
  },
  tileMeta: {
    marginTop: 3,
    color: 'rgba(255,255,255,0.72)',
    fontSize: 8,
    lineHeight: 11,
    fontWeight: '700',
  },
  tileActions: {
    marginTop: 7,
    flexDirection: 'row',
    gap: 4,
  },
  tileAction: {
    backgroundColor: 'rgba(255,255,255,0.16)',
    paddingHorizontal: 5,
    paddingVertical: 3,
  },
  tileActionText: {
    color: '#FFFFFF',
    fontSize: 7.5,
    fontWeight: '800',
  },
  visitedStamp: {
    position: 'absolute',
    right: 7,
    top: 24,
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '-8deg' }],
  },
  visitedStampText: {
    color: '#FFFFFF',
    fontSize: 6.5,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  stateBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  stateTitle: {
    marginTop: 12,
    color: INK,
    fontSize: 18,
    lineHeight: 25,
    fontWeight: '900',
    textAlign: 'center',
  },
  stateDesc: {
    marginTop: 6,
    color: INK_SUB,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '700',
    textAlign: 'center',
  },
  retryButton: {
    marginTop: 14,
    minHeight: 40,
    borderRadius: 999,
    paddingHorizontal: 18,
    backgroundColor: NAVY_STAMP,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryText: {
    color: GOLD_SOFT,
    fontSize: 13,
    fontWeight: '900',
  },
  indexRail: {
    flexDirection: 'row',
    gap: 20,
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  indexTab: {
    minHeight: 36,
    backgroundColor: 'transparent',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  indexTabActive: {
    borderBottomColor: '#A52822',
  },
  indexText: {
    color: '#716D66',
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '900',
  },
  indexTextActive: {
    color: '#A52822',
  },
});
