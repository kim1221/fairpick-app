/**
 * 출석 위젯 (홈탭 소형)
 * - 이번 주 7칸 도트 + 출석 상태 한 줄
 * - 탭하면 AttendanceBottomSheet 열림
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useAdaptive } from '@toss/tds-react-native/private';
import type { AttendanceStatus } from '../services/attendanceService';

interface Props {
  status: AttendanceStatus | null;
  onPress: () => void;
}

export function AttendanceWidget({ status, onPress }: Props) {
  const a = useAdaptive();
  const styles = createStyles(a);

  if (!status) return null;

  const { weekDates, attendedDates, attendedCount, todayCheckedIn, weeklyBonusGranted } = status;

  // 상태 문구
  let statusText: string;
  if (weeklyBonusGranted) {
    statusText = '이번 주 완주! 🎉';
  } else if (todayCheckedIn) {
    statusText = '오늘 출석 완료 ✓';
  } else {
    statusText = `이번 주 ${attendedCount}일 출석`;
  }

  return (
    <Pressable style={styles.container} onPress={onPress}>
      <View style={styles.dots}>
        {weekDates.map((date, i) => {
          const done = attendedDates.includes(date);
          const isLast = i === 6;
          return (
            <View
              key={date}
              style={[
                styles.dot,
                done ? styles.dotDone : isLast ? styles.dotGoal : styles.dotEmpty,
              ]}
            />
          );
        })}
      </View>
      <Text style={styles.statusText}>{statusText}</Text>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

function createStyles(a: ReturnType<typeof useAdaptive>) {
  return StyleSheet.create({
    container: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: a.background,
      borderBottomWidth: 1,
      borderBottomColor: a.grey200,
      paddingHorizontal: 16,
      paddingVertical: 9,
      gap: 8,
    },
    dots: {
      flexDirection: 'row',
      gap: 5,
    },
    dot: {
      width: 10,
      height: 10,
      borderRadius: 5,
    },
    dotDone: {
      backgroundColor: a.blue500,
    },
    dotEmpty: {
      backgroundColor: a.grey200,
    },
    dotGoal: {
      backgroundColor: a.grey300,
      borderWidth: 1.5,
      borderColor: a.grey400,
    },
    statusText: {
      flex: 1,
      fontSize: 12,
      color: a.grey600,
    },
    chevron: {
      fontSize: 16,
      color: a.grey400,
    },
  });
}
