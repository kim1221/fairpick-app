/**
 * 🎯 선택 필드 재생성 — 필드 선택 모달
 *
 * 필드 레지스트리를 단일 소스로 사용합니다.
 * - 전체 선택/해제
 * - 필수만 / 추천만 프리셋
 * - 필드 검색
 * - forceFields 배열 반환
 */

import { useState, useMemo } from 'react';
import { getFieldsForCategory, type FieldDef } from '../lib/fieldRegistry';

interface Props {
  mainCategory: string;
  onConfirm: (forceFields: string[]) => void;
  onCancel: () => void;
}

export default function FieldSelectorModal({ mainCategory, onConfirm, onCancel }: Props) {
  const allFields = useMemo(
    () => getFieldsForCategory(mainCategory).filter((f) => !f.isManualOnly && !f.isAiSkip),
    [mainCategory]
  );

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!search.trim()) return allFields;
    const q = search.toLowerCase();
    return allFields.filter(
      (f) => f.label.toLowerCase().includes(q) || f.fieldKey.toLowerCase().includes(q)
    );
  }, [allFields, search]);

  const grouped = useMemo(() => {
    const groups: Record<string, FieldDef[]> = {};
    for (const f of filtered) {
      const key =
        f.requiredLevel === 'essential'
          ? '🔴 필수'
          : f.requiredLevel === 'important'
          ? '🟡 추천'
          : f.requiredLevel === 'category'
          ? `🏷️ ${f.category} 특화`
          : '⚪ 선택';
      if (!groups[key]) groups[key] = [];
      groups[key].push(f);
    }
    return groups;
  }, [filtered]);

  const toggle = (fieldKey: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(fieldKey)) next.delete(fieldKey);
      else next.add(fieldKey);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(allFields.map((f) => f.fieldKey)));
  const clearAll = () => setSelected(new Set());
  const selectEssential = () =>
    setSelected(
      new Set(allFields.filter((f) => f.requiredLevel === 'essential').map((f) => f.fieldKey))
    );
  const selectImportant = () =>
    setSelected(
      new Set(
        allFields
          .filter((f) => f.requiredLevel === 'essential' || f.requiredLevel === 'important')
          .map((f) => f.fieldKey)
      )
    );

  const handleConfirm = () => {
    if (selected.size === 0) {
      alert('최소 1개 이상의 필드를 선택하세요.');
      return;
    }
    onConfirm(Array.from(selected));
  };

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-[60] p-4"
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="px-5 py-4 border-b border-gray-200 shrink-0">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-gray-900">🎯 선택 필드 재생성</h3>
            <button onClick={onCancel} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
          </div>

          {/* 검색 */}
          <input
            type="text"
            placeholder="필드 검색..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 mb-3"
          />

          {/* 프리셋 버튼 */}
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={selectAll}
              className="text-xs px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded text-gray-700 transition-colors"
            >
              전체 선택
            </button>
            <button
              onClick={clearAll}
              className="text-xs px-2 py-1 bg-gray-100 hover:bg-gray-200 rounded text-gray-700 transition-colors"
            >
              전체 해제
            </button>
            <button
              onClick={selectEssential}
              className="text-xs px-2 py-1 bg-red-50 hover:bg-red-100 rounded text-red-700 transition-colors"
            >
              필수만
            </button>
            <button
              onClick={selectImportant}
              className="text-xs px-2 py-1 bg-yellow-50 hover:bg-yellow-100 rounded text-yellow-700 transition-colors"
            >
              필수+추천
            </button>
          </div>
        </div>

        {/* 필드 목록 */}
        <div className="overflow-y-auto flex-1 px-5 py-3 space-y-4">
          {Object.entries(grouped).map(([groupName, groupFields]) => (
            <div key={groupName}>
              <p className="text-xs font-semibold text-gray-500 mb-2">{groupName}</p>
              <div className="grid grid-cols-2 gap-1.5">
                {groupFields.map((f) => (
                  <label
                    key={f.fieldKey}
                    className={`flex items-center gap-1.5 text-sm px-2 py-1.5 rounded cursor-pointer transition-colors ${
                      selected.has(f.fieldKey)
                        ? 'bg-blue-50 text-blue-800'
                        : 'hover:bg-gray-50 text-gray-700'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(f.fieldKey)}
                      onChange={() => toggle(f.fieldKey)}
                      className="rounded shrink-0"
                    />
                    <span className="truncate">{f.label}</span>
                    {f.scope === 'MASTER' ? (
                      <span
                        className="text-[10px] px-1 py-0.5 bg-purple-100 text-purple-700 rounded font-medium shrink-0"
                        title="일관성 우선: 같은 이벤트 변형들 간 동일한 값 유지"
                      >
                        M
                      </span>
                    ) : (
                      <span
                        className="text-[10px] px-1 py-0.5 bg-green-100 text-green-700 rounded font-medium shrink-0"
                        title="지역/지점/회차별: 각 이벤트마다 다른 값 가능"
                      >
                        V
                      </span>
                    )}
                  </label>
                ))}
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-4">
              검색 결과가 없어요.
            </p>
          )}
        </div>

        {/* 푸터 */}
        <div className="px-5 py-4 border-t border-gray-200 flex items-center justify-between shrink-0">
          <span className="text-sm text-gray-500">
            {selected.size}개 선택됨
          </span>
          <div className="flex gap-2">
            <button
              onClick={onCancel}
              className="px-4 py-2 text-sm border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50"
            >
              취소
            </button>
            <button
              onClick={handleConfirm}
              disabled={selected.size === 0}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              ✅ {selected.size}개 재생성
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
