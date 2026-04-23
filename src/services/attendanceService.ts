import http from '../lib/http';

export interface CheckinResult {
  alreadyCheckedIn: boolean;
  dailyTicketGranted: number;
  ticketCount: number;
  weeklyBonus?: {
    bonusTickets: number;
    adTickets: number;
    capped: boolean;
  };
}

export interface AttendanceStatus {
  todayCheckedIn: boolean;
  weekStart: string;           // YYYY-MM-DD (월요일)
  weekDates: string[];         // [월, 화, ..., 일] 7개
  attendedDates: string[];     // 이번 주 출석한 날짜들
  attendedCount: number;       // 0~7
  adTickets: number;           // 이번 주 광고 적립 티켓
  expectedBonus: number;       // floor(adTickets * 0.1), max 10
  weeklyBonusGranted: boolean;
  canCompleteWeek: boolean;    // 오늘 이전 빠진 날 없으면 true
  daysRemaining: number;       // 7 - attendedCount
}

/** KST 기준 오늘 날짜 (YYYY-MM-DD) — 체크인 중복 방지용 */
export function getKstToday(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

export async function checkin(): Promise<CheckinResult> {
  const { data } = await http.post<CheckinResult>('/api/attendance/checkin');
  return data;
}

export async function getAttendanceStatus(): Promise<AttendanceStatus> {
  const { data } = await http.get<AttendanceStatus>('/api/attendance/status');
  return data;
}
