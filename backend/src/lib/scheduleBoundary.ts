/** 가장 최근에 도래한 일일 스케줄 경계를 UTC epoch milliseconds로 반환한다. */
export function latestDailyScheduleBoundaryMs(
  nowMs: number,
  scheduledHour: number,
  scheduledMinute: number,
  utcOffsetHours = 9,
): number {
  const shifted = new Date(nowMs + utcOffsetHours * 3_600_000);
  const localBoundaryAsUtc = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate(),
    scheduledHour,
    scheduledMinute,
  );
  const todayBoundary = localBoundaryAsUtc - utcOffsetHours * 3_600_000;
  return todayBoundary <= nowMs ? todayBoundary : todayBoundary - 24 * 3_600_000;
}
