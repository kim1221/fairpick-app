/**
 * 출석 상세 바텀시트
 * - 이번 주 방문 미션 현황
 * - 월화수목금토일 7칸 캘린더
 * - 이번 주 광고 적립 티켓 / 완주 시 예상 보너스
 * - CTA: 완주 가능 여부에 따라 4가지 상태
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { BottomSheet, Button } from '@toss/tds-react-native';
import { useAdaptive } from '@toss/tds-react-native/private';
import type { AttendanceStatus } from '../services/attendanceService';

const DAY_LABELS = ['월', '화', '수', '목', '금', '토', '일'];

interface Props {
  open: boolean;
  onClose: () => void;
  status: AttendanceStatus | null;
}

export function AttendanceBottomSheet({ open, onClose, status }: Props) {
  const a = useAdaptive();
  const styles = createStyles(a);

  // CTA 상태 판정
  function getCtaLabel(): string {
    if (!status) return '';
    const { weeklyBonusGranted, canCompleteWeek, todayCheckedIn, daysRemaining } = status;
    if (weeklyBonusGranted) return '이번 주 완주! 🎉';
    if (!canCompleteWeek) return '이번 주 완주 보너스는 어려워요';
    if (todayCheckedIn) return '오늘 출석 완료 ✓';
    return `${daysRemaining}일 남았어요`;
  }

  const ctaLabel = getCtaLabel();
  const ctaDisabled = !status || status.weeklyBonusGranted || !status.canCompleteWeek || status.todayCheckedIn;

  return (
    <BottomSheet.Root open={open} onClose={onClose} onDimmerClick={onClose}>
      <BottomSheet.Header>이번 주 방문 미션</BottomSheet.Header>
      <View style={styles.content}>

        {/* 7칸 캘린더 */}
        <View style={styles.calendar}>
          {status?.weekDates.map((date, i) => {
            const done = status.attendedDates.includes(date);
            const isLast = i === 6;
            const day = date.slice(8); // 'DD'

            return (
              <View key={date} style={styles.calendarCell}>
                <Text style={styles.dayLabel}>{DAY_LABELS[i]}</Text>
                <View style={[
                  styles.dayCircle,
                  done ? styles.dayDone : isLast ? styles.dayGoal : styles.dayEmpty,
                ]}>
                  {done
                    ? <Text style={styles.checkMark}>✓</Text>
                    : isLast
                      ? <Text style={styles.starMark}>★</Text>
                      : <Text style={styles.dayNumber}>{day}</Text>
                  }
                </View>
              </View>
            );
          })}
        </View>

        {/* 설명 */}
        <View style={styles.descBlock}>
          <Text style={styles.descLine}>매일 출석하면 티켓 1장을 받아요</Text>
          <Text style={styles.descLine}>
            일주일 모두 출석하면 이번 주 광고로 모은 티켓의 10%를 추가로 받아요
          </Text>
        </View>

        {/* 현황 */}
        <View style={styles.statsBlock}>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>이번 주 광고 적립 티켓</Text>
            <Text style={styles.statValue}>{status?.adTickets ?? 0}장</Text>
          </View>
          <View style={styles.statRow}>
            <Text style={styles.statLabel}>완주 시 예상 보너스</Text>
            <Text style={[styles.statValue, styles.statBonus]}>
              {status?.expectedBonus ?? 0}장
            </Text>
          </View>
        </View>

        {/* CTA */}
        <Button
          type="primary"
          size="big"
          viewStyle={{ width: '100%' }}
          disabled={ctaDisabled}
          onPress={onClose}
        >
          {ctaLabel}
        </Button>

        {/* 유의사항 */}
        <View style={styles.notes}>
          <Text style={styles.noteText}>· 이번 주를 모두 채우지 못하면 완주 보너스는 지급되지 않아요</Text>
          <Text style={styles.noteText}>· 보너스는 해당 주 광고 적립 티켓의 10%이며, 최대 10장까지 지급돼요</Text>
        </View>

      </View>
    </BottomSheet.Root>
  );
}

function createStyles(a: ReturnType<typeof useAdaptive>) {
  return StyleSheet.create({
    content: {
      paddingHorizontal: 20,
      paddingBottom: 32,
      gap: 20,
    },
    calendar: {
      flexDirection: 'row',
      justifyContent: 'space-between',
    },
    calendarCell: {
      alignItems: 'center',
      gap: 6,
    },
    dayLabel: {
      fontSize: 11,
      color: a.grey500,
      fontWeight: '500',
    },
    dayCircle: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
    },
    dayDone: {
      backgroundColor: a.blue500,
    },
    dayEmpty: {
      backgroundColor: a.grey100,
    },
    dayGoal: {
      backgroundColor: '#FFF3CD',
      borderWidth: 1.5,
      borderColor: '#F5A623',
    },
    checkMark: {
      fontSize: 16,
      color: '#fff',
      fontWeight: '700',
    },
    starMark: {
      fontSize: 16,
      color: '#F5A623',
    },
    dayNumber: {
      fontSize: 13,
      color: a.grey700,
      fontWeight: '500',
    },
    descBlock: {
      gap: 4,
    },
    descLine: {
      fontSize: 14,
      color: a.grey800,
      lineHeight: 20,
    },
    statsBlock: {
      backgroundColor: a.grey100,
      borderRadius: 10,
      paddingHorizontal: 16,
      paddingVertical: 12,
      gap: 8,
    },
    statRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    statLabel: {
      fontSize: 13,
      color: a.grey600,
    },
    statValue: {
      fontSize: 14,
      fontWeight: '700',
      color: a.grey900,
    },
    statBonus: {
      color: a.blue500,
    },
    notes: {
      gap: 4,
    },
    noteText: {
      fontSize: 11,
      color: a.grey400,
      lineHeight: 16,
    },
  });
}
