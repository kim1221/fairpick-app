import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { curationApi, type CreateThemeInput, type PreviewResult } from '../services/api';

// ─────────────────────────────────────────────────────────────
// 유틸
// ─────────────────────────────────────────────────────────────
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_가-힣]/g, '')
    .slice(0, 40);
}

const SORT_OPTIONS = [
  { value: 'buzz_score', label: '인기순' },
  { value: 'created_at', label: '최신 등록순' },
  { value: 'end_at',     label: '마감임박순' },
  { value: 'start_at',   label: '오픈일 빠른순' },
  { value: 'view_count', label: '조회수순' },
  { value: 'price_min',  label: '가격 낮은순' },
];

const PRICE_PRESETS = [
  { label: '무료', value: 0 },
  { label: '5천원', value: 5000 },
  { label: '1만원', value: 10000 },
  { label: '3만원', value: 30000 },
];

const OPEN_DAY_PRESETS = [
  { label: '오늘', value: 1 },
  { label: '3일', value: 3 },
  { label: '7일', value: 7 },
  { label: '14일', value: 14 },
];

const EMOJI_LIST = ['📌','🎪','🎨','🎭','🎬','🎤','🎮','🛍️','☕','🌿','🌸','🏃','✈️','🔥','⭐','💫','🎁','🗓️','📸','🏛️','🍀','🎯','🌊','🦋','🎠'];

// ─────────────────────────────────────────────────────────────
// 멀티셀렉트 컴포넌트
// ─────────────────────────────────────────────────────────────
function MultiSelect({
  label,
  options,
  selected,
  onChange,
  placeholder = '선택하세요...',
}: {
  label: string;
  options: string[];
  selected: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  const filtered = options.filter(o => o.toLowerCase().includes(search.toLowerCase()));
  const toggle = (v: string) => onChange(selected.includes(v) ? selected.filter(x => x !== v) : [...selected, v]);

  return (
    <div ref={ref} className="relative">
      <label className="block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wide">{label}</label>
      <div
        className="min-h-[40px] border border-gray-200 rounded-xl px-3 py-2 cursor-pointer flex flex-wrap gap-1.5 bg-white hover:border-blue-300 transition-colors"
        onClick={() => setOpen(!open)}
      >
        {selected.length === 0 ? (
          <span className="text-gray-400 text-sm self-center">{placeholder}</span>
        ) : (
          selected.map(v => (
            <span key={v} className="inline-flex items-center gap-1 bg-blue-100 text-blue-700 text-xs px-2 py-0.5 rounded-full font-medium">
              {v}
              <button onClick={e => { e.stopPropagation(); toggle(v); }} className="hover:text-blue-900">×</button>
            </span>
          ))
        )}
      </div>
      {open && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg max-h-52 overflow-hidden flex flex-col">
          <div className="p-2 border-b border-gray-100">
            <input
              autoFocus
              className="w-full text-sm px-2 py-1 border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-300"
              placeholder="검색..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              onClick={e => e.stopPropagation()}
            />
          </div>
          <div className="overflow-y-auto">
            {filtered.map(o => (
              <div
                key={o}
                className={`px-3 py-2 text-sm cursor-pointer hover:bg-blue-50 flex items-center gap-2 ${selected.includes(o) ? 'bg-blue-50 font-medium text-blue-700' : 'text-gray-700'}`}
                onClick={e => { e.stopPropagation(); toggle(o); }}
              >
                <span className={`w-4 h-4 rounded border flex items-center justify-center text-xs flex-shrink-0 ${selected.includes(o) ? 'bg-blue-500 border-blue-500 text-white' : 'border-gray-300'}`}>
                  {selected.includes(o) ? '✓' : ''}
                </span>
                {o}
              </div>
            ))}
            {filtered.length === 0 && <div className="px-3 py-4 text-sm text-gray-400 text-center">결과 없음</div>}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 메인 모달
// ─────────────────────────────────────────────────────────────
interface Props {
  onClose: () => void;
  onCreated: () => void;
}

export default function CreateThemeModal({ onClose, onCreated }: Props) {
  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [emoji, setEmoji] = useState('📌');

  // 필터 조건
  const [categories, setCategories] = useState<string[]>([]);
  const [regions, setRegions] = useState<string[]>([]);
  const [zones, setZones] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [isFree, setIsFree] = useState(false);
  const [maxPrice, setMaxPrice] = useState<number | null>(null);
  const [daysToOpen, setDaysToOpen] = useState<number | null>(null);
  const [status, setStatus] = useState<'all' | 'active' | 'upcoming'>('all');

  // 정렬 + 노출
  const [sortBy, setSortBy] = useState('buzz_score');
  const [maxItems, setMaxItems] = useState(10);

  // 미리보기
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // 제출
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const { data: options } = useQuery({
    queryKey: ['curation-options'],
    queryFn: curationApi.getOptions,
    staleTime: 60000,
  });

  // 현재 조건 빌드
  const buildConditions = useCallback(() => {
    const c: Record<string, any> = {};
    if (categories.length > 0)          c.categories = categories;
    if (regions.length > 0)             c.regions = regions;
    if (zones.length > 0)               c.zones = zones;
    if (tags.length > 0)                c.tags = tags;
    if (isFree)                         c.is_free = true;
    if (maxPrice !== null)              c.max_price = maxPrice;
    if (daysToOpen !== null)            c.days_to_open = daysToOpen;
    if (status !== 'all')               c.status = status;
    return c;
  }, [categories, regions, zones, tags, isFree, maxPrice, daysToOpen, status]);

  // 디바운스 미리보기 (500ms)
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchPreview = useCallback(async () => {
    const conditions = buildConditions();
    setPreviewLoading(true);
    try {
      const result = await curationApi.preview(conditions, sortBy);
      setPreview(result);
    } catch {
      setPreview(null);
    } finally {
      setPreviewLoading(false);
    }
  }, [buildConditions, sortBy]);

  useEffect(() => {
    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(fetchPreview, 500);
    return () => { if (previewTimer.current) clearTimeout(previewTimer.current); };
  }, [fetchPreview]);

  const handleSubmit = async () => {
    if (!title.trim()) { setError('섹션 이름을 입력해 주세요'); return; }
    const input: CreateThemeInput = {
      slug: slugify(title),
      title: title.trim(),
      subtitle: subtitle.trim() || undefined,
      icon_name: emoji,
      filter_config: { conditions: buildConditions(), sort_by: sortBy, order: 'DESC' },
      max_items: maxItems,
    };
    setSubmitting(true);
    setError('');
    try {
      await curationApi.createTheme(input);
      onCreated();
      onClose();
    } catch (err: any) {
      const msg = err.response?.data?.error ?? '생성에 실패했어요';
      setError(msg === 'slug already exists' ? '비슷한 이름의 섹션이 이미 있어요. 이름을 다르게 해보세요.' : msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">

        {/* 헤더 */}
        <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between rounded-t-2xl z-10">
          <h3 className="text-lg font-bold text-gray-900">새 섹션 만들기</h3>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">✕</button>
        </div>

        <div className="px-6 py-5 space-y-5">

          {/* 이모지 + 제목 */}
          <div className="flex gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wide">아이콘</label>
              <select
                className="h-10 border border-gray-200 rounded-xl px-2 text-xl focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white"
                value={emoji}
                onChange={e => setEmoji(e.target.value)}
              >
                {EMOJI_LIST.map(e => <option key={e} value={e}>{e}</option>)}
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wide">섹션 이름 *</label>
              <input
                className="w-full h-10 border border-gray-200 rounded-xl px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                placeholder="예: 성수 팝업 모음"
                value={title}
                onChange={e => setTitle(e.target.value)}
              />
            </div>
          </div>

          {/* 부제목 */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wide">부제목</label>
            <input
              className="w-full h-10 border border-gray-200 rounded-xl px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
              placeholder="예: 지금 성수에서 뜨는 팝업"
              value={subtitle}
              onChange={e => setSubtitle(e.target.value)}
            />
          </div>

          {/* 필터 조건 */}
          <div className="bg-gray-50 rounded-2xl p-4 space-y-4">
            <div className="text-xs font-bold text-gray-400 uppercase tracking-wide">필터 조건</div>

            <MultiSelect label="카테고리" options={options?.categories ?? []} selected={categories} onChange={setCategories} placeholder="전체 카테고리" />
            <MultiSelect label="광역 지역" options={options?.regions ?? []} selected={regions} onChange={setRegions} placeholder="예: 서울, 경기, 부산" />
            <MultiSelect label="상세 지역 (상권)" options={options?.zones ?? []} selected={zones} onChange={setZones} placeholder="예: 성수·뚝섬, 홍대·합정·망원" />
            <MultiSelect label="태그" options={options?.tags ?? []} selected={tags} onChange={setTags} placeholder="전체 태그" />

            {/* 무료 토글 */}
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-gray-700">무료 이벤트만</label>
              <button
                onClick={() => setIsFree(!isFree)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${isFree ? 'bg-green-500' : 'bg-gray-300'}`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${isFree ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>

            {/* 가격 상한 */}
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">최대 가격</label>
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={() => setMaxPrice(null)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors ${maxPrice === null ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'}`}
                >
                  제한 없음
                </button>
                {PRICE_PRESETS.map(p => (
                  <button
                    key={p.value}
                    onClick={() => setMaxPrice(p.value)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors ${maxPrice === p.value ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'}`}
                  >
                    {p.label} 이하
                  </button>
                ))}
              </div>
            </div>

            {/* 오픈 예정 */}
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">N일 이내 오픈 예정</label>
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={() => setDaysToOpen(null)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors ${daysToOpen === null ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'}`}
                >
                  사용 안 함
                </button>
                {OPEN_DAY_PRESETS.map(p => (
                  <button
                    key={p.value}
                    onClick={() => setDaysToOpen(p.value)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors ${daysToOpen === p.value ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'}`}
                  >
                    {p.label} 이내
                  </button>
                ))}
              </div>
            </div>

            {/* 진행 상태 */}
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wide">진행 상태</label>
              <div className="flex gap-2">
                {([['all','전체'],['active','진행 중'],['upcoming','오픈 예정']] as const).map(([v, label]) => (
                  <button
                    key={v}
                    onClick={() => setStatus(v)}
                    className={`flex-1 py-1.5 rounded-xl text-xs font-medium border transition-colors ${status === v ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* 정렬 + 최대 노출 */}
          <div className="flex gap-4">
            <div className="flex-1">
              <label className="block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wide">정렬 기준</label>
              <select
                className="w-full h-10 border border-gray-200 rounded-xl px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white"
                value={sortBy}
                onChange={e => setSortBy(e.target.value)}
              >
                {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wide">최대 노출</label>
              <div className="flex items-center gap-1.5 h-10">
                <button onClick={() => setMaxItems(Math.max(1, maxItems - 1))} className="w-8 h-8 rounded-full bg-blue-100 hover:bg-blue-200 text-blue-600 font-bold flex items-center justify-center">−</button>
                <span className="w-8 text-center font-bold text-gray-900">{maxItems}</span>
                <button onClick={() => setMaxItems(Math.min(30, maxItems + 1))} className="w-8 h-8 rounded-full bg-blue-100 hover:bg-blue-200 text-blue-600 font-bold flex items-center justify-center">+</button>
              </div>
            </div>
          </div>

          {/* 미리보기 */}
          <div className="bg-blue-50 rounded-2xl p-4">
            <div className="text-xs font-bold text-blue-500 uppercase tracking-wide mb-2">실시간 미리보기</div>
            {previewLoading ? (
              <div className="flex items-center gap-2 text-sm text-blue-400">
                <div className="w-3 h-3 rounded-full border-2 border-blue-400 border-t-transparent animate-spin" />
                확인 중...
              </div>
            ) : preview ? (
              <div>
                <div className="text-xl font-bold text-blue-700 mb-2">
                  {preview.count.toLocaleString()}개 이벤트 매칭
                </div>
                {preview.preview.length > 0 ? (
                  <ul className="space-y-1.5">
                    {preview.preview.map(e => (
                      <li key={e.id} className="text-sm text-blue-600 flex items-center gap-2">
                        <span className="text-blue-300 flex-shrink-0">•</span>
                        <span className="flex-1 truncate">{e.title}</span>
                        <span className="text-xs text-blue-400 flex-shrink-0 bg-blue-100 px-1.5 py-0.5 rounded-full">{e.category}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-blue-400">조건에 맞는 이벤트가 없어요</p>
                )}
              </div>
            ) : (
              <p className="text-sm text-blue-400">조건을 선택하면 매칭되는 이벤트를 미리 볼 수 있어요</p>
            )}
          </div>

          {/* 에러 */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">{error}</div>
          )}
        </div>

        {/* 푸터 */}
        <div className="sticky bottom-0 bg-white border-t border-gray-100 px-6 py-4 flex gap-3 rounded-b-2xl">
          <button onClick={onClose} className="flex-1 h-11 rounded-xl border border-gray-200 text-gray-600 text-sm font-medium hover:bg-gray-50 transition-colors">
            취소
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || !title.trim()}
            className="flex-1 h-11 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? '만드는 중...' : '섹션 만들기'}
          </button>
        </div>
      </div>
    </div>
  );
}
