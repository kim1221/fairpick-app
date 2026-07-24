/**
 * 홈 연속뽑기 히어로 (draw-loop-v1 시안 ①·②).
 * 슬롯 탭 3개(카테고리 2 + ? 미스터리 1) → 선택한 슬롯을 빈티지 수하물 태그로 크게 보여준다.
 * 카테고리 슬롯 = 마닐라 태그, 미스터리 슬롯 = 네이비 태그(행선지 미정).
 * 태그 시각 요소는 tagKit 프리미티브(TagBody·CondensedDisplay·BoxStamp·FinePrint)로 그린다.
 */
import React from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import type { LockedCardPreview } from '../../services/cardsService';
import { romanizeRegion } from '../../utils/regionRomanize';
import { distanceRowLabel } from './distanceLabel';
import {
  getLockedCardChoice,
  getSlotTabContent,
  getSlotType,
  sortLockedCardsForTabs,
} from './homeLogic';
import { BoxStamp, CondensedDisplay, FinePrint, TAG_TOKENS, TagBody } from './tagKit';
import { getTicketSerial } from './ticketSkins';

const MONO_FAMILY = Platform.select({ ios: 'Courier', android: 'monospace', default: 'monospace' });

// 시안 ①·② 태그 위 색
const MANILA_EYEBROW = '#8A7A56';
const MANILA_SUB = '#5A4F3B';
const MANILA_RULE = '#C9B98F';
const MANILA_KEY = '#8A7A56';
const MANILA_VALUE = '#3E3628';
const MANILA_SERIAL = '#6B5F49';
// 태그 밖 크롬
const CTA_BG = '#E9DBB8';
const CTA_TEXT = '#2A2415';
const CAP_SUB = '#8B8071';
const CAP_STRONG = '#D9CBA8';
const TAB_OUTLINE = '#EFE3C4';

interface CultureCardStackProps {
  cards: LockedCardPreview[];
  selectedCardKey: string | null;
  loading: boolean;
  disabled: boolean;
  actionLabel: string;
  onSelectCard: (cardKey: string) => void;
  onOpen: () => void;
  userRegion: string | null;
  /** 오늘 몇 번째 카드를 열게 되는지(dailyOpenCount + 1). 미로그인/미로드 시 null */
  nextCardNumber: number | null;
}

function getCardKey(card: LockedCardPreview): string {
  return card.visualSeed ?? card.cardToken;
}

function formatSerialLine(userRegion: string | null): string {
  const nowKst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const month = String(nowKst.getUTCMonth() + 1).padStart(2, '0');
  const day = String(nowKst.getUTCDate()).padStart(2, '0');
  const year = String(nowKst.getUTCFullYear()).slice(-2);
  return `${romanizeRegion(userRegion)} · No.${month}${day}.${year}`;
}

/** 시안의 rule-row: 상단 잉크 선 + 모노 라벨 + 볼드 값. tone에 따라 잉크색이 바뀐다. */
function RuleRow({
  label,
  value,
  tone,
  last = false,
  strongValue = false,
}: {
  label: string;
  value: string;
  tone: 'manila' | 'navy';
  last?: boolean;
  strongValue?: boolean;
}) {
  const navy = tone === 'navy';
  return (
    <View
      style={[
        styles.ruleRow,
        navy ? styles.ruleRowNavy : null,
        last ? (navy ? styles.ruleRowLastNavy : styles.ruleRowLast) : null,
      ]}
    >
      <Text style={[styles.ruleKey, navy ? styles.ruleKeyNavy : null]}>{label}</Text>
      <Text
        style={[
          styles.ruleValue,
          navy ? styles.ruleValueNavy : null,
          strongValue ? styles.ruleValueStrong : null,
        ]}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  );
}

/** 카테고리(마닐라) 히어로 태그 내용 */
function CategoryHero({
  card,
  userRegion,
  isCompactHeight,
}: {
  card: LockedCardPreview | null;
  userRegion: string | null;
  isCompactHeight: boolean;
}) {
  const category = card?.category?.trim() || '문화';
  const destination = romanizeRegion(card?.areaLabel ?? userRegion);
  const serial = card ? getTicketSerial(getCardKey(card)) : null;
  const rows: Array<{ label: string; value: string }> = [
    { label: 'TO', value: card?.areaLabel ?? userRegion ?? '내 주변' },
    { label: 'DATE', value: '오늘 열람' },
  ];
  if (card?.distanceLabel) {
    rows.push({ label: distanceRowLabel(card.distanceLabel), value: card.distanceLabel });
  } else if (card?.timingLabel) {
    rows.push({ label: 'NOTE', value: card.timingLabel });
  }
  rows.push({ label: 'TICKET', value: serial ? `Nº ${serial.slice(-3)}` : 'Nº ···' });

  return (
    <>
      <Text style={styles.eyebrow}>TICKET TO CULTURE</Text>
      <CondensedDisplay
        color={TAG_TOKENS.navy}
        size={isCompactHeight ? 46 : 54}
        style={styles.bigCentered}
      >
        {destination}
      </CondensedDisplay>
      <Text style={styles.bigSub}>오늘의 {category} 한 장이 봉인돼 있어요</Text>
      <View style={styles.ruleBlock}>
        {rows.map((row, index) => (
          <RuleRow
            key={row.label}
            label={row.label}
            value={row.value}
            tone="manila"
            last={index === rows.length - 1}
          />
        ))}
      </View>
      <BoxStamp text="TODAY ONLY" style={styles.todayOnlyStamp} />
      <View style={styles.pushBottom}>
        <FinePrint>
          {'VALID TODAY ONLY · 열면 컬렉션에 영구 보관돼요\n광고 1회 시청 = 티켓 1장 적립'}
        </FinePrint>
        <Text style={styles.serialLine}>{formatSerialLine(userRegion)}</Text>
      </View>
    </>
  );
}

/** 미스터리(네이비) 히어로 태그 내용 — 시안 ② */
function MysteryHero({
  userRegion,
  isCompactHeight,
}: {
  userRegion: string | null;
  isCompactHeight: boolean;
}) {
  return (
    <>
      <Text style={[styles.eyebrow, styles.eyebrowNavy]}>DESTINATION UNKNOWN</Text>
      <Text
        allowFontScaling={false}
        style={[styles.mysteryMark, isCompactHeight ? styles.mysteryMarkCompact : null]}
      >
        ?
      </Text>
      <Text style={[styles.bigSub, styles.bigSubNavy]}>행선지 미정 — 어디로든 갈 수 있어요</Text>
      <View style={styles.ruleBlock}>
        <RuleRow label="TO" value="? ? ?" tone="navy" />
        <RuleRow label="CATEGORY" value="? ? ?" tone="navy" />
        <RuleRow label="BONUS" value="컬렉션 조각 확률 ↑" tone="navy" last strongValue />
      </View>
      <View style={styles.pushBottom}>
        <Text style={styles.fineprintNavy}>
          {'이 카드에선 진행 중인 테마 컬렉션 조각이\n더 자주 나와요 · 가끔 히든 카드가 실려 있어요'}
        </Text>
        <Text style={[styles.serialLine, styles.serialLineNavy]}>{formatSerialLine(userRegion)}</Text>
      </View>
    </>
  );
}

export function CultureCardStack({
  cards,
  selectedCardKey,
  loading,
  disabled,
  actionLabel,
  onSelectCard,
  onOpen,
  userRegion,
  nextCardNumber,
}: CultureCardStackProps) {
  const { width, height } = useWindowDimensions();
  const isCompactHeight = height <= 700;
  const heroWidth = Math.min(width - 44, 380);

  const tabCards = sortLockedCardsForTabs(cards);
  const card = tabCards.find((candidate) => getCardKey(candidate) === selectedCardKey)
    ?? tabCards[0]
    ?? null;
  const activeKey = card ? getCardKey(card) : null;
  const isMystery = card ? getSlotType(card) === 'mystery' : false;

  return (
    <View style={styles.section}>
      {tabCards.length > 1 ? (
        <View style={styles.tabRow}>
          {tabCards.map((candidate, index) => {
            const candidateKey = getCardKey(candidate);
            const selected = candidateKey === activeKey;
            const tab = getSlotTabContent(candidate);
            const choice = getLockedCardChoice(candidate, index);
            return (
              <Pressable
                key={candidateKey}
                accessibilityRole="button"
                accessibilityLabel={`${choice.label}, ${choice.description}`}
                accessibilityHint="선택하면 봉인된 태그가 바뀌어요"
                accessibilityState={{ selected, disabled }}
                disabled={disabled}
                onPress={() => onSelectCard(candidateKey)}
                style={[styles.tabOutline, selected ? styles.tabOutlineSelected : null]}
              >
                <View
                  style={[
                    styles.tab,
                    tab.mystery ? styles.tabMystery : null,
                    selected ? null : styles.tabDim,
                  ]}
                >
                  {/* 좌상단 태그 컷(시안 clip-path 근사: 앱 배경색 삼각형) */}
                  <View style={styles.tabCut} pointerEvents="none" />
                  <View
                    style={[styles.tabGrommet, tab.mystery ? styles.tabGrommetMystery : null]}
                    pointerEvents="none"
                  />
                  <Text
                    allowFontScaling={false}
                    numberOfLines={1}
                    style={[styles.tabTitle, tab.mystery ? styles.tabTitleMystery : null]}
                  >
                    {tab.title}
                  </Text>
                  <Text
                    numberOfLines={1}
                    style={[styles.tabSub, tab.mystery ? styles.tabSubMystery : null]}
                  >
                    {tab.subtitle}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      <TagBody
        tone={isMystery ? 'navy' : 'manila'}
        style={StyleSheet.flatten([
          styles.hero,
          { width: heroWidth },
          isCompactHeight ? styles.heroCompact : null,
        ])}
      >
        <View
          accessibilityLiveRegion="polite"
          style={[styles.heroInner, isCompactHeight ? styles.heroInnerCompact : null]}
        >
          {isMystery ? (
            <MysteryHero userRegion={userRegion} isCompactHeight={isCompactHeight} />
          ) : (
            <CategoryHero card={card} userRegion={userRegion} isCompactHeight={isCompactHeight} />
          )}
        </View>
      </TagBody>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="광고를 보고 선택한 컬처카드 공개하기"
        accessibilityHint="광고를 끝까지 보면 카드가 공개되고 티켓 1장이 적립돼요"
        accessibilityState={{ disabled, busy: loading }}
        onPress={onOpen}
        disabled={disabled}
        style={({ pressed }) => [
          styles.cta,
          { width: heroWidth },
          disabled ? styles.ctaDisabled : null,
          pressed && !disabled ? styles.ctaPressed : null,
        ]}
      >
        <Text style={[styles.ctaText, disabled ? styles.ctaTextDisabled : null]}>
          {loading ? '광고 준비 중' : actionLabel}
        </Text>
      </Pressable>
      {nextCardNumber != null ? (
        <Text style={styles.ctaCaption}>
          오늘 <Text style={styles.ctaCaptionStrong}>{nextCardNumber}번째</Text> 카드
          {' · '}
          <Text style={styles.ctaCaptionStrong}>+1 티켓</Text>
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    paddingTop: 8,
    paddingBottom: 4,
  },
  // ── 슬롯 탭 ──────────────────────────────────────────────
  tabRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 22,
    marginBottom: 14,
  },
  tabOutline: {
    flex: 1,
    borderWidth: 2,
    borderColor: 'transparent',
    borderRadius: 9,
    padding: 2,
  },
  tabOutlineSelected: {
    borderColor: TAB_OUTLINE,
  },
  tab: {
    borderRadius: 6,
    backgroundColor: CTA_BG,
    paddingTop: 9,
    paddingBottom: 8,
    paddingHorizontal: 8,
    overflow: 'hidden',
  },
  tabDim: {
    opacity: 0.55,
  },
  tabMystery: {
    backgroundColor: TAG_TOKENS.navy,
  },
  tabCut: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 0,
    height: 0,
    borderTopWidth: 6,
    borderRightWidth: 10,
    borderTopColor: TAG_TOKENS.bg,
    borderRightColor: 'transparent',
  },
  tabGrommet: {
    position: 'absolute',
    top: 5,
    right: 6,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: TAG_TOKENS.bg,
    borderWidth: 1.5,
    borderColor: '#B9A87E',
  },
  tabGrommetMystery: {
    borderColor: TAG_TOKENS.navyGrommet,
  },
  tabTitle: {
    color: TAG_TOKENS.navy,
    fontSize: 15,
    lineHeight: 19,
    fontWeight: '900',
    letterSpacing: 0.3,
  },
  tabTitleMystery: {
    color: TAG_TOKENS.navyCream,
  },
  tabSub: {
    marginTop: 2,
    color: MANILA_SERIAL,
    fontSize: 9,
    lineHeight: 12,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  tabSubMystery: {
    color: '#9AA5C6',
  },
  // ── 히어로 태그 ───────────────────────────────────────────
  hero: {
    alignSelf: 'center',
  },
  heroCompact: {},
  heroInner: {
    minHeight: 396,
  },
  heroInnerCompact: {
    minHeight: 340,
  },
  eyebrow: {
    fontFamily: MONO_FAMILY,
    fontSize: 10,
    letterSpacing: 2,
    color: MANILA_EYEBROW,
    textAlign: 'center',
    marginTop: 8,
  },
  eyebrowNavy: {
    color: TAG_TOKENS.navySub,
  },
  bigCentered: {
    textAlign: 'center',
    marginTop: 10,
    letterSpacing: -1,
    transform: [{ scaleX: 0.88 }],
  },
  bigSub: {
    textAlign: 'center',
    fontSize: 13.5,
    lineHeight: 19,
    color: MANILA_SUB,
    fontWeight: '600',
    marginTop: 4,
    marginBottom: 14,
  },
  bigSubNavy: {
    color: '#C4CBE2',
  },
  mysteryMark: {
    textAlign: 'center',
    color: TAG_TOKENS.navyCream,
    fontSize: 88,
    lineHeight: 96,
    fontWeight: '900',
    marginTop: 12,
  },
  mysteryMarkCompact: {
    fontSize: 68,
    lineHeight: 74,
    marginTop: 8,
  },
  ruleBlock: {},
  ruleRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: MANILA_RULE,
    paddingTop: 7,
    paddingBottom: 6,
    paddingHorizontal: 2,
  },
  ruleRowNavy: {
    borderTopColor: TAG_TOKENS.navyLine,
  },
  ruleRowLast: {
    borderBottomWidth: 1,
    borderBottomColor: MANILA_RULE,
  },
  ruleRowLastNavy: {
    borderBottomWidth: 1,
    borderBottomColor: TAG_TOKENS.navyLine,
  },
  ruleKey: {
    fontFamily: MONO_FAMILY,
    fontSize: 10,
    letterSpacing: 1.5,
    color: MANILA_KEY,
  },
  ruleKeyNavy: {
    color: '#7C88B2',
  },
  ruleValue: {
    flexShrink: 1,
    marginLeft: 12,
    fontSize: 11.5,
    fontWeight: '700',
    color: MANILA_VALUE,
    textAlign: 'right',
  },
  ruleValueNavy: {
    color: TAG_TOKENS.navyValue,
  },
  ruleValueStrong: {
    color: TAG_TOKENS.navyCream,
    fontWeight: '800',
  },
  todayOnlyStamp: {
    position: 'absolute',
    right: 6,
    bottom: 84,
  },
  pushBottom: {
    marginTop: 'auto',
  },
  fineprintNavy: {
    fontFamily: MONO_FAMILY,
    fontSize: 8.5,
    lineHeight: 13,
    letterSpacing: 0.6,
    color: TAG_TOKENS.navyFine,
    textAlign: 'center',
    marginTop: 10,
  },
  serialLine: {
    fontFamily: MONO_FAMILY,
    fontSize: 10,
    letterSpacing: 2,
    color: MANILA_SERIAL,
    textAlign: 'center',
    marginTop: 5,
  },
  serialLineNavy: {
    color: TAG_TOKENS.navySub,
  },
  // ── CTA ─────────────────────────────────────────────────
  cta: {
    alignSelf: 'center',
    marginTop: 14,
    borderRadius: 10,
    paddingVertical: 16,
    backgroundColor: CTA_BG,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaDisabled: {
    backgroundColor: TAG_TOKENS.ctaDisabledBg,
  },
  ctaPressed: {
    opacity: 0.86,
  },
  ctaText: {
    color: CTA_TEXT,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '800',
  },
  ctaTextDisabled: {
    color: TAG_TOKENS.ctaDisabledText,
  },
  ctaCaption: {
    marginTop: 9,
    textAlign: 'center',
    color: CAP_SUB,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '600',
  },
  ctaCaptionStrong: {
    color: CAP_STRONG,
    fontWeight: '800',
  },
});
