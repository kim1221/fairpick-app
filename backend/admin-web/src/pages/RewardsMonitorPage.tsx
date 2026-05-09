import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getRewardsStats } from '../services/rewardsApi';
import type { AdTelemetryDailyStat, DailyStat, HeavyUser, ViewDistribution } from '../services/rewardsApi';

const PERIOD_OPTIONS = [
  { label: '7일', value: 7 },
  { label: '14일', value: 14 },
  { label: '30일', value: 30 },
];

function KpiCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="card">
      <div className="text-sm font-medium text-gray-500 mb-1">{label}</div>
      <div className="text-3xl font-bold text-gray-900">{value}</div>
      {sub && <div className="text-xs text-gray-400 mt-1">{sub}</div>}
    </div>
  );
}

function DailyTable({ rows }: { rows: DailyStat[] }) {
  if (rows.length === 0) {
    return <div className="text-sm text-gray-400 py-4 text-center">데이터 없음</div>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200">
            <th className="text-left py-2 px-3 font-medium text-gray-600">날짜</th>
            <th className="text-right py-2 px-3 font-medium text-gray-600">광고 시청</th>
            <th className="text-right py-2 px-3 font-medium text-gray-600">티켓 지급</th>
            <th className="text-right py-2 px-3 font-medium text-gray-600">활성 유저</th>
            <th className="text-right py-2 px-3 font-medium text-gray-600">교환</th>
            <th className="text-right py-2 px-3 font-medium text-gray-600">교환율</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const exchangeRate =
              r.activeUsers > 0
                ? ((r.exchangeCount / r.activeUsers) * 100).toFixed(1)
                : '—';
            return (
              <tr key={r.date} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="py-2 px-3 text-gray-700 font-medium">{r.date}</td>
                <td className="py-2 px-3 text-right tabular-nums">{r.adViews.toLocaleString()}</td>
                <td className="py-2 px-3 text-right tabular-nums">{r.ticketsGranted.toLocaleString()}</td>
                <td className="py-2 px-3 text-right tabular-nums">{r.activeUsers.toLocaleString()}</td>
                <td className="py-2 px-3 text-right tabular-nums">{r.exchangeCount.toLocaleString()}</td>
                <td className="py-2 px-3 text-right tabular-nums text-gray-500">{exchangeRate}%</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function AdTelemetryTable({ rows }: { rows: AdTelemetryDailyStat[] }) {
  if (rows.length === 0) {
    return <div className="text-sm text-gray-400 py-4 text-center">데이터 없음</div>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200">
            <th className="text-left py-2 px-3 font-medium text-gray-600">날짜</th>
            <th className="text-right py-2 px-3 font-medium text-gray-600">시도</th>
            <th className="text-right py-2 px-3 font-medium text-gray-600">show</th>
            <th className="text-right py-2 px-3 font-medium text-gray-600">impression</th>
            <th className="text-right py-2 px-3 font-medium text-gray-600">reward</th>
            <th className="text-right py-2 px-3 font-medium text-gray-600">티켓 연결</th>
            <th className="text-right py-2 px-3 font-medium text-gray-600">노출률</th>
            <th className="text-right py-2 px-3 font-medium text-gray-600">reward/impression</th>
            <th className="text-right py-2 px-3 font-medium text-gray-600">무노출 reward</th>
            <th className="text-right py-2 px-3 font-medium text-gray-600">실패</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.date} className="border-b border-gray-100 hover:bg-gray-50">
              <td className="py-2 px-3 text-gray-700 font-medium">{r.date}</td>
              <td className="py-2 px-3 text-right tabular-nums">{r.attempts.toLocaleString()}</td>
              <td className="py-2 px-3 text-right tabular-nums">{r.shows.toLocaleString()}</td>
              <td className="py-2 px-3 text-right tabular-nums font-medium text-gray-900">
                {r.impressions.toLocaleString()}
              </td>
              <td className="py-2 px-3 text-right tabular-nums">{r.rewards.toLocaleString()}</td>
              <td className="py-2 px-3 text-right tabular-nums">{r.linkedTicketGrants.toLocaleString()}</td>
              <td className="py-2 px-3 text-right tabular-nums text-gray-600">{r.impressionRate}%</td>
              <td className="py-2 px-3 text-right tabular-nums text-gray-600">{r.rewardToImpressionRate}%</td>
              <td
                className={`py-2 px-3 text-right tabular-nums ${
                  r.rewardsWithoutImpression > 0 ? 'text-orange-600 font-medium' : 'text-gray-500'
                }`}
              >
                {r.rewardsWithoutImpression.toLocaleString()}
              </td>
              <td className="py-2 px-3 text-right tabular-nums text-gray-500">
                {(r.failedToShow + r.errors).toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DistributionBar({ dist, total }: { dist: ViewDistribution; total: number }) {
  const segments: { label: string; key: keyof ViewDistribution; color: string }[] = [
    { label: '1–5회', key: '1-5', color: 'bg-blue-200' },
    { label: '6–10회', key: '6-10', color: 'bg-blue-400' },
    { label: '11–20회', key: '11-20', color: 'bg-blue-600' },
    { label: '21–30회', key: '21-30', color: 'bg-blue-800' },
  ];
  return (
    <div className="space-y-3">
      {segments.map(({ label, key, color }) => {
        const count = dist[key];
        const pct = total > 0 ? Math.round((count / total) * 100) : 0;
        return (
          <div key={key}>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-gray-600">{label}</span>
              <span className="tabular-nums text-gray-800 font-medium">
                {count.toLocaleString()}명 ({pct}%)
              </span>
            </div>
            <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ${color} transition-all duration-500`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function HeavyUserTable({ users }: { users: HeavyUser[] }) {
  if (users.length === 0) {
    return <div className="text-sm text-gray-400 py-4 text-center">데이터 없음</div>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200">
            <th className="text-left py-2 px-3 font-medium text-gray-600">#</th>
            <th className="text-left py-2 px-3 font-medium text-gray-600">유저 ID</th>
            <th className="text-right py-2 px-3 font-medium text-gray-600">총 시청</th>
            <th className="text-right py-2 px-3 font-medium text-gray-600">일 평균</th>
            <th className="text-right py-2 px-3 font-medium text-gray-600">획득 티켓</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u, i) => (
            <tr key={u.userId} className="border-b border-gray-100 hover:bg-gray-50">
              <td className="py-2 px-3 text-gray-400 tabular-nums">{i + 1}</td>
              <td className="py-2 px-3 font-mono text-xs text-gray-600">{u.userId}</td>
              <td className="py-2 px-3 text-right tabular-nums font-medium">
                <span
                  className={
                    u.totalViews >= 20
                      ? 'text-red-600'
                      : u.totalViews >= 10
                        ? 'text-orange-500'
                        : 'text-gray-800'
                  }
                >
                  {u.totalViews}회
                </span>
              </td>
              <td className="py-2 px-3 text-right tabular-nums text-gray-600">{u.dailyAvg}/일</td>
              <td className="py-2 px-3 text-right tabular-nums text-gray-600">{u.totalTickets}장</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function RewardsMonitorPage() {
  const [days, setDays] = useState(14);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['rewards-stats', days],
    queryFn: () => getRewardsStats(days),
    staleTime: 5 * 60 * 1000,
  });

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold text-gray-900">리워드 광고 모니터</h2>
          <p className="text-gray-500 mt-1 text-sm">
            관측 모드 운영 대시보드 · eCPM은 광고 네트워크 대시보드에서 병행 확인
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex rounded-lg border border-gray-200 overflow-hidden">
            {PERIOD_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setDays(opt.value)}
                className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                  days === opt.value
                    ? 'bg-primary-600 text-white'
                    : 'bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => refetch()}
            className="px-3 py-1.5 text-sm font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            새로고침
          </button>
        </div>
      </div>

      {/* eCPM 안내 배너 */}
      <div className="flex items-start gap-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
        <span className="text-base">📡</span>
        <div>
          <strong>eCPM은 광고 네트워크 대시보드에서 확인하세요.</strong>
          <span className="ml-1 text-amber-700">
            Admob / AdFit → 날짜별 리워드 광고 eCPM · Fill Rate · 수익 조회 가능
          </span>
        </div>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center h-48">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600" />
        </div>
      )}

      {error && (
        <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          데이터 로드 실패. 잠시 후 새로고침해 주세요.
        </div>
      )}

      {data && (
        <>
          {/* KPI 요약 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KpiCard
              label="총 광고 시청"
              value={data.summary.totalAdViews.toLocaleString()}
              sub={`${days}일 합계`}
            />
            <KpiCard
              label="총 티켓 지급"
              value={data.summary.totalTickets.toLocaleString()}
              sub="광고 + 출석"
            />
            <KpiCard
              label="교환 건수"
              value={data.summary.totalExchanges.toLocaleString()}
              sub={`${days}일 합계`}
            />
            <KpiCard
              label="활성 유저"
              value={data.summary.totalActiveUsers.toLocaleString()}
              sub="광고 시청 1회 이상"
            />
          </div>

          {/* 유저 행동 지표 */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <KpiCard
              label="유저 평균 시청 수"
              value={`${data.summary.avgViewsPerUser}회`}
              sub="활성 유저 기준"
            />
            <KpiCard
              label="10회 이상 유저"
              value={`${data.summary.p10plus}%`}
              sub="헤비 유저 지표"
            />
            <KpiCard
              label="20회 이상 유저"
              value={`${data.summary.p20plus}%`}
              sub="eCPM 저하 주의 구간"
            />
          </div>

          {data.adTelemetry && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <KpiCard
                  label="SDK 광고 시도"
                  value={data.adTelemetry.summary.attempts.toLocaleString()}
                  sub={`${days}일 합계`}
                />
                <KpiCard
                  label="SDK impression"
                  value={data.adTelemetry.summary.impressions.toLocaleString()}
                  sub={`시도 대비 ${data.adTelemetry.summary.impressionRate}%`}
                />
                <KpiCard
                  label="SDK reward"
                  value={data.adTelemetry.summary.rewards.toLocaleString()}
                  sub={`impression 대비 ${data.adTelemetry.summary.rewardToImpressionRate}%`}
                />
                <KpiCard
                  label="무노출 reward"
                  value={data.adTelemetry.summary.rewardsWithoutImpression.toLocaleString()}
                  sub="0이 정상 목표"
                />
              </div>

              <div className="card">
                <h3 className="text-lg font-semibold text-gray-800 mb-2">SDK 이벤트 대조</h3>
                <p className="text-sm text-gray-500 mb-4">
                  앱인토스 대시보드의 노출 수는 이 표의 SDK impression과 날짜/OS/광고그룹 기준으로 비교하세요.
                </p>
                <AdTelemetryTable rows={data.adTelemetry.dailyStats} />
              </div>
            </>
          )}

          {/* 시청 횟수 구간 분포 */}
          <div className="card">
            <h3 className="text-lg font-semibold text-gray-800 mb-4">
              시청 횟수 구간 분포
              <span className="ml-2 text-sm font-normal text-gray-400">
                기간 내 유저당 총 시청 수 기준
              </span>
            </h3>
            <DistributionBar
              dist={data.viewDistribution}
              total={data.summary.totalActiveUsers}
            />
          </div>

          {/* 일자별 상세 */}
          <div className="card">
            <h3 className="text-lg font-semibold text-gray-800 mb-4">일자별 현황</h3>
            <DailyTable rows={data.dailyStats} />
          </div>

          {/* 헤비 유저 목록 */}
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-800">
                헤비 유저 목록
                <span className="ml-2 text-sm font-normal text-gray-400">
                  상위 30명 · 총 시청 수 내림차순
                </span>
              </h3>
              <div className="flex items-center gap-3 text-xs text-gray-500">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-orange-400 inline-block" />
                  10회+
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-red-500 inline-block" />
                  20회+
                </span>
              </div>
            </div>
            <HeavyUserTable users={data.heavyUsers} />
          </div>

          {/* limit 조정 판단 가이드 */}
          <div className="card border-l-4 border-blue-400">
            <h3 className="text-base font-semibold text-gray-800 mb-2">limit 조정 판단 기준</h3>
            <div className="space-y-1 text-sm text-gray-600">
              <p>
                <span className="font-medium text-gray-800">현재 daily_limit:</span> 30회 (관측 모드)
              </p>
              <p>
                <span className="font-medium text-green-700">유지 신호:</span> 20회+ 유저 비율 &lt; 5%, 평균 시청 &lt; 10회
              </p>
              <p>
                <span className="font-medium text-orange-600">검토 신호:</span> 20회+ 유저 비율 ≥ 5%, eCPM이 초기 대비 30%+ 하락
              </p>
              <p>
                <span className="font-medium text-red-600">하향 신호:</span> 20회+ 유저 비율 ≥ 10%, 특정 유저가 매일 30회 도달
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
