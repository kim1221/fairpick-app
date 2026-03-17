import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { personalizationApi } from '../services/api';
import type {
  PersonalizationHealth,
  PersonalizationSummary,
  PersonalizationSignalQuality,
  RecentEvent,
  TopEvent,
  TrendPoint,
} from '../types/personalization';

// ─── 소형 공통 컴포넌트 ─────────────────────────────────────────────────────

type Accent = 'none' | 'ok' | 'warn' | 'error';

const ACCENT_BADGE: Record<string, { label: string; cls: string }> = {
  ok:    { label: '정상', cls: 'bg-green-100 text-green-700' },
  warn:  { label: '주의', cls: 'bg-yellow-100 text-yellow-800' },
  error: { label: '이상', cls: 'bg-red-100 text-red-700' },
};

function MetricCard({
  label,
  value,
  sub,
  accent = 'none',
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  accent?: Accent;
}) {
  const border =
    accent === 'ok'    ? 'border-green-200'  :
    accent === 'warn'  ? 'border-yellow-300' :
    accent === 'error' ? 'border-red-300'    :
    'border-gray-100';
  const badge = accent !== 'none' ? ACCENT_BADGE[accent] : null;
  return (
    <div className={`bg-white rounded-lg border ${border} px-4 py-3`}>
      <div className="flex items-center justify-between mb-1">
        <p className="text-[10px] uppercase font-semibold text-gray-400">{label}</p>
        {badge && (
          <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold leading-none ${badge.cls}`}>
            {badge.label}
          </span>
        )}
      </div>
      <p className="text-base font-semibold text-gray-900 leading-tight">{value}</p>
      {sub && <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">{children}</h2>;
}

function TabBar<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { label: string; value: T }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex gap-1 mb-3">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`px-3 py-1 text-xs rounded-md font-medium transition-colors ${
            value === o.value
              ? 'bg-primary-600 text-white'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function pct(rate: number) {
  return `${Math.round(rate * 100)}%`;
}

/** ISO 문자열 → KST 표시
 *  백엔드가 'Z' 없는 UTC 문자열을 반환하는 경우에도 올바르게 KST로 표시한다.
 *  (timeZone 미지정 시 브라우저 로컬 타임존 사용 → Railway/UTC 환경에서 9시간 오차 발생)
 */
function fmtTime(iso: string) {
  // Z/+HH:MM 없는 문자열은 UTC로 강제 해석 (Railway 서버가 반환하는 naive UTC timestamp 대응)
  const utcIso = /[Z+]/.test(iso.slice(-6)) ? iso : iso + 'Z';
  const d = new Date(utcIso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function relativeTime(iso: string | null) {
  if (!iso) return '없음';
  // Z/+HH:MM 없는 문자열은 UTC로 강제 해석
  const utcIso = /[Z+]/.test(iso.slice(-6)) ? iso : iso + 'Z';
  const diff = Date.now() - new Date(utcIso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}초 전`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  return `${h}시간 전`;
}

const ACTION_COLORS: Record<string, string> = {
  click:       '#6366f1',
  impression:  '#a5b4fc',
  view:        '#22c55e',
  dwell:       '#f59e0b',
  save:        '#ec4899',
  sheet_open:  '#06b6d4',
  cta_click:   '#f97316',
  unsave:      '#9ca3af',
};

// ─── 섹션별 컴포넌트 ────────────────────────────────────────────────────────

function HealthSection({ data }: { data: PersonalizationHealth | undefined }) {
  if (!data) return null;

  const cfg = {
    alive:   { bg: 'bg-green-50 border-green-200',   icon: '✅', title: '이벤트 수집 정상',    titleColor: 'text-green-800' },
    warning: { bg: 'bg-yellow-50 border-yellow-200', icon: '⚠️', title: '최근 15분 내 이벤트 있음 (5분 내 없음)', titleColor: 'text-yellow-800' },
    dead:    { bg: 'bg-red-50 border-red-300',       icon: '🚨', title: '15분 이상 이벤트 없음!',  titleColor: 'text-red-800' },
  }[data.status];

  return (
    <div className="mb-6">
      <SectionTitle>Ingestion Health</SectionTitle>
      <div className={`border rounded-xl px-5 py-4 mb-4 flex items-center gap-4 ${cfg.bg}`}>
        <span className="text-2xl leading-none">{cfg.icon}</span>
        <div>
          <div className={`font-semibold text-base ${cfg.titleColor}`}>{cfg.title}</div>
          <div className="text-xs text-gray-500 mt-0.5">
            마지막 수신: {relativeTime(data.lastEventAt)}
            {data.lastEventAt && (
              <span className="ml-2 text-gray-400">({fmtTime(data.lastEventAt)})</span>
            )}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard
          label="최근 5분"
          value={`${data.last5min.toLocaleString()}건`}
          accent={data.last5min > 0 ? 'ok' : 'error'}
        />
        <MetricCard
          label="최근 15분"
          value={`${data.last15min.toLocaleString()}건`}
          accent={data.last15min > 0 ? 'ok' : 'warn'}
        />
        <MetricCard
          label="최근 1시간"
          value={`${data.last1h.toLocaleString()}건`}
        />
        <MetricCard
          label="마지막 수신"
          value={relativeTime(data.lastEventAt)}
          sub={data.lastEventAt ? fmtTime(data.lastEventAt) : undefined}
          accent={data.status === 'dead' ? 'error' : data.status === 'warning' ? 'warn' : 'ok'}
        />
      </div>
    </div>
  );
}

function SummarySection({ data }: { data: PersonalizationSummary | undefined }) {
  if (!data) return null;
  const loginRate = data.activeUsers > 0
    ? Math.round(data.loggedInUsers / data.activeUsers * 100)
    : 0;

  return (
    <div className="mb-6">
      <SectionTitle>오늘의 KPI</SectionTitle>
      <p className="text-xs text-gray-400 mb-3">오늘 자정(KST) 이후 user_events 기준</p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard label="총 이벤트 수" value={data.totalEvents.toLocaleString()} sub="건" />
        <MetricCard label="Active 유저" value={data.activeUsers.toLocaleString()} sub="명" />
        <MetricCard
          label="로그인 유저 비율"
          value={`${loginRate}%`}
          sub={`로그인 ${data.loggedInUsers} / 익명 ${data.anonymousUsers}`}
          accent={loginRate > 0 ? 'ok' : 'none'}
        />
        <MetricCard
          label="상호작용된 이벤트"
          value={data.uniqueEvents.toLocaleString()}
          sub="개"
        />
      </div>
    </div>
  );
}

function ActionBreakdownSection() {
  const [period, setPeriod] = useState<'today' | '1h' | '7d'>('today');

  const { data } = useQuery<PersonalizationSummary>({
    queryKey: ['personalization-summary', period],
    queryFn: () => personalizationApi.getSummary(period),
    refetchInterval: 30_000,
  });

  const breakdown = data?.actionBreakdown ?? {};
  const total = Object.values(breakdown).reduce((a, b) => a + b, 0);

  const chartData = Object.entries(breakdown)
    .sort((a, b) => b[1] - a[1])
    .map(([action_type, count]) => ({ action_type, count }));

  return (
    <div className="mb-6">
      <SectionTitle>Action Breakdown</SectionTitle>
      <TabBar
        options={[
          { label: '오늘', value: 'today' },
          { label: '최근 1시간', value: '1h' },
          { label: '최근 7일', value: '7d' },
        ]}
        value={period}
        onChange={setPeriod}
      />
      <div className="card">
        {chartData.length > 0 ? (
          <>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="action_type" tick={{ fontSize: 11 }} width={80} />
                <Tooltip formatter={(v: number | undefined) => (v ?? 0).toLocaleString()} />
                <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                  {chartData.map((entry) => (
                    <Cell
                      key={entry.action_type}
                      fill={ACTION_COLORS[entry.action_type] ?? '#94a3b8'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <table className="w-full text-sm mt-4">
              <thead>
                <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
                  <th className="pb-1.5 font-medium">action_type</th>
                  <th className="pb-1.5 font-medium text-right">건수</th>
                  <th className="pb-1.5 font-medium text-right">비율</th>
                </tr>
              </thead>
              <tbody>
                {chartData.map(({ action_type, count }) => (
                  <tr key={action_type} className="border-b border-gray-50">
                    <td className="py-1.5 flex items-center gap-2">
                      <span
                        className="inline-block w-2.5 h-2.5 rounded-sm"
                        style={{ background: ACTION_COLORS[action_type] ?? '#94a3b8' }}
                      />
                      {action_type}
                    </td>
                    <td className="py-1.5 text-right font-mono">{count.toLocaleString()}</td>
                    <td className="py-1.5 text-right text-gray-400">
                      {total > 0 ? pct(count / total) : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : (
          <p className="text-sm text-gray-400 text-center py-8">이 기간에 이벤트가 없습니다.</p>
        )}
      </div>
    </div>
  );
}

function SignalQualitySection({ data }: { data: PersonalizationSignalQuality | undefined }) {
  if (!data) return null;

  const rateAccent = (rate: number): Accent =>
    rate >= 0.8 ? 'ok' : rate >= 0.5 ? 'warn' : 'error';

  const nullUserIdRate = data.total > 0 ? data.nullUserId.count / data.total : 0;
  const unknownCount = data.unknownActionType.count;

  return (
    <div className="mb-6">
      <SectionTitle>추천 Feature 수집 품질</SectionTitle>
      <p className="text-xs text-gray-400 mb-3">
        section_slug·rank_position은 "추천 섹션 유입 비율"입니다.
        낮아도 이상이 아닙니다. session_id는 높을수록 좋습니다.
      </p>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        <MetricCard
          label="유저 식별 누락"
          value={`${data.nullUserId.count.toLocaleString()}건`}
          sub={`전체의 ${pct(nullUserIdRate)} (낮을수록 좋음)`}
          accent={nullUserIdRate < 0.01 ? 'ok' : nullUserIdRate < 0.05 ? 'warn' : 'error'}
        />
        <MetricCard
          label="추천섹션 유입률"
          value={pct(data.sectionSlugRate.rate)}
          sub={`${data.sectionSlugRate.count.toLocaleString()}건 / ${data.total.toLocaleString()}건`}
          accent="none"
        />
        <MetricCard
          label="순위 기록률"
          value={pct(data.rankPositionRate.rate)}
          sub="rank_position 채움"
          accent="none"
        />
        <MetricCard
          label="세션 식별률"
          value={pct(data.sessionIdRate.rate)}
          sub="session_id 채움"
          accent={rateAccent(data.sessionIdRate.rate)}
        />
        <MetricCard
          label="체류시간 기록률"
          value={pct(data.dwellWithSeconds.rate)}
          sub={`dwell ${data.dwellWithSeconds.total}건 중`}
          accent={data.dwellWithSeconds.total > 0 ? rateAccent(data.dwellWithSeconds.rate) : 'none'}
        />
        <MetricCard
          label="알 수 없는 action"
          value={`${unknownCount.toLocaleString()}건`}
          sub="유효하지 않은 action_type"
          accent={unknownCount === 0 ? 'ok' : 'error'}
        />
      </div>
    </div>
  );
}

const ACTION_FILTER_OPTIONS = [
  { value: '', label: '전체' },
  { value: 'click', label: 'click' },
  { value: 'impression', label: 'impression' },
  { value: 'view', label: 'view' },
  { value: 'dwell', label: 'dwell' },
  { value: 'save', label: 'save' },
  { value: 'unsave', label: 'unsave' },
  { value: 'sheet_open', label: 'sheet_open' },
  { value: 'cta_click', label: 'cta_click' },
];

function USER_TYPE_BADGE({ type }: { type: RecentEvent['userType'] }) {
  const cfg = {
    logged_in: { bg: 'bg-blue-50 text-blue-700', label: '로그인' },
    anonymous: { bg: 'bg-gray-100 text-gray-600', label: '익명' },
    unknown:   { bg: 'bg-red-50 text-red-600',   label: '미상' },
  }[type];
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${cfg.bg}`}>
      {cfg.label}
    </span>
  );
}

/** 잘린 ID + copy 버튼 + (선택) 추천 디버그 링크 */
function CopyableId({
  value,
  debugLink = false,
}: {
  value: string | null;
  debugLink?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const navigate = useNavigate();

  if (!value) return <span className="text-gray-300">-</span>;

  const truncated = value.length > 8 ? value.slice(0, 8) + '…' : value;

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const handleDebug = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigate(`/debug/recommendation?userId=${encodeURIComponent(value)}`);
  };

  return (
    <span className="inline-flex items-center gap-1 group">
      {/* 잘린 표시 — hover 시 전체 ID 툴팁 */}
      <span className="font-mono text-gray-400 cursor-default" title={value}>
        {truncated}
      </span>

      {/* copy 버튼 — hover 시 노출 */}
      <button
        onClick={handleCopy}
        className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-gray-600 transition-all"
        title={copied ? '복사됨!' : '클립보드에 복사'}
      >
        {copied ? (
          <span className="text-green-500 text-[10px] font-bold">✓</span>
        ) : (
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        )}
      </button>

      {/* 추천 디버그 링크 — userId에만 노출 */}
      {debugLink && (
        <button
          onClick={handleDebug}
          className="opacity-0 group-hover:opacity-100 text-indigo-300 hover:text-indigo-600 transition-all"
          title="추천 디버그에서 열기"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </button>
      )}
    </span>
  );
}

function RecentEventsSection() {
  const [searchParams] = useSearchParams();
  const [actionType, setActionType] = useState('');
  // 개인화 관제 ← 추천 디버그에서 userId 파라미터로 넘어온 경우 자동 세팅
  const [userId, setUserId] = useState(searchParams.get('userId') ?? '');
  const [eventId, setEventId] = useState('');

  const limit = 50;
  const params = {
    limit,
    ...(actionType && { actionType }),
    ...(userId && { userId }),
    ...(eventId && { eventId }),
  };

  const { data, isFetching } = useQuery<{ items: RecentEvent[] }>({
    queryKey: ['personalization-recent', params],
    queryFn: () => personalizationApi.getRecentEvents(params),
    refetchInterval: 30_000,
  });

  const items = data?.items ?? [];

  return (
    <div className="mb-6">
      <SectionTitle>최근 Raw Sample</SectionTitle>
      <p className="text-xs text-gray-400 mb-2">user_events 원본 로그 최근 {limit}건 (필터 적용 시 해당 조건 기준)</p>
      <div className="flex flex-wrap gap-2 mb-3">
        <select
          value={actionType}
          onChange={(e) => setActionType(e.target.value)}
          className="text-sm border border-gray-200 rounded-md px-2 py-1.5 bg-white"
        >
          {ACTION_FILTER_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <input
          type="text"
          placeholder="userId 검색"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          className="text-sm border border-gray-200 rounded-md px-2 py-1.5 w-48"
        />
        <input
          type="text"
          placeholder="eventId 검색"
          value={eventId}
          onChange={(e) => setEventId(e.target.value)}
          className="text-sm border border-gray-200 rounded-md px-2 py-1.5 w-48"
        />
        {isFetching && <span className="text-xs text-gray-400 self-center">새로고침 중...</span>}
      </div>
      <div className="card overflow-auto">
        <table className="w-full text-xs min-w-[900px]">
          <thead>
            <tr className="text-left text-gray-400 border-b border-gray-100">
              {['시각', '유저', 'action', '이벤트', '섹션', 'rank', 'session'].map((h) => (
                <th key={h} className="pb-2 pr-3 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-8 text-center text-gray-400">데이터 없음</td>
              </tr>
            ) : (
              items.map((row) => (
                <tr key={row.id} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="py-1.5 pr-3 whitespace-nowrap text-gray-500">
                    {fmtTime(row.createdAt)}
                  </td>
                  <td className="py-1.5 pr-3">
                    <div className="flex items-center gap-1">
                      <USER_TYPE_BADGE type={row.userType} />
                      <CopyableId value={row.userId} debugLink={true} />
                    </div>
                  </td>
                  <td className="py-1.5 pr-3">
                    <span
                      className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium text-white"
                      style={{ background: ACTION_COLORS[row.actionType] ?? '#94a3b8' }}
                    >
                      {row.actionType}
                    </span>
                  </td>
                  <td className="py-1.5 pr-3 max-w-[160px]">
                    <span className="truncate block">
                      {row.eventTitle ?? <span className="text-gray-300">(없음)</span>}
                    </span>
                    {row.mainCategory && (
                      <span className="text-gray-400 text-[10px]">{row.mainCategory}</span>
                    )}
                    {row.eventId && (
                      <div className="mt-0.5">
                        <CopyableId value={row.eventId} />
                      </div>
                    )}
                  </td>
                  <td className="py-1.5 pr-3 text-gray-500">{row.sectionSlug ?? '-'}</td>
                  <td className="py-1.5 pr-3 text-gray-500">{row.rankPosition ?? '-'}</td>
                  <td className="py-1.5 pr-3 font-mono text-gray-400">
                    {row.sessionId ? row.sessionId.slice(0, 8) + '…' : '-'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TopEventsSection() {
  const [period, setPeriod] = useState<'7d' | '1d'>('7d');

  const { data } = useQuery<{ period: string; items: TopEvent[] }>({
    queryKey: ['personalization-top-events', period],
    queryFn: () => personalizationApi.getTopEvents(period),
    refetchInterval: 60_000,
  });

  const items = data?.items ?? [];

  return (
    <div className="mb-6">
      <SectionTitle>상위 상호작용 이벤트</SectionTitle>
      <p className="text-xs text-gray-400 mb-2">click · save · dwell · cta_click 기준 (impression 제외) — user_events 직접 집계</p>
      <TabBar
        options={[
          { label: '최근 7일', value: '7d' },
          { label: '최근 1일', value: '1d' },
        ]}
        value={period}
        onChange={setPeriod}
      />
      <div className="card overflow-auto">
        <table className="w-full text-xs min-w-[700px]">
          <thead>
            <tr className="text-left text-gray-400 border-b border-gray-100">
              {['이벤트', '카테고리', '지역', 'click', 'save', 'dwell', 'cta', '합계'].map((h) => (
                <th key={h} className="pb-2 pr-3 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-8 text-center text-gray-400">데이터 없음</td>
              </tr>
            ) : (
              items.map((row, i) => (
                <tr key={row.eventId ?? i} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="py-1.5 pr-3 max-w-[180px]">
                    <span className="truncate block font-medium text-gray-800">
                      {row.title ?? <span className="text-gray-300">(제목 없음)</span>}
                    </span>
                    <span className="font-mono text-gray-300 text-[10px]">
                      {row.eventId?.slice(0, 8)}…
                    </span>
                  </td>
                  <td className="py-1.5 pr-3 text-gray-500">{row.mainCategory ?? '-'}</td>
                  <td className="py-1.5 pr-3 text-gray-500">{row.region ?? '-'}</td>
                  <td className="py-1.5 pr-3 font-mono">{row.clickCount}</td>
                  <td className="py-1.5 pr-3 font-mono">{row.saveCount}</td>
                  <td className="py-1.5 pr-3 font-mono">{row.dwellCount}</td>
                  <td className="py-1.5 pr-3 font-mono">{row.ctaClickCount}</td>
                  <td className="py-1.5 pr-3 font-mono font-semibold text-gray-800">
                    {row.totalInteractions}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TrendSection() {
  const [granularity, setGranularity] = useState<'day' | 'hour'>('day');

  const { data } = useQuery<{ granularity: string; points: TrendPoint[] }>({
    queryKey: ['personalization-trend', granularity],
    queryFn: () => personalizationApi.getTrend(granularity),
    refetchInterval: 60_000,
  });

  const points = (data?.points ?? []).map((p) => {
    const utcBucket = /[Z+]/.test(p.bucket.slice(-6)) ? p.bucket : p.bucket + 'Z';
    const d = new Date(utcBucket);
    return {
      ...p,
      label: granularity === 'hour'
        ? d.toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit' })
        : d.toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit' }),
    };
  });

  return (
    <div className="mb-6">
      <SectionTitle>이벤트 수집 추이</SectionTitle>
      <TabBar
        options={[
          { label: '일별 (7일)', value: 'day' },
          { label: '시간별 (24h)', value: 'hour' },
        ]}
        value={granularity}
        onChange={setGranularity}
      />
      <div className="card">
        {points.length > 0 ? (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={points} margin={{ left: 0, right: 8, top: 4, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v: number | undefined) => [`${(v ?? 0).toLocaleString()}건`, '이벤트 수']} />
              <Bar dataKey="count" fill="#6366f1" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-sm text-gray-400 text-center py-8">데이터 없음</p>
        )}
      </div>
    </div>
  );
}

// ─── 메인 페이지 ────────────────────────────────────────────────────────────

export default function PersonalizationPage() {
  const { data: health, dataUpdatedAt: healthUpdatedAt } = useQuery<PersonalizationHealth>({
    queryKey: ['personalization-health'],
    queryFn: personalizationApi.getHealth,
    refetchInterval: 30_000,
  });

  const { data: summary } = useQuery<PersonalizationSummary>({
    queryKey: ['personalization-summary', 'today'],
    queryFn: () => personalizationApi.getSummary('today'),
    refetchInterval: 30_000,
  });

  const { data: signalQuality } = useQuery<PersonalizationSignalQuality>({
    queryKey: ['personalization-signal-quality', 'today'],
    queryFn: () => personalizationApi.getSignalQuality('today'),
    refetchInterval: 60_000,
  });

  const lastUpdated = healthUpdatedAt
    ? new Date(healthUpdatedAt).toLocaleTimeString('ko-KR')
    : null;

  return (
    <div>
      {/* 헤더 */}
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">개인화 이벤트 관제</h1>
          <p className="text-sm text-gray-500 mt-1">
            user_events 파이프라인 health · 수집 품질 · 추천 feature 현황
          </p>
          <p className="text-xs text-blue-600 bg-blue-50 border border-blue-200 rounded px-2 py-1 mt-2 inline-block">
            모든 수치는 <code className="font-mono">user_events</code> 테이블 직접 집계 (집계 캐시 없음 · 조회 시점 기준 실시간)
          </p>
        </div>
        {lastUpdated && (
          <span className="text-xs text-gray-400">마지막 업데이트: {lastUpdated}</span>
        )}
      </div>

      {/* Section A: Health */}
      <HealthSection data={health} />

      {/* Section B: KPI */}
      <SummarySection data={summary} />

      {/* Section C: Action Breakdown */}
      <ActionBreakdownSection />

      {/* Section D: Signal Quality */}
      <SignalQualitySection data={signalQuality} />

      {/* Section E: Recent Raw Sample */}
      <RecentEventsSection />

      {/* Section F: Top Events */}
      <TopEventsSection />

      {/* Section G: Trend */}
      <TrendSection />
    </div>
  );
}
