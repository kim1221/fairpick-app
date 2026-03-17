import { useState } from 'react';
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

function SimBadge() {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-purple-100 text-purple-700">
      🔮 시뮬레이션 · 현재 로직 기준
    </span>
  );
}

function HistoryBadge() {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700">
      📊 실제 노출 이력 · 최근 7일
    </span>
  );
}

function ActionBadge({ type }: { type: string }) {
  const styles: Record<string, string> = {
    click: 'bg-blue-100 text-blue-700',
    impression: 'bg-gray-100 text-gray-600',
    view: 'bg-indigo-100 text-indigo-700',
    save: 'bg-green-100 text-green-700',
    unsave: 'bg-orange-100 text-orange-700',
    dwell: 'bg-yellow-100 text-yellow-700',
    cta_click: 'bg-pink-100 text-pink-700',
    sheet_open: 'bg-slate-100 text-slate-600',
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${styles[type] ?? 'bg-gray-100 text-gray-600'}`}>
      {type}
    </span>
  );
}

function BoostBadge({ boost }: { boost: 0 | 2 | 3 }) {
  if (boost === 0) return <span className="text-gray-400 text-xs">–</span>;
  return (
    <span className={`px-1.5 py-0.5 rounded text-xs font-bold ${boost === 3 ? 'bg-orange-100 text-orange-700' : 'bg-yellow-100 text-yellow-700'}`}>
      +{boost}
    </span>
  );
}

// ── 섹션 A: 유저 정보 ──────────────────────────────────────────────────────────

function UserSection({ data }: { data: RecommendationDebugResult }) {
  const { user } = data;
  const resolvedLabels: Record<string, string> = {
    internal_id: '내부 DB ID',
    anonymous_id: '익명 ID',
    toss_user_key: 'Toss 로그인 키',
  };
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">유저 정보</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
        <div>
          <div className="text-gray-400 text-xs mb-1">입력값</div>
          <div className="font-mono text-gray-800 break-all">{user.inputValue}</div>
        </div>
        <div>
          <div className="text-gray-400 text-xs mb-1">해석 방식</div>
          <div className="text-gray-700">{user.resolvedBy ? resolvedLabels[user.resolvedBy] : '–'}</div>
        </div>
        <div>
          <div className="text-gray-400 text-xs mb-1">유저 타입</div>
          <span className={`px-2 py-0.5 rounded text-xs font-medium ${user.userType === 'logged_in' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
            {user.userType === 'logged_in' ? '로그인' : '익명'}
          </span>
        </div>
        <div>
          <div className="text-gray-400 text-xs mb-1">내부 ID</div>
          <div className="font-mono text-gray-600 text-xs break-all">{user.internalUserId}</div>
        </div>
      </div>
    </div>
  );
}

// ── 섹션 B: 추천 신호 요약 ─────────────────────────────────────────────────────

function SignalsSection({ data }: { data: RecommendationDebugResult }) {
  const { signals, categoryAffinity } = data;
  const s = signals.summary;

  const summaryItems = [
    { label: '14일 클릭', value: s.totalClicks14d, color: 'text-blue-600' },
    { label: '3일 클릭', value: s.recentClicks3d, color: 'text-indigo-600' },
    { label: '저장 중', value: s.totalSaved, color: 'text-green-600' },
    { label: 'today_pick 차단', value: s.todayPickImpressionBlocked, color: s.todayPickImpressionBlocked > 0 ? 'text-orange-600' : 'text-gray-400' },
    { label: '24h 노출 차단', value: s.recentImpressionBlocked, color: s.recentImpressionBlocked > 0 ? 'text-yellow-600' : 'text-gray-400' },
  ];

  const sectionClicks = Object.entries(signals.sectionClickCounts).sort((a, b) => b[1] - a[1]);

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">추천 신호 요약</h2>

      {/* 요약 카드 */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        {summaryItems.map((item) => (
          <div key={item.label} className="bg-gray-50 rounded-lg p-3 text-center">
            <div className={`text-2xl font-bold ${item.color}`}>{item.value}</div>
            <div className="text-xs text-gray-500 mt-1">{item.label}</div>
          </div>
        ))}
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* 카테고리 친화도 */}
        <div>
          <div className="text-xs font-semibold text-gray-400 uppercase mb-3">카테고리 친화도</div>
          {categoryAffinity.length === 0 ? (
            <p className="text-gray-400 text-sm">클릭 이력 없음</p>
          ) : (
            <div className="space-y-2">
              {categoryAffinity.map((ca: CategoryAffinity) => {
                const maxCount = categoryAffinity[0]?.clickCount ?? 1;
                const barWidth = Math.round((ca.clickCount / maxCount) * 100);
                return (
                  <div key={ca.category} className="flex items-center gap-3">
                    <div className="w-20 text-sm text-gray-700 truncate">{ca.category}</div>
                    <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-400 rounded-full"
                        style={{ width: `${barWidth}%` }}
                      />
                    </div>
                    <div className="text-xs text-gray-500 w-10 text-right">{ca.clickCount}회</div>
                    <BoostBadge boost={ca.boost} />
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 섹션 클릭 */}
        <div>
          <div className="text-xs font-semibold text-gray-400 uppercase mb-3">섹션별 클릭</div>
          {sectionClicks.length === 0 ? (
            <p className="text-gray-400 text-sm">클릭 이력 없음</p>
          ) : (
            <div className="space-y-1.5">
              {sectionClicks.map(([slug, count]) => (
                <div key={slug} className="flex justify-between text-sm">
                  <span className="text-gray-600 font-mono">{slug}</span>
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

// ── 섹션 C: 최근 행동 ─────────────────────────────────────────────────────────

function RecentActionsSection({ data }: { data: RecommendationDebugResult }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4">최근 행동 (20건)</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="text-left py-2 pr-4 text-gray-400 font-medium">시각</th>
              <th className="text-left py-2 pr-4 text-gray-400 font-medium">액션</th>
              <th className="text-left py-2 pr-4 text-gray-400 font-medium">이벤트</th>
              <th className="text-left py-2 pr-4 text-gray-400 font-medium">카테고리</th>
              <th className="text-left py-2 pr-4 text-gray-400 font-medium">섹션</th>
              <th className="text-left py-2 text-gray-400 font-medium">rank</th>
            </tr>
          </thead>
          <tbody>
            {data.recentActions.map((action: RecentAction, i: number) => (
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
                <td className="py-2 pr-4 text-gray-700 max-w-[200px] truncate">
                  {action.eventTitle ?? <span className="text-gray-400">–</span>}
                </td>
                <td className="py-2 pr-4 text-gray-500">{action.mainCategory ?? '–'}</td>
                <td className="py-2 pr-4 font-mono text-gray-500 text-xs">{action.sectionSlug ?? '–'}</td>
                <td className="py-2 text-gray-500">{action.rankPosition ?? '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.recentActions.length === 0 && (
          <p className="text-gray-400 text-sm py-4">행동 이력 없음</p>
        )}
      </div>
    </div>
  );
}

// ── 섹션 D: today_pick 시뮬레이션 ─────────────────────────────────────────────

function TodayPickSection({ data }: { data: RecommendationDebugResult }) {
  const sim = data.todayPickSimulation;
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center gap-3 mb-1">
        <h2 className="text-base font-semibold text-gray-800">today_pick 시뮬레이션</h2>
        <SimBadge />
      </div>
      <p className="text-xs text-gray-400 mb-5">
        현재 추천 로직(impression dedup · 카테고리 친화도)을 이 유저 신호에 적용한 결과입니다.
        실제 서버 응답과 캐시·타이밍 차이가 있을 수 있습니다.
      </p>
      <p className="text-xs text-gray-500 mb-4">풀 크기: {sim.poolSize}개</p>

      {/* 선택됨 */}
      <div className="mb-5">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-green-600 font-bold text-sm">✅ 선택됨</span>
          <span className="text-gray-400 text-xs">({sim.selected.length}개)</span>
        </div>
        {sim.selected.length === 0 ? (
          <p className="text-gray-400 text-sm pl-2">없음</p>
        ) : (
          <div className="space-y-2">
            {sim.selected.map((e: SimulatedEvent) => (
              <div key={e.id} className="pl-2 border-l-2 border-green-300">
                <div className="text-sm font-medium text-gray-800">{e.title ?? e.id}</div>
                <div className="text-xs text-gray-400">{e.category}</div>
                <div className="flex flex-wrap gap-1 mt-1">
                  {e.reasons.map((r, i) => (
                    <span key={i} className="px-1.5 py-0.5 bg-green-50 text-green-700 rounded text-xs">{r}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 후순위 */}
      <div className="mb-5">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-yellow-600 font-bold text-sm">⬇ 후순위 (downranked)</span>
          <span className="text-gray-400 text-xs">({sim.downranked.length}개) — 풀 안에 있지만 뒤로 밀림</span>
        </div>
        {sim.downranked.length === 0 ? (
          <p className="text-gray-400 text-sm pl-2">없음</p>
        ) : (
          <div className="space-y-2">
            {sim.downranked.map((e: DownrankedEvent) => (
              <div key={e.id} className="pl-2 border-l-2 border-yellow-300">
                <div className="text-sm font-medium text-gray-800">{e.title ?? e.id}</div>
                <div className="text-xs text-gray-400">{e.category}</div>
                <div className="flex flex-wrap gap-1 mt-1">
                  <span className="px-1.5 py-0.5 bg-yellow-50 text-yellow-700 rounded text-xs">{e.reason}</span>
                  {e.categoryBoost && (
                    <span className="px-1.5 py-0.5 bg-orange-50 text-orange-600 rounded text-xs">카테고리 {e.categoryBoost}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 완전 제외 */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-red-600 font-bold text-sm">❌ 완전 제외 (skipped)</span>
          <span className="text-gray-400 text-xs">({sim.skipped.length}개) — 풀에서 아예 제외됨</span>
        </div>
        {sim.skipped.length === 0 ? (
          <p className="text-gray-400 text-sm pl-2">없음</p>
        ) : (
          <div className="space-y-2">
            {sim.skipped.map((e: SkippedEvent) => (
              <div key={e.id} className="pl-2 border-l-2 border-red-300">
                <div className="text-sm font-medium text-gray-800">{e.title ?? e.id}</div>
                <div className="text-xs text-gray-400">{e.category}</div>
                <span className="inline-block mt-1 px-1.5 py-0.5 bg-red-50 text-red-700 rounded text-xs">{e.reason}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── 섹션 E: 섹션별 최근 노출 이력 ────────────────────────────────────────────

const SECTION_LABELS: Record<string, string> = {
  trending: '트렌딩',
  date_pick: '데이트픽',
  beginner: '처음이라면',
  discovery: '발견',
  budget_pick: '가성비',
};

function HomeSectionsSummary({ data }: { data: RecommendationDebugResult }) {
  const [activeTab, setActiveTab] = useState(data.homeSectionsSummary[0]?.sectionSlug ?? '');
  const activeSection = data.homeSectionsSummary.find((s: SectionSummary) => s.sectionSlug === activeTab);

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center gap-3 mb-1">
        <h2 className="text-base font-semibold text-gray-800">섹션별 노출 이력</h2>
        <HistoryBadge />
      </div>
      <p className="text-xs text-gray-400 mb-4">
        이 유저에게 최근 7일간 각 섹션에서 실제로 노출된 이벤트입니다.
        시뮬레이션이 아닌 DB에 기록된 impression 이력 기준입니다.
      </p>

      {/* 탭 */}
      <div className="flex gap-1 mb-4 border-b border-gray-100 pb-1">
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
            <span className="ml-1 text-xs text-gray-400">({s.recentlyShown.length})</span>
          </button>
        ))}
      </div>

      {/* 탭 콘텐츠 */}
      {activeSection && activeSection.recentlyShown.length === 0 ? (
        <p className="text-gray-400 text-sm">최근 7일 노출 이력 없음</p>
      ) : (
        <div className="space-y-3">
          {activeSection?.recentlyShown.map((e) => (
            <div key={e.id} className="pl-2 border-l-2 border-emerald-200">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-sm font-medium text-gray-800">{e.title ?? e.id}</div>
                  <div className="text-xs text-gray-400">{e.category}</div>
                </div>
                <div className="text-right text-xs text-gray-400 ml-4 shrink-0">
                  <div>{e.impressionCount}회 노출</div>
                  <div>{new Date(e.lastShownAt).toLocaleDateString('ko-KR')}</div>
                </div>
              </div>
              <div className="flex flex-wrap gap-1 mt-1">
                {e.representativeReasons.map((r, i) => (
                  <span key={i} className="px-1.5 py-0.5 bg-emerald-50 text-emerald-700 rounded text-xs">{r}</span>
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
  const [inputValue, setInputValue] = useState('');
  const [queryUserId, setQueryUserId] = useState('');

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

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* 헤더 */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">추천 디버그</h1>
        <p className="text-gray-500 text-sm mt-1">
          특정 유저의 추천 신호와 today_pick 반영 상태를 확인합니다.
        </p>
      </div>

      {/* 검색 */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <label className="block text-sm font-medium text-gray-700 mb-2">userId 입력</label>
        <div className="flex gap-3">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="internal id / anonymous_id / toss_user_key 모두 가능"
            className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={handleSearch}
            disabled={!inputValue.trim() || isLoading}
            className="px-6 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isLoading ? '조회 중...' : '조회'}
          </button>
        </div>
        <p className="text-xs text-gray-400 mt-2">
          personalization 관제 화면의 raw sample에서 복사한 값을 그대로 붙여넣을 수 있습니다.
        </p>
      </div>

      {/* 에러 */}
      {isError && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">
          조회 실패: {(error as Error)?.message ?? '알 수 없는 오류'}
        </div>
      )}

      {/* 유저 없음 */}
      {data && !data.user.found && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 text-yellow-800 text-sm">
          userId <code className="font-mono">{data.user.inputValue}</code> 에 해당하는 유저를 찾을 수 없습니다.
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
