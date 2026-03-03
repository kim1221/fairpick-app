import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { curationApi, type CurationTheme } from '../services/api';

// ─────────────────────────────────────────────────────────────
// 유틸: filter_config → 사람이 읽기 쉬운 설명
// ─────────────────────────────────────────────────────────────
function describeFilter(config: Record<string, any>): string {
  const type = config.type as string;
  switch (type) {
    case 'featured':    return '에디터가 직접 고른 추천 이벤트';
    case 'ending_soon': return `${config.days ?? 7}일 이내 마감 이벤트 · 마감순 정렬`;
    case 'trending':    return 'buzz_score 기준 인기 급상승 이벤트';
    case 'category':    return `카테고리: ${(config.categories as string[]).join(', ')} · ${config.sort === 'buzz_score' ? '인기순' : '최신순'}`;
    case 'weekend':     return '이번 주말 열리는 이벤트';
    case 'free':        return '무료 입장 이벤트 · 조회수순';
    case 'latest':      return '최근 등록된 이벤트 · 등록순';
    default:            return JSON.stringify(config);
  }
}

// ─────────────────────────────────────────────────────────────
// 유틸: slug → 이모지
// ─────────────────────────────────────────────────────────────
const SLUG_EMOJI: Record<string, string> = {
  today_pick:   '⭐️',
  ending_soon:  '🔥',
  trending:     '📈',
  exhibition:   '🖼️',
  this_weekend: '🗓️',
  free_events:  '🎁',
  popup_hot:    '🛍️',
  new_arrival:  '✨',
};

// ─────────────────────────────────────────────────────────────
// 인라인 편집 가능한 텍스트 컴포넌트
// ─────────────────────────────────────────────────────────────
function EditableText({
  value,
  onSave,
  className = '',
  placeholder = '',
}: {
  value: string;
  onSave: (v: string) => void;
  className?: string;
  placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  const commit = () => {
    if (draft.trim() !== value) onSave(draft.trim());
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        autoFocus
        className={`border border-blue-400 rounded-md px-2 py-0.5 focus:outline-none focus:ring-2 focus:ring-blue-300 ${className}`}
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') { setDraft(value); setEditing(false); }
        }}
      />
    );
  }

  return (
    <span
      className={`cursor-pointer hover:bg-blue-50 rounded px-1 -mx-1 transition-colors group ${className}`}
      onClick={() => { setDraft(value); setEditing(true); }}
      title="클릭해서 수정"
    >
      {value || <span className="text-gray-400 italic">{placeholder}</span>}
      <span className="ml-1 text-gray-300 group-hover:text-blue-400 text-xs">✏️</span>
    </span>
  );
}

// ─────────────────────────────────────────────────────────────
// 토글 스위치
// ─────────────────────────────────────────────────────────────
function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 focus:outline-none ${
        checked ? 'bg-green-500' : 'bg-gray-300'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-200 ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  );
}

// ─────────────────────────────────────────────────────────────
// 테마 카드
// ─────────────────────────────────────────────────────────────
function ThemeCard({
  theme,
  index,
  total,
  onUpdate,
  onMoveUp,
  onMoveDown,
}: {
  theme: CurationTheme;
  index: number;
  total: number;
  onUpdate: (id: string, updates: Partial<CurationTheme>) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const emoji = SLUG_EMOJI[theme.slug] ?? '📌';

  return (
    <div
      className={`bg-white rounded-2xl border transition-all duration-200 ${
        theme.is_active
          ? 'border-gray-200 shadow-sm hover:shadow-md'
          : 'border-dashed border-gray-300 opacity-60'
      }`}
    >
      <div className="p-5">
        {/* 상단 행: 순서 이동 + 이모지 + 제목 + 토글 */}
        <div className="flex items-start gap-3">
          {/* 순서 번호 + 이동 버튼 */}
          <div className="flex flex-col items-center gap-0.5 pt-0.5">
            <button
              onClick={onMoveUp}
              disabled={index === 0}
              className="w-6 h-6 flex items-center justify-center rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
              title="위로"
            >
              ↑
            </button>
            <span className="text-xs font-bold text-gray-400 leading-none">{index + 1}</span>
            <button
              onClick={onMoveDown}
              disabled={index === total - 1}
              className="w-6 h-6 flex items-center justify-center rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
              title="아래로"
            >
              ↓
            </button>
          </div>

          {/* 이모지 */}
          <div className="text-3xl select-none">{emoji}</div>

          {/* 제목/부제목 */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <EditableText
                value={theme.title}
                onSave={(v) => onUpdate(theme.id, { title: v })}
                className="text-base font-bold text-gray-900"
                placeholder="섹션 제목"
              />
              {!theme.is_active && (
                <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-500 rounded-full font-medium">
                  숨김
                </span>
              )}
              {theme.use_vector_rerank && (
                <span className="text-xs px-2 py-0.5 bg-purple-100 text-purple-700 rounded-full font-medium">
                  🤖 AI 리랭킹
                </span>
              )}
            </div>
            <EditableText
              value={theme.subtitle ?? ''}
              onSave={(v) => onUpdate(theme.id, { subtitle: v })}
              className="text-sm text-gray-500 mt-0.5 block"
              placeholder="부제목 입력..."
            />
          </div>

          {/* 활성/비활성 토글 */}
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs text-gray-500">{theme.is_active ? '표시 중' : '숨김'}</span>
            <Toggle
              checked={theme.is_active}
              onChange={(v) => onUpdate(theme.id, { is_active: v })}
            />
          </div>
        </div>

        {/* 하단: 필터 설명 + 노출 개수 */}
        <div className="mt-4 flex items-center gap-3 flex-wrap">
          {/* 필터 설명 */}
          <div className="flex-1 min-w-0 bg-gray-50 rounded-xl px-4 py-2.5">
            <div className="text-xs text-gray-400 mb-0.5 font-medium uppercase tracking-wide">필터 조건</div>
            <div className="text-sm text-gray-700">{describeFilter(theme.filter_config)}</div>
          </div>

          {/* 최대 노출 개수 */}
          <div className="bg-blue-50 rounded-xl px-4 py-2.5 text-center shrink-0">
            <div className="text-xs text-blue-400 mb-0.5 font-medium uppercase tracking-wide">최대 노출</div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => onUpdate(theme.id, { max_items: Math.max(1, theme.max_items - 1) })}
                className="w-6 h-6 rounded-full bg-blue-100 hover:bg-blue-200 text-blue-600 font-bold flex items-center justify-center transition-colors"
              >
                −
              </button>
              <span className="text-lg font-bold text-blue-700 w-7 text-center">{theme.max_items}</span>
              <button
                onClick={() => onUpdate(theme.id, { max_items: Math.min(30, theme.max_items + 1) })}
                className="w-6 h-6 rounded-full bg-blue-100 hover:bg-blue-200 text-blue-600 font-bold flex items-center justify-center transition-colors"
              >
                +
              </button>
            </div>
          </div>

          {/* AI 리랭킹 토글 */}
          <div className="bg-purple-50 rounded-xl px-4 py-2.5 shrink-0">
            <div className="text-xs text-purple-400 mb-1.5 font-medium uppercase tracking-wide">AI 리랭킹</div>
            <div className="flex items-center gap-2">
              <Toggle
                checked={theme.use_vector_rerank}
                onChange={(v) => onUpdate(theme.id, { use_vector_rerank: v })}
              />
              <span className="text-xs text-purple-600 font-medium">
                {theme.use_vector_rerank ? 'ON' : 'OFF'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 메인 페이지
// ─────────────────────────────────────────────────────────────
export default function CurationThemesPage() {
  const queryClient = useQueryClient();
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const { data: themes = [], isLoading } = useQuery({
    queryKey: ['curation-themes'],
    queryFn: curationApi.getThemes,
  });

  // 로컬 순서 상태 (서버 응답 전 즉각 UI 반영)
  const [localThemes, setLocalThemes] = useState<CurationTheme[] | null>(null);
  const displayed = localThemes ?? themes;

  const updateMutation = useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Partial<CurationTheme> }) =>
      curationApi.updateTheme(id, updates),
    onSuccess: (updated) => {
      queryClient.setQueryData<CurationTheme[]>(['curation-themes'], (prev) =>
        prev ? prev.map((t) => (t.id === updated.id ? updated : t)) : [updated]
      );
      setLocalThemes(null);
      flash('저장됐어요 ✓');
    },
  });

  const reorderMutation = useMutation({
    mutationFn: curationApi.reorder,
    onSuccess: (updated) => {
      queryClient.setQueryData(['curation-themes'], updated);
      setLocalThemes(null);
      flash('순서 저장됐어요 ✓');
    },
  });

  function flash(msg: string) {
    setSaveMsg(msg);
    setTimeout(() => setSaveMsg(null), 2000);
  }

  function handleUpdate(id: string, updates: Partial<CurationTheme>) {
    // 낙관적 업데이트
    setLocalThemes((prev) =>
      (prev ?? themes).map((t) => (t.id === id ? { ...t, ...updates } : t))
    );
    updateMutation.mutate({ id, updates });
  }

  function handleMove(index: number, direction: 'up' | 'down') {
    const arr = [...displayed];
    const target = direction === 'up' ? index - 1 : index + 1;
    if (target < 0 || target >= arr.length) return;

    [arr[index], arr[target]] = [arr[target], arr[index]];
    const reordered = arr.map((t, i) => ({ ...t, display_order: i + 1 }));
    setLocalThemes(reordered);

    reorderMutation.mutate(
      reordered.map((t) => ({ id: t.id, display_order: t.display_order }))
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-500 mx-auto mb-3" />
          <p className="text-gray-500 text-sm">불러오는 중...</p>
        </div>
      </div>
    );
  }

  const activeCount = displayed.filter((t) => t.is_active).length;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* 헤더 */}
      <div className="flex items-end justify-between">
        <div>
          <h2 className="text-3xl font-bold text-gray-900">홈 큐레이션</h2>
          <p className="text-gray-500 mt-1.5">
            앱 홈 화면에 표시되는 섹션을 관리해요.{' '}
            <span className="font-semibold text-blue-600">{activeCount}개</span> 섹션이 지금 보여지고 있어요.
          </p>
        </div>

        {/* 저장 알림 */}
        <div
          className={`transition-all duration-300 text-sm font-medium px-4 py-2 rounded-xl ${
            saveMsg
              ? 'opacity-100 bg-green-50 text-green-700'
              : 'opacity-0 pointer-events-none'
          }`}
        >
          {saveMsg ?? '저장됐어요 ✓'}
        </div>
      </div>

      {/* 안내 카드 */}
      <div className="bg-blue-50 border border-blue-100 rounded-2xl px-5 py-4 flex gap-3">
        <div className="text-2xl">💡</div>
        <div className="text-sm text-blue-700 leading-relaxed">
          <strong>사용 방법</strong><br />
          • 제목·부제목을 <strong>클릭하면 바로 수정</strong>할 수 있어요<br />
          • ↑↓ 버튼으로 섹션 <strong>순서를 바꾸면 앱 홈에 즉시 반영</strong>돼요<br />
          • 토글을 끄면 해당 섹션이 <strong>홈 화면에서 숨겨져요</strong><br />
          • AI 리랭킹은 유저 취향 데이터가 쌓이면 효과가 나타나요 (배포 초기엔 OFF 권장)
        </div>
      </div>

      {/* 섹션 카드 목록 */}
      <div className="space-y-3">
        {displayed.map((theme, index) => (
          <ThemeCard
            key={theme.id}
            theme={theme}
            index={index}
            total={displayed.length}
            onUpdate={handleUpdate}
            onMoveUp={() => handleMove(index, 'up')}
            onMoveDown={() => handleMove(index, 'down')}
          />
        ))}
      </div>

      {/* 하단 통계 */}
      <div className="grid grid-cols-3 gap-4 pt-2">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 text-center">
          <div className="text-3xl font-bold text-gray-900">{displayed.length}</div>
          <div className="text-sm text-gray-500 mt-1">전체 섹션</div>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 text-center">
          <div className="text-3xl font-bold text-green-600">{activeCount}</div>
          <div className="text-sm text-gray-500 mt-1">표시 중</div>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 text-center">
          <div className="text-3xl font-bold text-purple-600">
            {displayed.filter((t) => t.use_vector_rerank).length}
          </div>
          <div className="text-sm text-gray-500 mt-1">AI 리랭킹 ON</div>
        </div>
      </div>
    </div>
  );
}
