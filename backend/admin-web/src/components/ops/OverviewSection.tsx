import type { ReactNode } from 'react';
import type { DashboardStats, AdminHealth, ApiServiceStatus, WindowMetrics } from '../../types';

// ──────────────────────────────────────────────────────────────
// 헬퍼
// ──────────────────────────────────────────────────────────────

function fmtUptime(sec: number): string {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
  return `${Math.floor(sec / 86400)}d ${Math.floor((sec % 86400) / 3600)}h`;
}

function fmtCheckedAt(iso: string | null): string {
  if (!iso) return '—';
  const diffMs = Date.now() - new Date(iso).getTime();
  if (diffMs < 60_000) return '방금';
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}분 전`;
  return new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
}

// ──────────────────────────────────────────────────────────────
// 미니 카드 (공통 레이아웃)
// ──────────────────────────────────────────────────────────────

interface MetricCardProps {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  accent?: 'none' | 'ok' | 'warn' | 'error';
}

function MetricCard({ label, value, sub, accent = 'none' }: MetricCardProps) {
  const borderColor =
    accent === 'ok' ? 'border-green-200' :
    accent === 'warn' ? 'border-yellow-300' :
    accent === 'error' ? 'border-red-300' :
    'border-gray-100';
  return (
    <div className={`bg-white rounded-lg border ${borderColor} px-4 py-3`}>
      <p className="text-[10px] uppercase font-semibold text-gray-400 mb-1">{label}</p>
      <p className="text-base font-semibold text-gray-900 leading-tight">{value}</p>
      {sub && <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// 서버 헬스 섹션
// ──────────────────────────────────────────────────────────────

function ServerHealthRow({ health, isLoading }: { health?: AdminHealth; isLoading: boolean }) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-gray-50 rounded-lg h-16 animate-pulse border border-gray-100" />
        ))}
      </div>
    );
  }

  if (!health) {
    return (
      <p className="text-xs text-red-500">서버 상태를 불러오지 못했습니다.</p>
    );
  }

  const statusIcon = health.status === 'ok' ? '✓' : health.status === 'warning' ? '⚠' : '✕';
  const statusLabel = health.status === 'ok' ? '정상' : health.status === 'warning' ? '경고' : '오류';
  const statusAccent = health.status === 'ok' ? 'ok' : health.status === 'warning' ? 'warn' : 'error';

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <MetricCard
        label="서버"
        value={<span className={health.status === 'ok' ? 'text-green-600' : health.status === 'warning' ? 'text-yellow-600' : 'text-red-600'}>{statusIcon} {statusLabel}</span>}
        sub={health.nodeEnv}
        accent={statusAccent}
      />
      <MetricCard
        label="DB"
        value={health.db.ok
          ? <span className="text-green-600">✓ 연결됨</span>
          : <span className="text-red-600">✕ 연결 실패</span>}
        sub={health.pool.totalCount != null
          ? `idle ${health.pool.idleCount}/${health.pool.totalCount}${health.pool.waitingCount ? ` · wait ${health.pool.waitingCount}` : ''}`
          : undefined}
        accent={health.pool.waitingCount && health.pool.waitingCount > 3 ? 'warn' : health.db.ok ? 'ok' : 'error'}
      />
      <MetricCard
        label="메모리"
        value={`${health.memoryRssMb} MB`}
        sub={health.eventLoop.lagDetected
          ? <span className="text-yellow-600">EventLoop lag {health.eventLoop.lastLagMs}ms</span>
          : 'EventLoop 정상'}
        accent={health.eventLoop.lagDetected ? 'warn' : 'none'}
      />
      <MetricCard
        label="업타임"
        value={fmtUptime(health.uptimeSec)}
        sub={health.currentlyRunning.length > 0
          ? `실행 중 ${health.currentlyRunning.length}개 잡`
          : '대기 중'}
      />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// 요청 메트릭 섹션
// ──────────────────────────────────────────────────────────────

function fmtMs(ms: number | null): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function RequestMetricsRow({ metrics }: { metrics?: AdminHealth['requestMetrics'] }) {
  if (!metrics) return null;

  const { window5m, window1h, lastErrorAt } = metrics;

  const errAccent = (rate: number): 'none' | 'warn' | 'error' =>
    rate >= 10 ? 'error' : rate >= 1 ? 'warn' : 'none';

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <MetricCard
        label="요청수 (5분)"
        value={window5m.totalRequests.toLocaleString()}
        sub={`응답 ${fmtMs(window5m.avgResponseMs)} avg`}
      />
      <MetricCard
        label="5xx 에러율 (5분)"
        value={window5m.totalRequests === 0
          ? <span className="text-gray-400">—</span>
          : <span className={window5m.error5xxRate >= 1 ? 'text-red-600' : 'text-green-600'}>
              {window5m.error5xxRate.toFixed(1)}%
            </span>}
        sub={`${window5m.errors5xx}건 / ${window5m.totalRequests}건`}
        accent={errAccent(window5m.error5xxRate)}
      />
      <MetricCard
        label="5xx 에러율 (1시간)"
        value={window1h.totalRequests === 0
          ? <span className="text-gray-400">—</span>
          : <span className={window1h.error5xxRate >= 1 ? 'text-red-600' : 'text-green-600'}>
              {window1h.error5xxRate.toFixed(1)}%
            </span>}
        sub={`${window1h.errors5xx}건 / ${window1h.totalRequests}건`}
        accent={errAccent(window1h.error5xxRate)}
      />
      <MetricCard
        label="마지막 5xx"
        value={lastErrorAt
          ? <span className="text-red-600">{fmtCheckedAt(lastErrorAt)}</span>
          : <span className="text-green-600">없음</span>}
        sub={lastErrorAt ? new Date(lastErrorAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : '정상'}
        accent={lastErrorAt ? 'warn' : 'none'}
      />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// 데이터 품질 섹션
// ──────────────────────────────────────────────────────────────

function DataQualityRow({ stats }: { stats?: DashboardStats }) {
  if (!stats) return null;

  const missingImages = stats.missingImages ?? 0;
  const missingCoords = stats.missingCoords ?? 0;
  const incompleteEvents = stats.incompleteEvents ?? 0;
  const collectedToday = stats.collectedToday ?? 0;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <MetricCard
        label="오늘 수집"
        value={collectedToday > 0
          ? <span className="text-green-700">{collectedToday.toLocaleString()}건</span>
          : <span className="text-gray-400">0건</span>}
        sub={stats.lastCollection
          ? `마지막: ${fmtCheckedAt(stats.lastCollection.started_at)}`
          : undefined}
      />
      <MetricCard
        label="이미지 누락"
        value={missingImages.toLocaleString()}
        sub={`/ ${stats.totalEvents.toLocaleString()} 이벤트`}
        accent={missingImages > 100 ? 'warn' : 'none'}
      />
      <MetricCard
        label="좌표 누락"
        value={missingCoords.toLocaleString()}
        sub="lat/lng 미설정"
        accent={missingCoords > 200 ? 'warn' : 'none'}
      />
      <MetricCard
        label="개요 없음"
        value={incompleteEvents.toLocaleString()}
        sub="overview 미입력"
        accent={incompleteEvents > 500 ? 'warn' : 'none'}
      />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// 외부 API 상태 섹션
// ──────────────────────────────────────────────────────────────

const SERVICE_LABELS: Record<string, string> = {
  KOPIS: 'KOPIS',
  CulturePortal: '문화포털',
  TourAPI: 'TourAPI',
  Naver: 'Naver',
  Gemini: 'Gemini',
};

function ApiStatusChip({ svc }: { svc: ApiServiceStatus }) {
  const label = SERVICE_LABELS[svc.name] ?? svc.name;

  const chipStyle =
    svc.status === 'ok' ? 'bg-green-50 text-green-700 border-green-200' :
    svc.status === 'fail' ? 'bg-red-50 text-red-700 border-red-200' :
    'bg-gray-50 text-gray-500 border-gray-200';

  const dot =
    svc.status === 'ok' ? '●' :
    svc.status === 'fail' ? '✕' :
    '—';

  const title =
    svc.status === 'not_configured' ? (svc.message ?? '미설정') :
    svc.status === 'fail' ? (svc.message ?? '요청 실패') :
    svc.latencyMs != null ? `${svc.latencyMs}ms` : '정상';

  return (
    <div
      className={`flex flex-col items-center gap-0.5 px-3 py-2 rounded-lg border ${chipStyle} min-w-[72px]`}
      title={title}
    >
      <span className="text-xs font-semibold">{label}</span>
      <span className="text-[10px] leading-tight">
        {dot}{' '}
        {svc.status === 'ok' ? (svc.latencyMs != null ? `${svc.latencyMs}ms` : '정상') :
         svc.status === 'fail' ? '실패' : '미설정'}
      </span>
    </div>
  );
}

function ApiStatusRow({
  services,
  refreshedAt,
  isLoading,
}: {
  services?: ApiServiceStatus[];
  refreshedAt?: string | null;
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <div className="flex gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="w-16 h-12 bg-gray-50 animate-pulse rounded-lg border border-gray-100" />
        ))}
      </div>
    );
  }
  if (!services || services.length === 0) return null;

  return (
    <div className="flex items-center gap-3 flex-wrap">
      {services.map((svc) => (
        <ApiStatusChip key={svc.name} svc={svc} />
      ))}
      {refreshedAt && (
        <span className="text-[10px] text-gray-400 ml-auto">
          확인 {fmtCheckedAt(refreshedAt)}
        </span>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// 비용 섹션 (v2: Gemini 실측 + Railway 링크)
// ──────────────────────────────────────────────────────────────

interface AiUsageToday {
  calls: number;
  errors: number;
  totalTokens: number;
  costUsd: number;
  monthCostUsd: number;
}

function fmtUsd(usd: number): string {
  if (usd === 0) return '$0.00';
  if (usd < 0.001) return `$${usd.toFixed(6)}`;
  if (usd < 1)    return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function CostSection({ aiUsage }: { aiUsage?: AiUsageToday }) {
  return (
    <div className="flex flex-wrap gap-3 text-[11px]">
      {/* Gemini (실측) */}
      <div className="px-3 py-2 bg-white rounded-lg border border-gray-100 space-y-0.5">
        <p className="text-[10px] uppercase font-semibold text-gray-400">Gemini (오늘)</p>
        {aiUsage ? (
          <>
            <p className="text-sm font-semibold text-gray-900">{fmtUsd(aiUsage.costUsd)}</p>
            <p className="text-[10px] text-gray-400">
              {fmtTokens(aiUsage.totalTokens)}토큰 · {aiUsage.calls}회
              {aiUsage.errors > 0 && (
                <span className="text-red-400"> · 실패 {aiUsage.errors}</span>
              )}
            </p>
          </>
        ) : (
          <p className="text-sm text-gray-400">—</p>
        )}
      </div>
      {/* Gemini 이번 달 */}
      {aiUsage && (
        <div className="px-3 py-2 bg-white rounded-lg border border-gray-100 space-y-0.5">
          <p className="text-[10px] uppercase font-semibold text-gray-400">Gemini (이번달)</p>
          <p className="text-sm font-semibold text-gray-900">{fmtUsd(aiUsage.monthCostUsd)}</p>
          <p className="text-[10px] text-gray-400">예상 누적</p>
        </div>
      )}
      {/* R2 */}
      <div className="px-3 py-2 bg-gray-50 rounded-lg border border-gray-100 space-y-0.5">
        <p className="text-[10px] uppercase font-semibold text-gray-400">R2 저장량</p>
        <p className="text-sm text-gray-400">미계측</p>
      </div>
      {/* Railway */}
      <a
        href="https://railway.app"
        target="_blank"
        rel="noopener noreferrer"
        className="px-3 py-2 bg-gray-50 rounded-lg border border-gray-100 hover:border-gray-200 transition-colors space-y-0.5 block"
      >
        <p className="text-[10px] uppercase font-semibold text-gray-400">Railway</p>
        <p className="text-sm text-gray-600">대시보드 확인 ↗</p>
      </a>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// 최상위 컴포넌트
// ──────────────────────────────────────────────────────────────

interface OverviewSectionProps {
  stats?: DashboardStats;
  health?: AdminHealth;
  healthLoading: boolean;
  apiServices?: ApiServiceStatus[];
  apiRefreshedAt?: string | null;
  apiLoading: boolean;
}

export default function OverviewSection({
  stats,
  health,
  healthLoading,
  apiServices,
  apiRefreshedAt,
  apiLoading,
}: OverviewSectionProps) {
  return (
    <div className="space-y-4">
      {/* 서버 헬스 */}
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase mb-2">서버 헬스</p>
        <ServerHealthRow health={health} isLoading={healthLoading} />
      </div>

      {/* 요청 메트릭 */}
      {health?.requestMetrics && (
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase mb-2">요청 메트릭</p>
          <RequestMetricsRow metrics={health.requestMetrics} />
        </div>
      )}

      {/* 데이터 품질 */}
      {stats && (
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase mb-2">데이터 품질</p>
          <DataQualityRow stats={stats} />
        </div>
      )}

      {/* 외부 API 상태 */}
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase mb-2">외부 API 상태</p>
        <ApiStatusRow services={apiServices} refreshedAt={apiRefreshedAt} isLoading={apiLoading} />
      </div>

      {/* 비용 */}
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase mb-2">비용</p>
        <CostSection aiUsage={stats?.aiUsageToday} />
      </div>
    </div>
  );
}
