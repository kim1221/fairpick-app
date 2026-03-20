import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getAiCost, getDbCost, getStorageCost, getApiUsage } from '../services/costApi';
import type { CostItem, CostType, AiPeriod, AiDailyTrend } from '../types/cost';

// ─── costType 배지 ────────────────────────────────────────────────────────────

const COST_TYPE_CONFIG: Record<CostType, { label: string; color: string; tooltip: string }> = {
  aggregated: {
    label: '집계값',
    color: 'bg-green-100 text-green-800',
    tooltip: '내부 usage 로그 기반 집계입니다. provider 실제 청구서와 차이가 있을 수 있습니다.',
  },
  estimated: {
    label: '추정',
    color: 'bg-yellow-100 text-yellow-800',
    tooltip: '사용량 × 단가로 계산한 추정값입니다. 실제 청구액과 다를 수 있습니다.',
  },
  manual: {
    label: '수동 입력',
    color: 'bg-gray-100 text-gray-700',
    tooltip: '운영자가 직접 입력한 고정비입니다.',
  },
  'usage-only': {
    label: '사용량만',
    color: 'bg-blue-100 text-blue-800',
    tooltip: '금액 추적 없이 사용량만 모니터링합니다.',
  },
};

// ─── 공통 컴포넌트 ────────────────────────────────────────────────────────────

function CostTypeBadge({ type }: { type: CostType }) {
  const cfg = COST_TYPE_CONFIG[type];
  return (
    <span
      className={`px-2 py-0.5 rounded text-xs font-medium ${cfg.color}`}
      title={cfg.tooltip}
    >
      {cfg.label}
    </span>
  );
}

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
      {subtitle && <p className="text-sm text-gray-500 mt-0.5">{subtitle}</p>}
    </div>
  );
}

// ─── CostCard ─────────────────────────────────────────────────────────────────

function CostCard({ item }: { item: CostItem }) {
  const [expanded, setExpanded] = useState(false);

  const amountDisplay =
    item.amount === null
      ? null
      : `$${item.amount < 0.01 && item.amount > 0 ? item.amount.toFixed(6) : item.amount.toFixed(4)}`;

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
      {/* 헤더 */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-gray-400 font-medium">{item.provider}</span>
            <CostTypeBadge type={item.costType} />
          </div>
          <h3 className="text-base font-semibold text-gray-900 mt-1">{item.name}</h3>
        </div>
        <div className="text-right shrink-0">
          {amountDisplay ? (
            <span className="text-xl font-bold text-gray-900">{amountDisplay}</span>
          ) : (
            <span className="text-sm text-blue-600 font-medium">무료</span>
          )}
          {item.currency && amountDisplay && (
            <div className="text-xs text-gray-400">{item.currency}</div>
          )}
        </div>
      </div>

      {/* 설명 */}
      <div className="space-y-1.5">
        <div className="flex gap-2 text-sm">
          <span className="text-gray-400 shrink-0 w-14">원인</span>
          <span className="text-gray-700">{item.costDriver}</span>
        </div>
        <div className="flex gap-2 text-sm">
          <span className="text-gray-400 shrink-0 w-14">설명</span>
          <span className="text-gray-600">{item.shortExplanation}</span>
        </div>
        <div className="flex gap-2 text-sm">
          <span className="text-gray-400 shrink-0 w-14">근거</span>
          <span className="text-gray-500 text-xs">{item.sourceOfTruth}</span>
        </div>
        {item.pricingRef && (
          <div className="flex gap-2 text-sm">
            <span className="text-gray-400 shrink-0 w-14">단가</span>
            <span className="text-gray-500 text-xs font-mono">{item.pricingRef}</span>
          </div>
        )}
        {item.noAmountReason && (
          <div className="flex gap-2 text-sm">
            <span className="text-gray-400 shrink-0 w-14">무료 이유</span>
            <span className="text-blue-600 text-xs">{item.noAmountReason}</span>
          </div>
        )}
      </div>

      {/* 사용량 지표 */}
      {item.usageMetrics.length > 0 && (
        <div className="border-t border-gray-100 pt-3">
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {item.usageMetrics.map((m) => (
              <div key={m.label} className="text-sm">
                <span className="text-gray-400">{m.label}</span>
                <span className="ml-1.5 font-semibold text-gray-800">{m.formatted}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* DB 테이블 상세 (확장) */}
      {item.tables && item.tables.length > 0 && (
        <div className="border-t border-gray-100 pt-3">
          <button
            className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? '▲' : '▼'} 테이블별 상세 보기
          </button>
          {expanded && (
            <div className="mt-2 space-y-1">
              {item.tables.map((t) => {
                const maxBytes = item.tables![0].bytes;
                const pct = maxBytes > 0 ? Math.round((t.bytes / maxBytes) * 100) : 0;
                return (
                  <div key={t.name} className="flex items-center gap-3 text-xs">
                    <span className="w-44 text-gray-700 truncate font-mono">{t.name}</span>
                    <div className="flex-1 bg-gray-100 rounded-full h-1.5">
                      <div
                        className="bg-blue-400 h-1.5 rounded-full"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="w-16 text-right text-gray-500">{t.sizeFormatted}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 모델 목록 */}
      {item.models && item.models.length > 0 && (
        <div className="border-t border-gray-100 pt-2">
          <div className="flex flex-wrap gap-1">
            {item.models.map((m) => (
              <span key={m} className="px-1.5 py-0.5 bg-gray-50 border border-gray-200 rounded text-xs text-gray-500 font-mono">
                {m}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── 일별 추이 차트 (경량 바 차트) ───────────────────────────────────────────

function DailyTrendChart({ data }: { data: AiDailyTrend[] }) {
  if (!data || data.length === 0) return null;
  const maxCost = Math.max(...data.map((d) => d.costUsd), 0.0001);

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5">
      <h3 className="text-sm font-semibold text-gray-700 mb-4">일별 AI 비용 추이 (최근 30일)</h3>
      <div className="flex items-end gap-0.5 h-20">
        {data.map((d) => {
          const pct = (d.costUsd / maxCost) * 100;
          return (
            <div
              key={d.date}
              className="flex-1 bg-blue-200 hover:bg-blue-400 rounded-t transition-colors cursor-default"
              style={{ height: `${Math.max(pct, 2)}%` }}
              title={`${d.date}\n$${d.costUsd.toFixed(4)} / ${d.requests}건`}
            />
          );
        })}
      </div>
      <div className="flex justify-between text-xs text-gray-400 mt-1">
        <span>{data[0]?.date?.slice(5)}</span>
        <span>{data[data.length - 1]?.date?.slice(5)}</span>
      </div>
    </div>
  );
}

// ─── 외부 콘솔 링크 데이터 ───────────────────────────────────────────────────

const EXTERNAL_CONSOLE_LINKS = [
  {
    key: 'google-cloud-billing',
    name: 'Google Cloud Billing',
    description: 'Gemini API 실제 청구 · SKU별 상세',
    url: 'https://console.cloud.google.com/billing/018AA6-4B2C51-5B0B75/reports',
    icon: '☁️',
  },
  {
    key: 'google-ai-studio',
    name: 'Google AI Studio',
    description: 'API 키 · 프로젝트 사용량',
    url: 'https://aistudio.google.com',
    icon: '🤖',
  },
  {
    key: 'supabase',
    name: 'Supabase Billing',
    description: 'DB 플랜 · 스토리지 · API 사용량',
    url: 'https://supabase.com/dashboard',
    icon: '🗄️',
  },
  {
    key: 'cloudflare-r2',
    name: 'Cloudflare R2',
    description: 'R2 스토리지 · CDN 트래픽 사용량',
    url: 'https://dash.cloudflare.com/?to=/:account/r2/overview',
    icon: '🔶',
  },
] as const;

// ─── CostPage ─────────────────────────────────────────────────────────────────

const PERIOD_OPTIONS: { value: AiPeriod; label: string }[] = [
  { value: 'today',      label: '오늘' },
  { value: 'this_month', label: '이번달' },
  { value: 'last_month', label: '지난달' },
];

export default function CostPage() {
  const [period, setPeriod] = useState<AiPeriod>('this_month');
  const queryClient = useQueryClient();

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['cost/ai'] });
    queryClient.invalidateQueries({ queryKey: ['cost/db'] });
    queryClient.invalidateQueries({ queryKey: ['cost/storage'] });
    queryClient.invalidateQueries({ queryKey: ['cost/api-usage'] });
  };

  const aiQuery = useQuery({
    queryKey: ['cost/ai', period],
    queryFn: () => getAiCost(period),
    staleTime: 0,  // 항상 최신 데이터 조회
  });

  const dbQuery = useQuery({
    queryKey: ['cost/db'],
    queryFn: getDbCost,
  });

  const storageQuery = useQuery({
    queryKey: ['cost/storage'],
    queryFn: getStorageCost,
    staleTime: 60 * 60 * 1000, // 1시간
  });

  const apiUsageQuery = useQuery({
    queryKey: ['cost/api-usage'],
    queryFn: getApiUsage,
  });

  const totalAiUsd = aiQuery.data?.summary.totalUsd ?? 0;
  const totalStorageUsd =
    storageQuery.data?.items.reduce((s, i) => s + (i.amount ?? 0), 0) ?? 0;

  return (
    <div className="space-y-8">
      {/* 페이지 헤더 */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">비용 관제</h1>
          <p className="text-sm text-gray-500 mt-1">
            현재 Fairpick 운영 비용 항목별 추적 — 코드/DB에서 직접 수집 가능한 항목 중심
          </p>
          {/* 로그 시작일 경고 */}
          <p className="text-xs text-orange-600 mt-1.5">
            ⚠ AI 로그 집계 시작: <strong>2026-03-13</strong> · 이전 비용 미포함 · 정확한 청구액은 아래 Google Cloud Billing에서 확인
          </p>
        </div>
        {/* 기간 탭 + 새로고침 */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleRefresh}
            className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
            title="모든 비용 데이터 새로고침"
          >
            ↻ 새로고침
          </button>
          <div className="flex bg-gray-100 rounded-lg p-1 gap-1">
            {PERIOD_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setPeriod(opt.value)}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  period === opt.value
                    ? 'bg-white shadow text-gray-900'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 상단 요약 배너 */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="text-xs text-gray-400 mb-1">AI 비용 (집계값)</div>
          <div className="text-2xl font-bold text-gray-900">${totalAiUsd.toFixed(4)}</div>
          <div className="text-xs text-gray-400 mt-1">내부 로그 기반 · provider 청구서 아님</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="text-xs text-gray-400 mb-1">스토리지 비용 (추정)</div>
          <div className="text-2xl font-bold text-gray-900">${totalStorageUsd.toFixed(4)}</div>
          <div className="text-xs text-gray-400 mt-1">R2 저장 용량 × 단가</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="text-xs text-gray-400 mb-1">인프라 비용</div>
          <div className="text-lg font-semibold text-gray-400">—</div>
          <div className="text-xs text-gray-400 mt-1">Railway · Supabase — 2차 연동 예정</div>
        </div>
      </div>

      {/* ── AI 비용 ──────────────────────────────────────────────── */}
      <section>
        <SectionHeader
          title="AI 비용"
          subtitle={aiQuery.data?.summary.costTypeNote}
        />
        {/* 집계 범위 안내 */}
        <div className="mb-4 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-xs text-amber-800 space-y-1">
          <p className="font-semibold">⚠️ 내부 로그 기반 추정값 — 단가는 Google Cloud Billing 역산 기준</p>
          <p>단가: <span className="font-mono">$0.30/1M input · $2.50/1M output (gemini-2.5-flash non-thinking)</span></p>
          <p className="text-amber-600">2026-03-13 이전 호출 미포함 · 실제 청구 확인은 위 Google Cloud Billing 링크에서</p>
        </div>
        {aiQuery.isLoading && <div className="text-sm text-gray-400">불러오는 중...</div>}
        {aiQuery.isError && (
          <div className="text-sm text-red-500">데이터를 불러오지 못했습니다.</div>
        )}
        {aiQuery.data && (
          <div className="space-y-4">
            <DailyTrendChart data={aiQuery.data.dailyTrend} />
            {aiQuery.data.items.length === 0 ? (
              <div className="text-sm text-gray-400 py-4">
                {period === 'today' ? '오늘 AI API 호출 기록이 없습니다.' : '해당 기간 AI API 호출 기록이 없습니다.'}
              </div>
            ) : (
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                {aiQuery.data.items.map((item) => (
                  <CostCard key={item.id} item={item} />
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {/* ── DB / 스토리지 ─────────────────────────────────────────── */}
      <section>
        <SectionHeader title="DB / 스토리지" />
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {dbQuery.isLoading && (
            <div className="text-sm text-gray-400">DB 용량 조회 중...</div>
          )}
          {dbQuery.data?.items.map((item) => (
            <CostCard key={item.id} item={item} />
          ))}

          {storageQuery.isLoading && (
            <div className="text-sm text-gray-400">R2 스캔 중 (최대 수십 초)...</div>
          )}
          {storageQuery.data?.items.map((item) => (
            <div key={item.id}>
              <CostCard item={item} />
              {storageQuery.data.cachedAt && (
                <p className="text-xs text-gray-400 mt-1 pl-1">
                  마지막 스캔:{' '}
                  {new Date(storageQuery.data.cachedAt).toLocaleString('ko-KR')}
                  {storageQuery.data.fromCache ? ' (캐시)' : ''}
                </p>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* ── 외부 API 호출량 ──────────────────────────────────────── */}
      <section>
        <SectionHeader
          title="외부 API 호출량"
          subtitle="최근 30일 · 정부 개방 API 사용량 모니터링 (현재 과금 없음)"
        />
        {apiUsageQuery.isLoading && (
          <div className="text-sm text-gray-400">불러오는 중...</div>
        )}
        {apiUsageQuery.data?.items.length === 0 && (
          <div className="text-sm text-gray-400">최근 30일 수집 기록이 없습니다.</div>
        )}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {apiUsageQuery.data?.items.map((item) => (
            <CostCard key={item.id} item={item} />
          ))}
        </div>
      </section>

      {/* ── 외부 콘솔 링크 ───────────────────────────────────────── */}
      <section>
        <SectionHeader
          title="외부 콘솔"
          subtitle="실제 청구 기준 확인 — provider 대시보드로 바로 이동"
        />
        <div className="grid grid-cols-2 xl:grid-cols-3 gap-3">
          {EXTERNAL_CONSOLE_LINKS.map((link) => (
            <a
              key={link.key}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-start gap-3 bg-white border border-gray-200 rounded-xl p-4 hover:border-blue-300 hover:shadow-sm transition-all group"
            >
              <span className="text-xl shrink-0 mt-0.5">{link.icon}</span>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-semibold text-gray-800 group-hover:text-blue-600 transition-colors">
                    {link.name}
                  </span>
                  <span className="text-gray-300 text-xs">↗</span>
                </div>
                <p className="text-xs text-gray-500 mt-0.5">{link.description}</p>
              </div>
            </a>
          ))}
        </div>
      </section>

      {/* 2차 예정 안내 */}
      <div className="border border-dashed border-gray-200 rounded-xl p-5 text-sm text-gray-400 space-y-1">
        <p className="font-medium text-gray-500">2차 연동 예정 항목</p>
        <ul className="list-disc list-inside space-y-0.5 text-xs">
          <li>Railway 서버 비용 ($5/월 Hobby 고정) — 수동 입력 UI</li>
          <li>Supabase 플랜 / 스토리지 상세 — Management API 연동</li>
          <li>Cloudflare R2 CDN 트래픽 비용 — Cloudflare API 연동</li>
          <li>도메인 / 기타 고정비 — 수동 입력 UI</li>
          <li>월 예산 forecast — 당월 누적 × 일수 비율</li>
        </ul>
      </div>
    </div>
  );
}
