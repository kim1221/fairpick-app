import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from '@toss/tds-react-native';
import type { Card } from '../../services/cardsService';
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
  ringLine: RING_LINE,
  ctaDisabledBg: CTA_DISABLED_BG,
  ctaDisabledText: CTA_DISABLED_TEXT,
} = TAG_TOKENS;

interface CultureCardStackProps {
  cards: Card[];
  activeCard: Card | null;
  dailyEarned: number;
  dailyLimit: number;
  loading: boolean;
  disabled: boolean;
  actionLabel: string;
  onOpen: () => void;
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
  // "내 위치"는 헤더 근처 칩(userRegion)이 담당 → 여기선 헷갈리던 "○○ 근처" 대신 실거리만.
  const walk = typeof card?.walkMinutes === 'number' && card.walkMinutes > 0 ? card.walkMinutes : null;
  if (!walk) return null;
  return `도보 ${walk}분 거리에 오늘의 문화가 있어요`;
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
    reasonRow: {
      marginTop: 9,
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
    },
    reasonPill: {
      borderRadius: 999,
      borderWidth: 1,
      borderColor: 'rgba(203,161,94,0.28)',
      backgroundColor: 'rgba(203,161,94,0.08)',
      paddingHorizontal: 9,
      paddingVertical: 4,
    },
    reasonText: {
      color: MANILA,
      fontSize: 10.5,
      lineHeight: 14,
      fontWeight: '800',
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
        광고를 보면 오늘의 카드가 열려요.{'\n'}가까운 문화 한 장이 담겨 있어요.
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

export function CultureCardStack({
  dailyEarned,
  dailyLimit,
  loading,
  disabled,
  actionLabel,
  onOpen,
  activeCard,
  userRegion,
}: CultureCardStackProps) {
  const styles = React.useMemo(() => createStyles(), []);
  const locationHook = buildLocationHook(activeCard);

  return (
    <View style={styles.section}>
      <View style={styles.top}>
        <View>
          <Text style={styles.eyebrow}>{"TODAY'S CULTURE"}</Text>
          <Text style={styles.title}>오늘의 문화 카드</Text>
        </View>
      </View>

      {userRegion ? (
        <View style={styles.locPill}>
          <Text style={styles.locPin}>◉</Text>
          <Text style={styles.locText}>내 위치 · {userRegion}</Text>
        </View>
      ) : null}

      {(activeCard?.reasonTags ?? []).length > 0 ? (
        <View style={styles.reasonRow}>
          {(activeCard?.reasonTags ?? []).map((reason) => (
            <View key={reason} style={styles.reasonPill}>
              <Text style={styles.reasonText}>{reason}</Text>
            </View>
          ))}
        </View>
      ) : null}

      <View style={styles.tagArea}>
        <SealedTag />
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
        광고 1번 = 카드 1장 · 티켓 적립
      </Text>
      {locationHook ? (
        <Text style={styles.ctaHint}>
          <Text style={styles.ctaHookPin}>◉</Text> {locationHook}
        </Text>
      ) : (
        <Text style={styles.ctaHint}>{dailyEarned} / {dailyLimit} 티켓</Text>
      )}
    </View>
  );
}
