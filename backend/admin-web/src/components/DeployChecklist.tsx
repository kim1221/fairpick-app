/**
 * 배포 우선순위 체크리스트 (Sticky)
 *
 * 필드 레지스트리를 기준으로 필수/추천/카테고리별 상태를 실시간으로 표시합니다.
 * - ✅ OK: 값 + url + evidence 모두 있음
 * - ⚠️ 값은 있음: 값은 있지만 근거(url/evidence) 부족
 * - ❌ 미완료: 값 없음
 *
 * image_url은 진행률에서 제외하고 별도 섹션으로 표기합니다.
 */

import { useMemo, useState } from 'react';
import { getFieldsForCategory, getFieldDef, type FieldDef } from '../lib/fieldRegistry';
import type { Event, FieldSuggestion } from '../types';

interface Props {
  event: Event;
}

type FieldStatus = 'ok' | 'value_only' | 'missing';

function getNestedValue(obj: any, path: string): any {
  return path.split('.').reduce((cur, key) => cur?.[key], obj);
}

function checkFieldValue(event: Event, def: FieldDef): boolean {
  const val = getNestedValue(event, def.fieldKey);
  if (val === null || val === undefined || val === '') return false;
  if (Array.isArray(val)) return val.length > 0;
  if (typeof val === 'object') return Object.keys(val).length > 0;
  return true;
}

function getSuggestionForField(
  event: Event,
  fieldKey: string
): FieldSuggestion | null {
  return (event.ai_suggestions as any)?.[fieldKey] ?? null;
}

function getFieldStatus(event: Event, def: FieldDef): FieldStatus {
  const hasValue = checkFieldValue(event, def);
  if (!hasValue) return 'missing';

  // 값은 있는 경우, 근거 품질 체크
  const suggestion = getSuggestionForField(event, def.fieldKey);
  if (suggestion && suggestion.value !== null) {
    const hasEvidence = !!(suggestion.url || suggestion.evidence);
    if (!hasEvidence) return 'value_only'; // ⚠️
  }

  // field_sources에서 출처 확인
  const fieldSource = (event.field_sources as any)?.[def.fieldKey];
  if (fieldSource) {
    const hasUrl = !!(fieldSource.url);
    if (!hasUrl && fieldSource.source === 'AI') return 'value_only';
  }

  return 'ok';
}

const STATUS_ICON: Record<FieldStatus, string> = {
  ok: '✅',
  value_only: '⚠️',
  missing: '❌',
};

interface ProgressInfo {
  total: number;
  ok: number;
  valueOnly: number;
  missing: number;
  percent: number;
}

function calcProgress(fields: FieldDef[], event: Event): ProgressInfo {
  const results = fields.map((f) => getFieldStatus(event, f));
  const ok = results.filter((s) => s === 'ok').length;
  const valueOnly = results.filter((s) => s === 'value_only').length;
  const missing = results.filter((s) => s === 'missing').length;
  const total = fields.length;
  const percent = total === 0 ? 100 : Math.round(((ok + valueOnly * 0.5) / total) * 100);
  return { total, ok, valueOnly, missing, percent };
}

function ProgressBar({ percent, size = 'sm' }: { percent: number; size?: 'sm' | 'md' }) {
  const color =
    percent >= 80 ? 'bg-green-500' :
    percent >= 50 ? 'bg-yellow-400' :
    percent >= 25 ? 'bg-orange-400' :
    'bg-red-400';
  const h = size === 'md' ? 'h-3' : 'h-2';
  return (
    <div className={`w-full bg-gray-200 rounded-full ${h} overflow-hidden`}>
      <div
        className={`${h} rounded-full ${color} transition-all duration-300`}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

interface FieldRowProps {
  def: FieldDef;
  status: FieldStatus;
  isExpanded: boolean;
  event: Event;
}

function FieldRow({ def, status, event }: FieldRowProps) {
  const suggestion = getSuggestionForField(event, def.fieldKey);
  const hasFailed = suggestion && suggestion.value === null && (suggestion as any).reasonMessage;

  const scopeBadge =
    def.scope === 'MASTER' ? (
      <span
        className="text-[10px] px-1 py-0.5 rounded font-medium shrink-0 bg-purple-100 text-purple-700"
        title="일관성 우선: 같은 이벤트 변형들 간 동일한 값 유지"
      >
        M
      </span>
    ) : (
      <span
        className="text-[10px] px-1 py-0.5 rounded font-medium shrink-0 bg-green-100 text-green-700"
        title="지역/지점/회차별: 각 이벤트마다 다른 값 가능"
      >
        V
      </span>
    );

  return (
    <div className="flex items-start gap-2 py-1 text-xs">
      <span className="shrink-0 w-5 text-center">{STATUS_ICON[status]}</span>
      <div className="flex-1 min-w-0 flex items-start gap-1">
        <span className={`font-medium ${status === 'missing' ? 'text-gray-500' : 'text-gray-800'}`}>
          {def.label}
        </span>
        {scopeBadge}
        {status === 'value_only' && (
          <span className="ml-1 text-yellow-600 text-xs">(근거 없음)</span>
        )}
        {hasFailed && (
          <div className="mt-0.5 text-gray-500 text-xs w-full">
            <span>{(suggestion as any).reasonMessage}</span>
            {(suggestion as any).naverSearchUrl && (
              <a
                href={(suggestion as any).naverSearchUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-2 text-blue-500 underline hover:text-blue-700"
              >
                네이버에서 검색
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function DeployChecklist({ event }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [showOptional, setShowOptional] = useState(false);

  const fields = useMemo(
    () => getFieldsForCategory(event.main_category || ''),
    [event.main_category]
  );

  const essentialFields = useMemo(
    () => fields.filter((f) => f.requiredLevel === 'essential' && !f.isManualOnly),
    [fields]
  );
  const importantFields = useMemo(
    () => fields.filter((f) => f.requiredLevel === 'important'),
    [fields]
  );
  const optionalFields = useMemo(
    () => fields.filter((f) => f.requiredLevel === 'optional'),
    [fields]
  );
  const categoryFields = useMemo(
    () => fields.filter((f) => f.requiredLevel === 'category'),
    [fields]
  );

  // 진행률 계산 (image_url 제외)
  const essentialProgress = useMemo(
    () => calcProgress(essentialFields, event),
    [essentialFields, event]
  );
  const allProgress = useMemo(
    () =>
      calcProgress(
        [...essentialFields, ...importantFields, ...categoryFields],
        event
      ),
    [essentialFields, importantFields, categoryFields, event]
  );

  const hasImageUrl = !!(
    event.image_url &&
    !event.image_url.toLowerCase().includes('placeholder') &&
    !event.image_url.toLowerCase().includes('/defaults/')
  );

  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-sm">
      {/* 헤더 */}
      <button
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50 transition-colors"
        onClick={() => setCollapsed((c) => !c)}
      >
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm text-gray-800">📋 배포 우선순위 체크리스트</span>
          <span
            className={`text-xs font-medium px-2 py-0.5 rounded-full ${
              allProgress.percent >= 80
                ? 'bg-green-100 text-green-700'
                : allProgress.percent >= 50
                ? 'bg-yellow-100 text-yellow-700'
                : 'bg-red-100 text-red-600'
            }`}
          >
            {allProgress.percent}%
          </span>
        </div>
        <span className="text-gray-400 text-xs">{collapsed ? '▼' : '▲'}</span>
      </button>

      {!collapsed && (
        <div className="px-4 pb-4 space-y-4">
          {/* 이미지 (별도 섹션, 진행률 제외) */}
          <div className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg text-xs">
            <span>{hasImageUrl ? '✅' : '❌'}</span>
            <span className="font-medium text-gray-700">이미지</span>
            <span className="text-gray-500">수동 업로드가 필요해요 (진행률에는 포함하지 않아요)</span>
          </div>

          {/* 필수 섹션 */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-semibold text-gray-700">🔴 필수</span>
              <span className="text-xs text-gray-500">
                {essentialProgress.ok}/{essentialFields.length}
              </span>
              <div className="flex-1">
                <ProgressBar percent={essentialProgress.percent} size="sm" />
              </div>
            </div>
            <div className="space-y-0.5">
              {essentialFields.map((f) => (
                <FieldRow
                  key={f.fieldKey}
                  def={f}
                  status={getFieldStatus(event, f)}
                  isExpanded={false}
                  event={event}
                />
              ))}
            </div>
          </div>

          {/* 추천(중요) 섹션 */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-semibold text-gray-700">🟡 추천</span>
              <span className="text-xs text-gray-500">
                {calcProgress(importantFields, event).ok}/{importantFields.length}
              </span>
            </div>
            <div className="space-y-0.5">
              {importantFields.map((f) => (
                <FieldRow
                  key={f.fieldKey}
                  def={f}
                  status={getFieldStatus(event, f)}
                  isExpanded={false}
                  event={event}
                />
              ))}
            </div>
          </div>

          {/* 카테고리별 섹션 */}
          {categoryFields.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-semibold text-gray-700">
                  🏷️ {event.main_category || '카테고리'} 특화
                </span>
                <span className="text-xs text-gray-500">
                  {calcProgress(categoryFields, event).ok}/{categoryFields.length}
                </span>
              </div>
              <div className="space-y-0.5">
                {categoryFields.map((f) => (
                  <FieldRow
                    key={f.fieldKey}
                    def={f}
                    status={getFieldStatus(event, f)}
                    isExpanded={false}
                    event={event}
                  />
                ))}
              </div>
            </div>
          )}

          {/* 선택 필드 (토글) */}
          <div>
            <button
              className="text-xs text-gray-500 hover:text-gray-700 underline"
              onClick={() => setShowOptional((s) => !s)}
            >
              {showOptional ? '선택 필드 숨기기' : `선택 필드 보기 (${optionalFields.length}개)`}
            </button>
            {showOptional && (
              <div className="mt-2 space-y-0.5">
                {optionalFields.map((f) => (
                  <FieldRow
                    key={f.fieldKey}
                    def={f}
                    status={getFieldStatus(event, f)}
                    isExpanded={false}
                    event={event}
                  />
                ))}
              </div>
            )}
          </div>

          {/* 범례 */}
          <div className="flex gap-3 text-xs text-gray-400 pt-1 border-t border-gray-100">
            <span>✅ 값+근거</span>
            <span>⚠️ 값만 있음</span>
            <span>❌ 미완료</span>
          </div>
        </div>
      )}
    </div>
  );
}
