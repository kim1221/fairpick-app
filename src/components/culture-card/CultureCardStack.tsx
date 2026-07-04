import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@toss/tds-react-native';
import type { Card } from '../../services/cardsService';
import type { TodayCardProgress } from './homeLogic';
import {
  CondensedDisplay,
  FieldRow,
  FinePrint,
  Rule,
  RubberStamp,
  TagBody,
  TagHeader,
  TAG_TOKENS,
} from './tagKit';

const {
  ink: INK,
  navy: NAVY,
  red: RED,
  sub: SUB,
  manila: MANILA,
  headText: HEAD_TEXT,
  navSub: NAV_SUB,
  segOff: SEG_OFF,
  ringLine: RING_LINE,
  ctaDisabledBg: CTA_DISABLED_BG,
  ctaDisabledText: CTA_DISABLED_TEXT,
} = TAG_TOKENS;

interface CultureCardStackProps {
  cards: Card[];
  activeCard: Card | null;
  progress: TodayCardProgress;
  dailyEarned: number;
  dailyLimit: number;
  loading: boolean;
  disabled: boolean;
  actionLabel: string;
  onOpen: () => void;
  bonusMode: boolean;
  openedCards: Card[];
  userRegion: string | null;
}

// 오늘 날짜 기반 티켓 번호(서버 값 없을 때) — 0704 / No.0704.25 형태
function todayTicketNo(): { no: string; ref: string } {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const yy = String(now.getFullYear()).slice(2);
  return { no: `${mm}${dd}`, ref: `No.${mm}${dd}.${yy}` };
}

function todayStampText(): string {
  const now = new Date();
  return `${String(now.getMonth() + 1).padStart(2, '0')}·${String(now.getDate()).padStart(2, '0')}`;
}

function buildLocationHook(card: Card | null): string | null {
  const region = card?.region?.trim();
  const walk = typeof card?.walkMinutes === 'number' && card.walkMinutes > 0 ? card.walkMinutes : null;
  if (!region && !walk) return null;
  const parts = [region ? `오늘은 ${region} 근처 문화예요` : '오늘의 문화예요'];
  if (walk) parts.push(`도보 ${walk}분`);
  return parts.join(' · ');
}

function createStyles() {
  return StyleSheet.create({
    section: {
      paddingHorizontal: 22,
      paddingTop: 8,
    },
    top: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      justifyContent: 'space-between',
    },
    eyebrow: {
      color: NAV_SUB,
      fontSize: 11,
      lineHeight: 15,
      fontWeight: '800',
      letterSpacing: 2.5,
    },
    title: {
      marginTop: 7,
      color: HEAD_TEXT,
      fontSize: 22,
      lineHeight: 27,
      fontWeight: '800',
      letterSpacing: -0.6,
    },
    prog: {
      alignItems: 'flex-end',
      gap: 6,
      paddingBottom: 3,
    },
    progText: {
      color: NAV_SUB,
      fontSize: 12,
      lineHeight: 16,
      fontWeight: '700',
    },
    segs: {
      flexDirection: 'row',
      gap: 4,
    },
    seg: {
      width: 16,
      height: 3,
      borderRadius: 2,
      backgroundColor: SEG_OFF,
    },
    segOn: {
      backgroundColor: MANILA,
    },
    locPill: {
      marginTop: 10,
      alignSelf: 'flex-start',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingVertical: 5,
      paddingHorizontal: 11,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: RING_LINE,
      backgroundColor: 'rgba(233,224,204,0.05)',
    },
    locPin: {
      color: MANILA,
      fontSize: 10,
      lineHeight: 14,
    },
    locText: {
      color: HEAD_TEXT,
      fontSize: 12.5,
      lineHeight: 16,
      fontWeight: '700',
      letterSpacing: -0.2,
    },
    tagArea: {
      marginTop: 14,
    },
    // 태그 내부 콘텐츠
    lbl: {
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 2,
      color: RED,
      textTransform: 'uppercase',
      marginTop: 2,
    },
    destKo: {
      fontSize: 20,
      lineHeight: 24,
      fontWeight: '900',
      letterSpacing: -0.8,
      color: INK,
      marginTop: 6,
    },
    noLbl: {
      fontSize: 11,
      fontWeight: '700',
      letterSpacing: 1.5,
      color: INK,
      opacity: 0.72,
      textTransform: 'uppercase',
    },
    noVal: {
      fontSize: 24,
      lineHeight: 26,
      fontWeight: '900',
      letterSpacing: 1,
      color: RED,
    },
    noRow: {
      flexDirection: 'row',
      alignItems: 'baseline',
      justifyContent: 'space-between',
    },
    sealMsg: {
      fontSize: 12,
      lineHeight: 18,
      fontWeight: '600',
      color: SUB,
      marginTop: 8,
    },
    sealBottom: {
      marginTop: 12,
      minHeight: 54,
      justifyContent: 'flex-end',
    },
    stampWrap: {
      height: 56,
    },
    // CTA
    cta: {
      marginTop: 16,
      height: 53,
      borderRadius: 14,
      backgroundColor: MANILA,
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'row',
      gap: 8,
    },
    ctaDisabled: {
      backgroundColor: CTA_DISABLED_BG,
    },
    ctaText: {
      color: INK,
      fontSize: 15,
      lineHeight: 20,
      fontWeight: '800',
    },
    ctaTextDisabled: {
      color: CTA_DISABLED_TEXT,
    },
    ctaHint: {
      marginTop: 11,
      textAlign: 'center',
      color: NAV_SUB,
      fontSize: 11.5,
      lineHeight: 16,
      fontWeight: '600',
    },
    ctaHookPin: {
      color: MANILA,
    },
    // 보너스 컬렉션(오늘 연 카드)
    collect: {
      marginTop: 4,
      marginBottom: 4,
    },
    collectHead: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 10,
    },
    collectTitle: {
      color: HEAD_TEXT,
      fontSize: 13,
      lineHeight: 18,
      fontWeight: '800',
    },
    collectSub: {
      color: NAV_SUB,
      fontSize: 11.5,
      lineHeight: 16,
      fontWeight: '700',
    },
    thumbs: {
      flexDirection: 'row',
      gap: 9,
    },
    thumb: {
      flex: 1,
      height: 104,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: '#3A3122',
      backgroundColor: '#1C1710',
      overflow: 'hidden',
    },
    thumbImage: {
      ...StyleSheet.absoluteFillObject,
      width: undefined,
      height: undefined,
    },
    thumbDuotone: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: NAVY,
      opacity: 0.32,
    },
    thumbScrim: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      height: 50,
      backgroundColor: 'rgba(10,8,5,0.66)',
    },
    thumbCheck: {
      position: 'absolute',
      top: 6,
      right: 6,
      width: 18,
      height: 18,
      borderRadius: 9,
      backgroundColor: 'rgba(10,8,5,0.72)',
      borderWidth: 1,
      borderColor: 'rgba(168,51,31,0.7)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    thumbCheckText: {
      color: '#E9BFA6',
      fontSize: 10,
      lineHeight: 12,
      fontWeight: '800',
    },
    thumbCaption: {
      position: 'absolute',
      left: 8,
      right: 8,
      bottom: 7,
      color: '#F4ECDB',
      fontSize: 10,
      lineHeight: 12,
      fontWeight: '800',
      textShadowColor: 'rgba(0,0,0,0.7)',
      textShadowOffset: { width: 0, height: 1 },
      textShadowRadius: 5,
    },
  });
}

function SealedTag() {
  const styles = React.useMemo(() => createStyles(), []);
  const { no, ref } = React.useMemo(() => todayTicketNo(), []);

  return (
    <TagBody>
      <TagHeader printedTop="CULTURE CARD" printedBottom={`SEOUL · ${ref}`} />
      <Rule />
      <Text style={styles.lbl}>TODAY · 오늘</Text>
      <CondensedDisplay color={NAVY} size={48}>CULTURE</CondensedDisplay>
      <Text style={styles.destKo}>오늘의 문화</Text>
      <Rule variant="thin" />
      <View style={styles.noRow}>
        <Text style={styles.noLbl}>Ticket Nº</Text>
        <Text style={styles.noVal}>{no}</Text>
      </View>
      <Rule />
      <FieldRow label="ISSUED · 발행" value="컬처카드 · SEOUL" />
      <Text style={styles.sealMsg}>
        광고를 보면 오늘의 카드가 열려요.{'\n'}가까운 전시·공연 한 장이 담겨 있어요.
      </Text>
      <View style={styles.sealBottom}>
        <View style={styles.stampWrap}>
          <RubberStamp right={16} bottom={4} topText="오늘" bottomText={todayStampText()} />
        </View>
        <Rule variant="dash" />
        <FinePrint>Valid today only · Non-transferable · 컬처카드</FinePrint>
      </View>
    </TagBody>
  );
}

function BonusTag({ openedCards }: { openedCards: Card[] }) {
  const styles = React.useMemo(() => createStyles(), []);
  const { ref } = React.useMemo(() => todayTicketNo(), []);

  return (
    <TagBody>
      <TagHeader printedTop="BONUS DRAW" printedBottom={`SEOUL · ${ref}`} />
      <Rule />
      <Text style={styles.lbl}>BONUS · 보너스</Text>
      <CondensedDisplay color={NAVY} size={48}>ENCORE</CondensedDisplay>
      <Text style={styles.destKo}>오늘의 3장 완료</Text>
      <Rule variant="thin" />
      <View style={styles.collect}>
        <View style={styles.collectHead}>
          <Text style={styles.collectTitle}>오늘 연 문화</Text>
        </View>
        <View style={styles.thumbs}>
          {openedCards.slice(0, 3).map((opened) => (
            <View key={opened.eventId} style={styles.thumb}>
              {opened.imageUrl ? (
                <Image source={{ uri: opened.imageUrl }} style={styles.thumbImage} resizeMode="cover" />
              ) : null}
              <View style={styles.thumbDuotone} />
              <View style={styles.thumbScrim} />
              <View style={styles.thumbCheck}>
                <Text style={styles.thumbCheckText}>✓</Text>
              </View>
              <Text style={styles.thumbCaption} numberOfLines={2}>{opened.title}</Text>
            </View>
          ))}
        </View>
      </View>
      <Rule />
      <Text style={styles.sealMsg}>
        광고를 한 번 더 보면 보너스 카드가 열려요.{'\n'}오늘 담을 문화 한 장이 더 남아 있어요.
      </Text>
      <View style={styles.sealBottom}>
        <View style={styles.stampWrap}>
          <RubberStamp right={16} bottom={4} topText="BONUS" bottomText="+1" />
        </View>
        <Rule variant="dash" />
        <FinePrint>Bonus draw · Today only · 컬처카드</FinePrint>
      </View>
    </TagBody>
  );
}

export function CultureCardStack({
  activeCard,
  progress,
  dailyEarned,
  dailyLimit,
  loading,
  disabled,
  actionLabel,
  onOpen,
  bonusMode,
  openedCards,
  userRegion,
}: CultureCardStackProps) {
  const styles = React.useMemo(() => createStyles(), []);
  const openedCount = bonusMode ? 3 : progress.opened;
  const locationHook = buildLocationHook(activeCard);

  return (
    <View style={styles.section}>
      <View style={styles.top}>
        <View>
          <Text style={styles.eyebrow}>{"TODAY'S CULTURE"}</Text>
          <Text style={styles.title}>오늘의 문화 카드</Text>
        </View>
        <View style={styles.prog}>
          <Text style={styles.progText}>오늘 {openedCount} / 3</Text>
          <View style={styles.segs}>
            {[0, 1, 2].map((index) => (
              <View key={index} style={[styles.seg, index < openedCount && styles.segOn]} />
            ))}
          </View>
        </View>
      </View>

      {userRegion ? (
        <View style={styles.locPill}>
          <Text style={styles.locPin}>◉</Text>
          <Text style={styles.locText}>내 위치 · {userRegion}</Text>
        </View>
      ) : null}

      <View style={styles.tagArea}>
        {bonusMode ? (
          <BonusTag openedCards={openedCards} />
        ) : (
          <SealedTag />
        )}
      </View>

      <Pressable
        style={[styles.cta, disabled && styles.ctaDisabled]}
        onPress={onOpen}
        disabled={disabled}
      >
        <Icon name="icon-play-mono" size={16} color={disabled ? CTA_DISABLED_TEXT : INK} />
        <Text style={[styles.ctaText, disabled && styles.ctaTextDisabled]}>
          {loading ? '광고 준비 중' : actionLabel}
        </Text>
      </Pressable>

      <Text style={styles.ctaHint}>
        {bonusMode ? '오늘 3장을 다 열었어요 · 내일이면 티켓 한도가 초기화돼요' : '하루 3장 · 다 보면 보너스 카드가 열려요'}
      </Text>
      {!bonusMode && locationHook ? (
        <Text style={styles.ctaHint}>
          <Text style={styles.ctaHookPin}>◉</Text> {locationHook}
        </Text>
      ) : (
        <Text style={styles.ctaHint}>{dailyEarned} / {dailyLimit} 티켓</Text>
      )}
    </View>
  );
}
