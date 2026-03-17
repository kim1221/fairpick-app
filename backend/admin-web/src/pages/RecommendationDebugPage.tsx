import { useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { debugApi } from '../services/api';
import type {
  RecommendationDebugResult,
  CategoryAffinity,
  RecentAction,
  SimulatedEvent,
  DownrankedEvent,
  SkippedEvent,
  SectionSummary,
} from '../types/recommendationDebug';

// ── 배지 컴포넌트 ──────────────────────────────────────────────────────────────

/** 시뮬레이션 섹션 배지 — 추론 결과임을 명확히 표시 */
function SimBadge() {
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-purple-100 text-purple-700 border border-purple-200">
      🔮 시뮬레이션 — 현재 추천 로직 기준 예측
    </span>
  );
}

/** 실제 이력 섹션 배지 — DB에 기록된 사실임을 명확히 표시 */
function HistoryBadge() {
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700 border border-emerald-200">
      📊 실제 노출 이력 — DB 기록 기준 (최근 7일)
    </span>
  );
}

/** 액션 타입 배지 — 한국어 표시 + 색상 구분 */
const ACTION_META: Record<string, { label: string; style: string }> = {
  impression: { label: '노출',     style: 'bg-slate-100 text-slate-500' },
  click:      { label: '클릭',     style: 'bg-blue-100 text-blue-700' },
  view:       { label: '상세보기', style: 'bg-indigo-100 text-indigo-700' },
  save:       { label: '저장',     style: 'bg-green-100 text-green-700' },
  unsave:     { label: '저장취소', style: 'bg-orange-100 text-orange-700' },
  dwell:      { label: '체류',     style: 'bg-amber-100 text-amber-700' },
  cta_click:  { label: 'CTA',      style: 'bg-pink-100 text-pink-700' },
  sheet_open: { label: '바텀시트', style: 'bg-gray-100 text-gray-500' },
};

function ActionBadge({ type }: { type: string }) {
  const meta = ACTION_META[type];
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${meta?.style ?? 'bg-gray-100 text-gray-600'}`}>
      {meta?.label ?? type}
    </span>
  );
}

function BoostBadge({ boost }: { boost: 0 | 2 | 3 }) {
  if (boost === 0) return <span className="text-gray-400 text-xs">가점 없음</span>;
  return (
    <span className={`px-1.5 py-0.5 rounded text-xs font-bold ${boost === 3 ? 'bg-orange-100 text-orange-700' : 'bg-yellow-100 text-yellow-700'}`}>
      +{boost}점
    </span>
  );
}

// ── 빈 상태 컴포넌트 ─────────────────────────────────────────────────────────

function EmptyState({ icon, title, desc }: { icon: string; title: string; desc: string }) {
  return (
    <div className="text-center py-8 px-4">
      <div className="text-3xl mb-2">{icon}</div>
      <div className="text-sm font-medium text-gray-600 mb-1">{title}</div>
      <div className="text-xs text-gray-400">{desc}</div>
    </div>
  );
}

// ── 섹션 A: 유저 정보 ──────────────────────────────────────────────────────────

function UserSection({ data }: { data: RecommendationDebugResult }) {
  const { user } = data;
  const resolvedLabels: Record<string, string> = {
    internal_id: '내부 DB ID',
    anonymous_id: '익명 ID (UUID)',
    toss_user_key: 'Toss 로그인 키',
  };
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">유저 정보</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
        <div>
          <div className="text-gray-400 text-xs mb-1">입력값</div>
          <div className="font-mono text-gray-800 break-all text-xs">{user.inputValue}</div>
        </div>
        <div>
          <div className="text-gray-400 text-xs mb-1">해석 방식</div>
          <div className="text-gray-700">{user.resolvedBy ? resolvedLabels[user.resolvedBy] : '–'}</div>
        </div>
        <div>
          <div className="text-gray-400 text-xs mb-1">유저 타입</div>
          <span className={`px-2 py-0.5 rounded text-xs font-medium ${
            user.userType === 'logged_in' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'
          }`}>
            {user.userType === 'logged_in' ? '로그인 유저' : '익명 유저'}
          </span>
        </div>
        <div>
          <div className="text-gray-400 text-xs mb-1">내부 ID</div>
          <div className="font-mono text-gray-500 text-xs break-all">{user.internalUserId}</div>
        </div>
      </div>
    </div>
  );
}

// ── 섹션 B: 취향 신호 요약 ────────────────────────────────────────────────────

function SignalsSection({ data }: { data: RecommendationDebugResult }) {
  const { signals, categoryAffinity } = data;
  const s = signals.summary;

  const summaryItems = [
    { label: '14일 클릭',       value: s.totalClicks14d,              color: 'text-blue-600' },
    { label: '3일 클릭',        value: s.recentClicks3d,              color: 'text-indigo-600' },
    { label: '현재 저장 중',    value: s.totalSaved,                  color: 'text-green-600' },
    {
      label: 'today_pick 제외',
      value: s.todayPickImpressionBlocked,
      color: s.todayPickImpressionBlocked > 0 ? 'text-orange-600' : 'text-gray-400',
      hint: '최근 3일 내 노출로 today_pick에서 제외된 이벤트 수',
    },
    {
      label: '24h 내 노출',
      value: s.recentImpressionBlocked,
      color: s.recentImpressionBlocked > 0 ? 'text-yellow-600' : 'text-gray-400',
      hint: '다른 섹션에서 24시간 내 노출돼 우선순위가 낮아진 이벤트 수',
    },
  ];

  const sectionClicks = Object.entries(signals.sectionClickCounts).sort((a, b) => b[1] - a[1]);

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">이 유저의 취향 신호</h2>

      {/* 요약 카드 */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        {summaryItems.map((item) => (
          <div key={item.label} className="bg-gray-50 rounded-lg p-3 text-center" title={item.hint}>
            <div className={`text-2xl font-bold ${item.color}`}>{item.value}</div>
            <div className="text-xs text-gray-500 mt-1 leading-tight">{item.label}</div>
          </div>
        ))}
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* 선호 카테고리 */}
        <div>
          <div className="text-xs font-semibold text-gray-400 uppercase mb-3">선호 카테고리</div>
          {categoryAffinity.length === 0 ? (
            <EmptyState icon="📭" title="카테고리 선호 데이터 없음" desc="클릭·저장 이력이 쌓이면 여기에 표시됩니다." />
          ) : (
            <div className="space-y-2.5">
              {categoryAffinity.map((ca: CategoryAffinity) => {
                const maxCount = categoryAffinity[0]?.clickCount ?? 1;
                const barWidth = Math.round((ca.clickCount / maxCount) * 100);
                return (
                  <div key={ca.category} className="flex items-center gap-3">
                    <div className="w-20 text-sm text-gray-700 truncate">{ca.category}</div>
                    <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-blue-400 rounded-full" style={{ width: `${barWidth}%` }} />
                    </div>
                    <div className="text-xs text-gray-500 w-10 text-right">{ca.clickCount}회</div>
                    <BoostBadge boost={ca.boost} />
                  </div>
                );
              })}
              <p className="text-xs text-gray-400 pt-1">
                가점 기준: 1회 이상 +2점, 3회 이상 +3점 (저장은 클릭 5회로 환산)
              </p>
            </div>
          )}
        </div>

        {/* 어떤 섹션을 눌렀나 */}
        <div>
          <div className="text-xs font-semibold text-gray-400 uppercase mb-3">어떤 추천 섹션을 눌렀나</div>
          {sectionClicks.length === 0 ? (
            <EmptyState icon="📭" title="섹션 클릭 이력 없음" desc="추천 섹션에서 이벤트를 클릭하면 기록됩니다." />
          ) : (
            <div className="space-y-1.5">
              {sectionClicks.map(([slug, count]) => (
                <div key={slug} className="flex justify-between items-center text-sm">
                  <span className="text-gray-600 font-mono text-xs">{slug}</span>
                  <span className="font-semibold text-gray-800">{count}회</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── impression 연속 묶음 처리 ─────────────────────────────────────────────────

type ActionRow =
  | { kind: 'single'; action: RecentAction }
  | { kind: 'grouped'; count: number; sectionSlug: string | null; newestAt: string };

/** 연속된 impression을 하나의 "묶음" 행으로 축약. 다른 action_type은 그대로 유지. */
function groupImpressions(actions: RecentAction[]): ActionRow[] {
  const rows: ActionRow[] = [];
  let i = 0;
  while (i < actions.length) {
    if (actions[i].actionType !== 'impression') {
      rows.push({ kind: 'single', action: actions[i] });
      i++;
    } else {
      let j = i;
      while (j < actions.length && actions[j].actionType === 'impression') j++;
      const group = actions.slice(i, j);
      if (group.length === 1) {
        rows.push({ kind: 'single', action: group[0] });
      } else {
        rows.push({
          kind: 'grouped',
          count: group.length,
          sectionSlug: group[0].sectionSlug,      // DESC order → group[0] = newest
          newestAt: group[0].createdAt,
        });
      }
      i = j;
    }
  }
  return rows;
}

// ── 섹션 C: 최근 행동 ─────────────────────────────────────────────────────────

const ACTION_FILTER_OPTIONS = [
  { value: '',           label: '전체' },
  { value: 'impression', label: '노출' },
  { value: 'click',      label: '클릭' },
  { value: 'view',       label: '상세보기' },
  { value: 'save',       label: '저장' },
  { value: 'unsave',     label: '저장취소' },
  { value: 'dwell',      label: '체류' },
  { value: 'cta_click',  label: 'CTA' },
  { value: 'sheet_open', label: '바텀시트' },
];

function RecentActionsSection({ data }: { data: RecommendationDebugResult }) {
  const [filterType, setFilterType] = useState('');

  const filtered = filterType
    ? data.recentActions.filter((a: RecentAction) => a.actionType === filterType)
    : data.recentActions;

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
          최근 행동 ({data.recentActions.length}건)
        </h2>
        {/* 액션 타입 필터 */}
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="text-xs border border-gray-200 rounded-lg px-3 py-1.5 text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-400"
        >
          {ACTION_FILTER_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      {data.recentActions.length === 0 ? (
        <EmptyState
          icon="📭"
          title="최근 행동 기록 없음"
          desc="앱에서 이벤트를 탐색하거나 저장하면 여기에 기록됩니다."
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon="🔍"
          title={`'${ACTION_FILTER_OPTIONS.find(o => o.value === filterType)?.label}' 행동 없음`}
          desc="다른 액션 타입으로 필터를 변경해 보세요."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left py-2 pr-4 text-gray-400 font-medium text-xs">시각</th>
                <th className="text-left py-2 pr-4 text-gray-400 font-medium text-xs">액션</th>
                <th className="text-left py-2 pr-4 text-gray-400 font-medium text-xs">이벤트</th>
                <th className="text-left py-2 pr-4 text-gray-400 font-medium text-xs">카테고리</th>
                <th className="text-left py-2 pr-4 text-gray-400 font-medium text-xs">섹션</th>
                <th className="text-left py-2 text-gray-400 font-medium text-xs">순위</th>
              </tr>
            </thead>
            <tbody>
              {groupImpressions(filtered).map((row, i) => {
                // ── 묶음 행 ──
                if (row.kind === 'grouped') {
                  return (
                    <tr key={`g-${i}`} className="border-b border-gray-50 bg-slate-50/70">
                      <td className="py-1.5 pr-4 text-gray-400 text-xs whitespace-nowrap">
                        {new Date(row.newestAt).toLocaleString('ko-KR', {
                          month: 'numeric', day: 'numeric',
                          hour: '2-digit', minute: '2-digit',
                        })}
                      </td>
                      <td className="py-1.5 pr-4">
                        <span className="px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-500 italic">
                          노출 {row.count}회 묶음
                        </span>
                      </td>
                      <td className="py-1.5 pr-4 text-gray-300 text-xs">–</td>
                      <td className="py-1.5 pr-4 text-gray-300 text-xs">–</td>
                      <td className="py-1.5 pr-4 font-mono text-gray-400 text-xs">{row.sectionSlug ?? '–'}</td>
                      <td className="py-1.5 text-gray-300 text-xs">–</td>
                    </tr>
                  );
                }
                // ── 단일 행 ──
                const action = row.action;
                return (
                  <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="py-2 pr-4 text-gray-500 text-xs whitespace-nowrap">
                      {new Date(action.createdAt).toLocaleString('ko-KR', {
                        month: 'numeric', day: 'numeric',
                        hour: '2-digit', minute: '2-digit',
                      })}
                    </td>
                    <td className="py-2 pr-4">
                      <ActionBadge type={action.actionType} />
                    </td>
                    <td className="py-2 pr-4 text-gray-700 max-w-[200px] truncate text-xs">
                      {action.eventTitle ?? <span className="text-gray-400">–</span>}
                    </td>
                    <td className="py-2 pr-4 text-gray-500 text-xs">{action.mainCategory ?? '–'}</td>
                    <td className="py-2 pr-4 font-mono text-gray-400 text-xs">{action.sectionSlug ?? '–'}</td>
                    <td className="py-2 text-gray-500 text-xs">{action.rankPosition ?? '–'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── 섹션 D: today_pick 시뮬레이션 ─────────────────────────────────────────────

function TodayPickSection({ data }: { data: RecommendationDebugResult }) {
  const sim = data.todayPickSimulation;
  return (
    <div className="bg-white rounded-xl border border-purple-200 p-5">
      {/* 헤더 — 시뮬레이션임을 강조 */}
      <div className="flex items-start gap-3 mb-2">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h2 className="text-base font-semibold text-gray-800">today_pick 추천 예측</h2>
            <SimBadge />
          </div>
          <p className="text-xs text-gray-400 leading-relaxed">
            이 유저의 취향·노출 이력을 적용하면 today_pick에 어떤 이벤트가 뜰지 보여줍니다.
            실제 서버 결과와 캐시·타이밍 차이가 있을 수 있습니다.
          </p>
        </div>
      </div>

      {/* 시뮬레이션 주의 안내 */}
      <div className="bg-purple-50 border border-purple-100 rounded-lg px-4 py-2.5 mb-5 text-xs text-purple-700">
        ⚠️ 이 결과는 예측값입니다. 아래 "섹션별 노출 이력"은 실제 DB에 기록된 사실입니다.
      </div>

      {/* ── 최종 예상 결과 요약 ── */}
      {sim.selected.length === 0 ? (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 mb-5">
          <div className="text-sm font-semibold text-gray-500 mb-1">🎯 최종 예상 today_pick</div>
          <p className="text-xs text-gray-400">
            노출 가능한 신선한 후보가 없습니다. 아래 "우선순위 낮춤" / "오늘은 제외" 내역을 참고하세요.
          </p>
        </div>
      ) : (
        <div className="bg-white border-2 border-purple-300 rounded-xl p-4 mb-5 shadow-sm">
          <div className="text-sm font-semibold text-purple-800 mb-3">
            🎯 최종 예상 today_pick — 상위 {Math.min(sim.selected.length, 3)}개
            <span className="ml-2 text-xs font-normal text-purple-400">
              (후보 풀 {sim.poolSize}개 중 신선한 {sim.selected.length}개 기준)
            </span>
          </div>
          <div className="space-y-1">
            {sim.selected.slice(0, 3).map((e: SimulatedEvent, i: number) => (
              <div
                key={e.id}
                className="flex items-start gap-3 cursor-pointer hover:bg-purple-50 rounded-lg px-2 py-2 -mx-2 transition-colors"
                onClick={() => document.getElementById('pool-detail')?.scrollIntoView({ behavior: 'smooth' })}
                title="클릭하면 아래 전체 후보 목록으로 이동"
              >
                <span className="text-xl leading-none mt-0.5 shrink-0">
                  {i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉'}
                </span>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-gray-900 truncate">{e.title ?? e.id}</div>
                  <div className="text-xs text-gray-500 mb-1.5">{e.category ?? '–'}</div>
                  <div className="flex flex-wrap gap-1">
                    {e.reasons.slice(0, 2).map((r, ri) => (
                      <span key={ri} className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded-full text-xs border border-purple-200">
                        {r}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
          {sim.selected.length > 3 && (
            <button
              className="text-xs text-purple-400 mt-2 pl-9 hover:text-purple-600 transition-colors block"
              onClick={() => document.getElementById('pool-detail')?.scrollIntoView({ behavior: 'smooth' })}
            >
              외 {sim.selected.length - 3}개 더 → 전체 목록 보기 ↓
            </button>
          )}
        </div>
      )}

      <p id="pool-detail" className="text-xs text-gray-400 mb-5 scroll-mt-6">─ 아래는 후보 풀 전체 분류 ─</p>

      {/* 노출 우선 */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-green-700 font-semibold text-sm">✅ 노출 우선</span>
          <span className="text-gray-400 text-xs bg-gray-100 px-2 py-0.5 rounded-full">{sim.selected.length}개</span>
          <span className="text-gray-400 text-xs">— 최근에 보지 않은 이벤트로, 추천될 가능성이 높습니다</span>
        </div>
        {sim.selected.length === 0 ? (
          <EmptyState icon="📭" title="노출 우선 이벤트 없음" desc="후보 이벤트가 모두 최근 노출·클릭 이력에 의해 후순위로 밀렸습니다." />
        ) : (
          <div className="space-y-2.5">
            {sim.selected.map((e: SimulatedEvent) => (
              <div key={e.id} className="pl-3 border-l-2 border-green-300">
                <div className="text-sm font-medium text-gray-800">{e.title ?? e.id}</div>
                <div className="text-xs text-gray-400 mb-1">{e.category}</div>
                <div className="flex flex-wrap gap-1">
                  {e.reasons.map((r, i) => (
                    <span key={i} className="px-2 py-0.5 bg-green-50 text-green-700 rounded-full text-xs border border-green-100">{r}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 우선순위 낮춤 */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-amber-700 font-semibold text-sm">⬇ 우선순위 낮춤</span>
          <span className="text-gray-400 text-xs bg-gray-100 px-2 py-0.5 rounded-full">{sim.downranked.length}개</span>
          <span className="text-gray-400 text-xs">— 최근에 본 이벤트라 뒤로 밀렸습니다. 새 이벤트가 없을 때 노출될 수 있습니다.</span>
        </div>
        {sim.downranked.length === 0 ? (
          <p className="text-gray-400 text-sm pl-3">없음</p>
        ) : (
          <div className="space-y-2.5">
            {sim.downranked.map((e: DownrankedEvent) => (
              <div key={e.id} className="pl-3 border-l-2 border-amber-300">
                <div className="text-sm font-medium text-gray-800">{e.title ?? e.id}</div>
                <div className="text-xs text-gray-400 mb-1">{e.category}</div>
                <div className="flex flex-wrap gap-1">
                  <span className="px-2 py-0.5 bg-amber-50 text-amber-700 rounded-full text-xs border border-amber-100">{e.reason}</span>
                  {e.categoryBoost && (
                    <span className="px-2 py-0.5 bg-orange-50 text-orange-600 rounded-full text-xs border border-orange-100">카테고리 가점 {e.categoryBoost}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 오늘은 제외 */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <span className="text-red-600 font-semibold text-sm">❌ 오늘은 제외</span>
          <span className="text-gray-400 text-xs bg-gray-100 px-2 py-0.5 rounded-full">{sim.skipped.length}개</span>
          <span className="text-gray-400 text-xs">— 최근 3일 내 노출 이력이 있어 오늘은 표시되지 않습니다.</span>
        </div>
        {sim.skipped.length === 0 ? (
          <p className="text-gray-400 text-sm pl-3">없음</p>
        ) : (
          <div className="space-y-2.5">
            {sim.skipped.map((e: SkippedEvent) => (
              <div key={e.id} className="pl-3 border-l-2 border-red-300">
                <div className="text-sm font-medium text-gray-800">{e.title ?? e.id}</div>
                <div className="text-xs text-gray-400 mb-1">{e.category}</div>
                <span className="px-2 py-0.5 bg-red-50 text-red-700 rounded-full text-xs border border-red-100 inline-block">{e.reason}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── 섹션 E: 섹션별 실제 노출 이력 ────────────────────────────────────────────

const SECTION_LABELS: Record<string, string> = {
  trending:    '트렌딩',
  date_pick:   '데이트픽',
  beginner:    '처음이라면',
  discovery:   '발견',
  budget_pick: '가성비',
};

function HomeSectionsSummary({ data }: { data: RecommendationDebugResult }) {
  const [activeTab, setActiveTab] = useState(data.homeSectionsSummary[0]?.sectionSlug ?? '');
  const activeSection = data.homeSectionsSummary.find((s: SectionSummary) => s.sectionSlug === activeTab);

  return (
    <div className="bg-white rounded-xl border border-emerald-200 p-5">
      {/* 헤더 — 실제 이력임을 강조 */}
      <div className="flex items-start gap-3 mb-2">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h2 className="text-base font-semibold text-gray-800">섹션별 실제 노출 이력</h2>
            <HistoryBadge />
          </div>
          <p className="text-xs text-gray-400 leading-relaxed">
            이 유저에게 최근 7일간 각 섹션에서 실제로 노출된 이벤트입니다.
            시뮬레이션이 아닌 DB에 기록된 impression 로그 기준입니다.
          </p>
        </div>
      </div>

      {/* 실제 이력 안내 */}
      <div className="bg-emerald-50 border border-emerald-100 rounded-lg px-4 py-2.5 mb-5 text-xs text-emerald-700">
        ✅ 이 결과는 실제 기록입니다. 위의 "today_pick 추천 예측"과 다를 수 있습니다.
      </div>

      {/* 탭 */}
      <div className="flex flex-wrap gap-1 mb-4 border-b border-gray-100 pb-2">
        {data.homeSectionsSummary.map((s: SectionSummary) => (
          <button
            key={s.sectionSlug}
            onClick={() => setActiveTab(s.sectionSlug)}
            className={`px-3 py-1.5 rounded-t text-sm font-medium transition-colors ${
              activeTab === s.sectionSlug
                ? 'bg-emerald-50 text-emerald-700 border-b-2 border-emerald-500'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {SECTION_LABELS[s.sectionSlug] ?? s.sectionSlug}
            <span className={`ml-1 text-xs ${s.recentlyShown.length === 0 ? 'text-gray-300' : 'text-gray-400'}`}>
              ({s.recentlyShown.length})
            </span>
          </button>
        ))}
      </div>

      {/* 탭 콘텐츠 */}
      {activeSection && activeSection.recentlyShown.length === 0 ? (
        <EmptyState
          icon="📭"
          title="최근 7일간 노출 이력 없음"
          desc="앱 홈 화면을 열면 이 섹션의 노출 기록이 쌓입니다."
        />
      ) : (
        <div className="space-y-3">
          {activeSection?.recentlyShown.map((e) => (
            <div key={e.id} className="pl-3 border-l-2 border-emerald-200">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-sm font-medium text-gray-800">{e.title ?? e.id}</div>
                  <div className="text-xs text-gray-400">{e.category}</div>
                </div>
                <div className="text-right text-xs text-gray-400 ml-4 shrink-0">
                  <div className="font-medium">{e.impressionCount}회 노출</div>
                  <div>{new Date(e.lastShownAt).toLocaleDateString('ko-KR')}</div>
                </div>
              </div>
              <div className="flex flex-wrap gap-1 mt-1.5">
                {e.representativeReasons.map((r, i) => (
                  <span key={i} className="px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded-full text-xs border border-emerald-100">{r}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── 메인 페이지 ───────────────────────────────────────────────────────────────

export default function RecommendationDebugPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const urlUserId = searchParams.get('userId') ?? '';

  const [inputValue, setInputValue] = useState(urlUserId);
  const [queryUserId, setQueryUserId] = useState(urlUserId);
  const [showErrorDetail, setShowErrorDetail] = useState(false);

  const { data, isLoading, isError, error } = useQuery<RecommendationDebugResult>({
    queryKey: ['debug-recommendation', queryUserId],
    queryFn: () => debugApi.getRecommendation(queryUserId),
    enabled: !!queryUserId,
    staleTime: 30_000,
  });

  const handleSearch = () => {
    const trimmed = inputValue.trim();
    if (trimmed) setQueryUserId(trimmed);
  };

  const handleClear = () => {
    setInputValue('');
    setQueryUserId('');
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* 헤더 */}
      <div>
        <button
          onClick={() =>
            navigate(
              queryUserId
                ? `/personalization?userId=${encodeURIComponent(queryUserId)}`
                : '/personalization'
            )
          }
          className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-700 mb-2 transition-colors"
        >
          ← 개인화 관제로 돌아가기
          {queryUserId && (
            <span className="ml-1 font-mono text-gray-300">(userId 필터 유지)</span>
          )}
        </button>
        <h1 className="text-2xl font-bold text-gray-900">추천 디버그</h1>
        <p className="text-gray-500 text-sm mt-1">
          특정 유저의 취향 신호와 today_pick 반영 상태를 확인합니다.
        </p>
      </div>

      {/* 검색 */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <label className="block text-sm font-medium text-gray-700 mb-2">유저 ID 조회</label>
        <div className="flex gap-3">
          <div className="relative flex-1">
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              placeholder="익명 ID · Toss 로그인 키 · 내부 DB ID 모두 가능"
              className="w-full px-4 py-2.5 pr-10 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {inputValue && (
              <button
                onClick={handleClear}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-lg leading-none"
                title="초기화"
              >
                ×
              </button>
            )}
          </div>
          <button
            onClick={handleSearch}
            disabled={!inputValue.trim() || isLoading}
            className="px-6 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
          >
            {isLoading ? '조회 중...' : '조회'}
          </button>
        </div>
        <p className="text-xs text-gray-400 mt-2">
          개인화 관제 → 최근 이벤트에서 userId 값을 복사해 바로 붙여넣을 수 있습니다.
        </p>
      </div>

      {/* 미입력 안내 */}
      {!queryUserId && !isLoading && (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-8 text-center">
          <div className="text-4xl mb-3">🔍</div>
          <div className="text-sm font-medium text-gray-600 mb-1">유저 ID를 입력하고 조회하세요</div>
          <div className="text-xs text-gray-400">
            개인화 관제 화면의 최근 이벤트 테이블에서 userId를 복사할 수 있습니다.
          </div>
        </div>
      )}

      {/* API 에러 */}
      {isError && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <div className="text-red-700 text-sm font-medium mb-1">조회 중 오류가 발생했습니다. 잠시 후 다시 시도하세요.</div>
          <button
            onClick={() => setShowErrorDetail(!showErrorDetail)}
            className="text-xs text-red-500 underline"
          >
            {showErrorDetail ? '상세 숨기기' : '오류 상세 보기'}
          </button>
          {showErrorDetail && (
            <pre className="mt-2 text-xs text-red-400 bg-red-50 rounded p-2 overflow-auto">
              {(error as Error)?.message ?? '알 수 없는 오류'}
            </pre>
          )}
        </div>
      )}

      {/* 유저 없음 */}
      {data && !data.user.found && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-5">
          <div className="text-yellow-800 text-sm font-medium mb-1">
            입력한 ID로 유저를 찾지 못했습니다.
          </div>
          <div className="text-yellow-700 text-xs">
            입력값: <code className="font-mono bg-yellow-100 px-1 rounded">{data.user.inputValue}</code>
          </div>
          <div className="text-yellow-600 text-xs mt-2">
            UUID 형식의 익명 ID, Toss 로그인 키, 내부 DB ID 중 하나를 입력하세요.
            개인화 관제 화면에서 실제 유저 ID를 확인할 수 있습니다.
          </div>
        </div>
      )}

      {/* 결과 */}
      {data && data.user.found && (
        <>
          <UserSection data={data} />
          <SignalsSection data={data} />
          <RecentActionsSection data={data} />
          <TodayPickSection data={data} />
          <HomeSectionsSummary data={data} />
        </>
      )}
    </div>
  );
}
