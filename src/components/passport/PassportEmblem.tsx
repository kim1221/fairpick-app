/**
 * 문화 여권 엠블럼 — 티켓 + 별(금박) 크레스트.
 * 앱 아이콘 세계관(입장권 + 별)과 통일. 시안 v5 표지 중앙 원형 엠블럼 / 도장면 워터마크에 재사용.
 *
 * SVG는 규약대로 @granite-js/native/react-native-svg 사용.
 * color/opacity로 금박(표지)·연회색(워터마크) 두 톤을 모두 커버.
 */
import React from 'react';
import { Path, Svg } from '@granite-js/native/react-native-svg';

export interface PassportEmblemProps {
  size?: number;
  color?: string;
  opacity?: number;
}

// 24x24 뷰박스: 가로 티켓(둥근 사각) + 중앙 별. 노치 없이 단순 실루엣(작은 크기에서 또렷).
export function PassportEmblem({ size = 40, color = '#CBA15E', opacity = 1 }: PassportEmblemProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" opacity={opacity}>
      {/* 티켓 몸통(라운드 사각) — 외곽선 */}
      <Path
        d="M4.5 7.5h15a1.5 1.5 0 0 1 1.5 1.5v2a1.6 1.6 0 0 0 0 3v2a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 15.5v-2a1.6 1.6 0 0 0 0-3v-2A1.5 1.5 0 0 1 4.5 7.5z"
        fill="none"
        stroke={color}
        strokeWidth={1.3}
      />
      {/* 중앙 별 */}
      <Path
        d="M12 9.1l1.02 2.07 2.28.33-1.65 1.61.39 2.27L12 14.9l-2.04 1.07.39-2.27-1.65-1.61 2.28-.33z"
        fill={color}
      />
    </Svg>
  );
}
