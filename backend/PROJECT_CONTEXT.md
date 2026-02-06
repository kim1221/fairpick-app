# PROJECT_CONTEXT

## Project Overview

Fairpick은 한국의 문화 이벤트(전시, 공연, 축제, 팝업)를 추천하는 서비스입니다.
사용자 행동 데이터가 부족한 초기 단계(Cold Start)에서도 "지금 핫한 이벤트"를 추천합니다.

## Service Identity

우리는 "무엇이 인기있는가"를 공공 데이터, 검색 트렌드, 객관적 지표로 판단합니다.
사용자가 아직 우리 서비스를 많이 사용하지 않아도, 사회적으로 주목받는 이벤트를 놓치지 않게 합니다.

## Core Principles

- **Cold Start First**: 사용자 데이터가 없어도 작동하는 추천
- **Objective Signals**: 주관적 큐레이션보다 측정 가능한 지표 우선
- **Multi-Source Truth**: 단일 출처에 의존하지 않음 (공공API + 검색엔진 + AI)
- **Category-Aware**: 공연과 팝업은 "핫함"의 기준이 다름
- **Admin-Assisted Discovery**: 완전 자동화가 아닌, AI + 사람의 협업

## Data Model Overview

**핵심 테이블:**
- `canonical_events`: 정규화된 이벤트 마스터 (모든 출처 통합)
- `admin_hot_suggestions`: AI가 발견한 이벤트 후보 (승인 대기)
- `user_events`: 사용자 상호작용 (좋아요, 북마크 등)

**주요 필드:**
- `buzz_score`: 통합 인기도 점수 (0~100+)
- `buzz_components`: 점수 산출 근거 (JSONB, 투명성)
- `is_featured`: 관리자가 선정한 "지금 추천" 플래그

## Recommendation Philosophy

우리는 두 가지 추천을 제공합니다:
1. **Featured (지금 추천)**: buzz_score 기반 자동 선정 + 관리자 큐레이션
2. **Personalized (나를 위한 추천)**: 사용자 행동 기반 (향후 확장)

초기에는 Featured가 핵심입니다. 모든 사용자에게 동일한 "객관적으로 핫한 이벤트"를 보여줍니다.

## Non-Goals

- 개인화된 취향 추천은 초기 목표가 아님 (데이터 축적 후)
- 모든 이벤트를 수집하지 않음 (핫한 것만)
- 완전 자동화된 이벤트 생성 (관리자 검토 필수)
- 유료 광고 기반 추천 (객관성 유지)

