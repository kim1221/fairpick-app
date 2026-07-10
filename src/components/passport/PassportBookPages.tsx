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
  SavedTicketRow,
  type SavedTicketItem,
  type SaveButtonState,
  type VisitButtonState,
} from '../saved/SavedTicketRow';
import { PassportEmblem } from './PassportEmblem';

const GOLD = '#CBA15E';
const GOLD_SOFT = '#DDB877';
const PAPER_EDGE = '#D6C79E';
const INK = '#2C2A22';
const INK_SUB = '#6E6350';
const NAVY_STAMP = '#2A386A';
const RED_STAMP = '#A8331F';

export type PassportBookmarkItem = {
  section: PassportBookmarkSection;
  label: string;
};

export function PassportTicketBookPage({
  width,
  copy,
  pageIndex,
  totalPages,
  items,
  getVisitState,
  getSaveState,
  getStampSignal,
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
  getStampSignal: (id: string) => number;
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
          {items.map((item) => (
            <SavedTicketRow
              key={item.id}
              item={item}
              visitState={getVisitState(item.id)}
              stampSignal={getStampSignal(item.id)}
              saveState={getSaveState(item.id)}
              onPress={onPressTicket}
              onDirections={onDirections}
              onVisit={onVisit}
              onToggleSave={onToggleSave}
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
    height: 400,
    paddingHorizontal: 20,
  },
  paperFace: {
    flex: 1,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: PAPER_EDGE,
    paddingHorizontal: 14,
    paddingTop: 18,
    paddingBottom: 16,
  },
  paperFaceImg: {
    opacity: 0.96,
  },
  paperWash: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,249,235,0.45)',
  },
  watermark: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 160,
    alignItems: 'center',
  },
  headerRow: {
    minHeight: 82,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  eyebrow: {
    color: NAVY_STAMP,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '900',
    letterSpacing: 2,
  },
  title: {
    marginTop: 6,
    color: INK,
    fontSize: 24,
    lineHeight: 31,
    fontWeight: '900',
    fontFamily: 'Noto Serif KR',
  },
  description: {
    marginTop: 4,
    color: INK_SUB,
    fontSize: 12.5,
    lineHeight: 18,
    fontWeight: '700',
  },
  pageBadge: {
    minWidth: 42,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: GOLD,
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
    gap: 12,
    paddingBottom: 2,
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
    borderBottomColor: '#3157D5',
  },
  indexText: {
    color: '#716D66',
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '900',
  },
  indexTextActive: {
    color: '#3157D5',
  },
});
