/**
 * 데이터 완성도 표시 컴포넌트
 *
 * 이벤트의 데이터 완성도를 시각적으로 보여주는 프로그레스 바.
 * 레벨/색상 기준은 completenessConstants.ts 단일 소스를 사용합니다.
 */

import { COMPLETENESS_LEVEL_CONFIG, type CompletenessLevel } from '../lib/completenessConstants';

interface CompletenessBarProps {
  percentage: number;
  level: CompletenessLevel;
  showLabel?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

const sizeConfig = {
  sm: 'h-1',
  md: 'h-2',
  lg: 'h-3',
};

export default function CompletenessBar({
  percentage,
  level,
  showLabel = true,
  size = 'md',
}: CompletenessBarProps) {
  const config = COMPLETENESS_LEVEL_CONFIG[level];
  const heightClass = sizeConfig[size];

  return (
    <div className="w-full">
      {showLabel && (
        <div className="flex items-center justify-between mb-1">
          <span className={`text-xs font-medium ${config.textColor}`}>
            {config.emoji} {config.label}
          </span>
          <span className="text-xs text-gray-600">{percentage}%</span>
        </div>
      )}
      <div className={`w-full bg-gray-200 rounded-full overflow-hidden ${heightClass}`}>
        <div
          className={`${config.barColor} ${heightClass} rounded-full transition-all duration-300`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}
