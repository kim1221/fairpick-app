# Rewarded Ad Verification Runbook

이 문서는 리워드 광고의 SDK 이벤트, 티켓 지급, 앱인토스 대시보드 노출 수를 대조하는 절차입니다.

## 1. 배포 순서

1. DB 마이그레이션을 먼저 적용합니다.

```bash
cd backend
DATABASE_URL="$DATABASE_URL" npx ts-node -r dotenv/config migrations/run-migration.ts 20260508_reward_ad_attempt_logging.sql
DATABASE_URL="$DATABASE_URL" npx ts-node -r dotenv/config migrations/run-migration.ts 20260509_reward_ad_reconciliation.sql
```

2. 백엔드를 배포합니다.

3. 앱 빌드를 배포합니다. SDK 이벤트 로깅은 앱 코드가 광고 콜백을 서버로 보내야 하므로 새 앱 빌드가 필요합니다.

4. 관리자 화면을 배포합니다. 관리자 화면을 따로 배포하지 않는 환경이면 `/admin/rewards/stats`, `/admin/rewards/reconciliation` API로 확인합니다.

백엔드 API나 DB만 바뀐 경우에는 앱인토스 새 앱 빌드가 필요 없습니다. 다만 이번 변경에는 광고 SDK 콜백을 프론트에서 서버로 보내는 코드와 앱 내부 `/admin` 화면 변경이 포함되어 있어, 그 화면과 로그를 실제 앱에서 보려면 새 앱 빌드가 필요합니다.

## 2. 새로 생긴 데이터

### ad_reward_attempts

광고 버튼 클릭 1회가 1행으로 저장됩니다.

주요 컬럼:

| 컬럼 | 의미 |
| --- | --- |
| `attempt_id` | 프론트에서 만든 광고 시도 ID |
| `user_id` | 로그인 유저 ID |
| `event_id` | 이벤트 상세 ID |
| `ad_group_id` | 앱인토스 광고 그룹 ID |
| `requested_at` | SDK가 광고 표시 요청을 수락한 시각 |
| `show_at` | 광고 화면이 표시된 시각 |
| `impression_at` | 수익 노출로 기록된 시각 |
| `reward_at` | `userEarnedReward` 발생 시각 |
| `dismissed_at` | 광고 닫힘 시각 |
| `failed_to_show_at` | 표시 실패 시각 |
| `error_at` | SDK/API 오류 시각 |

### ad_reward_attempt_events

SDK 이벤트 원본 시퀀스가 모두 저장됩니다. 한 시도에서 `requested`, `show`, `impression`, `userEarnedReward`, `dismissed` 순서가 정상 패턴입니다.

### user_ticket_earn_log.ad_attempt_id

티켓 지급 로그와 광고 시도 ID를 연결합니다.

### ad_reward_settlement_daily

앱인토스 대시보드/정산 화면에서 확인한 날짜별 수치를 수동 저장합니다. 광고 네트워크의 사후 무효 처리나 정산 차감은 SDK 콜백만으로 알 수 없으므로 이 테이블에서 집계로 대조합니다.

주요 컬럼:

| 컬럼 | 의미 |
| --- | --- |
| `report_date` | 앱인토스 대시보드 기준 날짜 |
| `ad_group_id` | 광고 그룹 ID |
| `os` | `all`, `ios`, `android`, `unknown` |
| `dashboard_impressions` | 앱인토스 대시보드에 잡힌 노출 수 |
| `dashboard_ecpm_krw` | 앱인토스 대시보드 eCPM |
| `dashboard_estimated_revenue_krw` | `노출 * eCPM / 1000` |
| `final_revenue_krw` | 나중에 확정된 최종 정산액 |
| `invalid_adjustment_krw` | `최종 정산액 - 예상 수익`. 음수면 차감/무효 가능성 |
| `note` | 확인 메모 |

## 3. 실기기 1회 확인

1. 배포된 앱을 앱인토스에서 엽니다.

2. 로그인합니다.

3. 이벤트 상세 화면에서 `광고 보고 받기`를 누릅니다.

4. 광고를 끝까지 보고 보상을 받습니다.

5. 서버 DB에서 가장 최근 attempt를 확인합니다.

```sql
SELECT
  attempt_id,
  user_id,
  event_id,
  ad_group_id,
  requested_at,
  show_at,
  impression_at,
  reward_at,
  dismissed_at,
  failed_to_show_at,
  error_at,
  last_event_type,
  metadata,
  created_at
FROM ad_reward_attempts
ORDER BY created_at DESC
LIMIT 10;
```

정상 기준:

| 컬럼 | 기대값 |
| --- | --- |
| `requested_at` | not null |
| `show_at` | not null |
| `impression_at` | not null |
| `reward_at` | not null |
| `dismissed_at` | not null |
| `failed_to_show_at` | null |
| `error_at` | null |

6. 해당 attempt의 이벤트 순서를 확인합니다.

```sql
SELECT
  event_type,
  event_data,
  client_created_at,
  created_at
FROM ad_reward_attempt_events
WHERE attempt_id = '<attempt_id>'
ORDER BY created_at ASC;
```

정상 순서:

```text
requested
show
impression
userEarnedReward
dismissed
```

7. 티켓 지급 로그와 연결됐는지 확인합니다.

```sql
SELECT
  id,
  user_id,
  event_id,
  earned,
  earn_date,
  ad_attempt_id,
  created_at
FROM user_ticket_earn_log
WHERE ad_attempt_id = '<attempt_id>';
```

정상 기준:

| 컬럼 | 기대값 |
| --- | --- |
| `earned` | 1 이상 |
| `ad_attempt_id` | 위 attempt ID와 동일 |

## 4. 관리자 API 확인

관리자 API는 `x-admin-key` 헤더가 필요합니다.

```bash
curl -sS \
  -H "x-admin-key: $ADMIN_API_KEY" \
  "https://fairpick-app-production.up.railway.app/admin/rewards/stats?days=7"
```

응답의 `adTelemetry`를 봅니다.

주요 필드:

| 필드 | 의미 |
| --- | --- |
| `attempts` | 광고 버튼 클릭/시도 수 |
| `shows` | SDK show 이벤트 수 |
| `impressions` | SDK impression 이벤트 수 |
| `rewards` | SDK userEarnedReward 이벤트 수 |
| `linkedTicketGrants` | attemptId와 연결된 티켓 지급 건수 |
| `rewardsWithoutImpression` | impression 없이 reward가 발생한 시도 수 |
| `impressionRate` | `impressions / attempts` |
| `rewardToImpressionRate` | `rewards / impressions` |
| `ticketGrantToRewardRate` | `linkedTicketGrants / rewards` |

정산 대조 API도 확인할 수 있습니다.

```bash
curl -sS \
  -H "x-admin-key: $ADMIN_API_KEY" \
  "https://fairpick-app-production.up.railway.app/admin/rewards/reconciliation?days=30"
```

날짜별 앱인토스 대시보드 값을 저장할 때:

```bash
curl -sS \
  -X PUT \
  -H "x-admin-key: $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"dashboardImpressions":100,"dashboardEcpmKrw":3000,"finalRevenueKrw":280,"note":"앱인토스 대시보드 확인"}' \
  "https://fairpick-app-production.up.railway.app/admin/rewards/reconciliation/2026-05-08"
```

정상 운영 목표:

| 지표 | 목표 |
| --- | --- |
| `rewardsWithoutImpression` | 0 |
| `ticketGrantToRewardRate` | 95~100% 근처 |
| `rewardToImpressionRate` | 100% 근처. 낮으면 시청 중 이탈이 많음 |
| `impressionRate` | 높을수록 정상. 낮으면 광고가 열렸지만 수익 노출로 인정되지 않는 시도가 많음 |

## 5. 관리자 웹 확인

관리자 웹의 `리워드 광고 모니터`에서 아래 영역을 확인합니다.

1. `SDK 광고 시도`
2. `SDK impression`
3. `SDK reward`
4. `무노출 reward`
5. `SDK 이벤트 대조` 일자별 표
6. `앱인토스 정산 대조`

앱인토스 대시보드와 비교할 때는 `SDK impression`을 기준으로 비교합니다. 기존 `총 광고 시청`은 티켓 지급 로그 기준이므로 앱인토스 노출 수와 직접 비교하면 안 됩니다.

`앱인토스 정산 대조`에서 날짜별로 입력합니다.

1. `대시보드 노출`: 앱인토스 대시보드의 총 광고 노출 수
2. `eCPM(원)`: 앱인토스 대시보드의 eCPM
3. `최종 정산액`: 정산이 확정된 뒤 실제 인정된 수익
4. `메모`: 특이사항

입력 후 보는 값:

| 값 | 의미 |
| --- | --- |
| `인정률` | 앱인토스 노출 / SDK impression |
| `예상수익` | 대시보드 노출 * eCPM / 1000 |
| `보상비` | 지급 티켓 / 10 |
| `사후조정` | 최종 정산액 - 예상수익 |
| `최종손익` | 최종 정산액 - 보상비 |

`사후조정`이 음수면 나중에 수익 일부가 무효/차감된 것으로 봅니다. 이 값은 개별 유저 1명, 광고 1회 단위의 무효 여부가 아니라 날짜/광고그룹/OS 단위의 집계 차이입니다.

## 6. 앱인토스 대시보드와 비교

앱인토스 성과 데이터는 성과 발생 익일 오전 4시 이후 업데이트됩니다. 예를 들어 2026-05-08에 발생한 광고는 2026-05-09 오전 4시 이후에 비교합니다.

비교 조건을 반드시 맞춥니다.

1. 날짜: KST 기준 같은 날짜
2. OS: iOS/Android 필터가 있으면 동일하게 선택
3. 광고 그룹: `ait.v2.live.b50cf7d900884c5b`
4. 지표: 앱인토스 총 광고 노출 수 vs 우리 `SDK impression`

해석:

| 우리 서버 | 앱인토스 대시보드 | 해석 |
| --- | --- | --- |
| `impressions=10`, `rewards=10` | 노출 10 근처 | 정상 |
| `impressions=10`, `rewards=10` | 노출 1 근처 | 앱인토스/광고 네트워크 유효 노출 필터링 가능성 큼 |
| `impressions=1`, `rewards=10` | 노출 1 근처 | 앱 이벤트 처리 또는 SDK 콜백 흐름 문제 |
| `shows=10`, `impressions=1` | 노출 1 근처 | 광고는 열렸지만 수익 노출로 인정되는 지점까지 가지 못함 |
| `rewardsWithoutImpression > 0` | 낮음 | 보상 지급 조건을 재검토해야 함 |

## 7. 손익 계산

앱인토스 대시보드에서 날짜별 eCPM과 노출 수를 확인한 뒤 계산합니다.

```text
예상 광고 수익 = 앱인토스 노출 수 * eCPM / 1000
티켓 비용 추정 = linkedTicketsGranted / 10
광고 1회당 티켓 비용 = linkedTicketsGranted / linkedTicketGrants / 10
```

`1포인트 = 1원`이면 티켓 비용 추정값을 원화로 보면 됩니다.

예:

```text
앱인토스 노출 수: 100
eCPM: 3,000원
예상 광고 수익: 100 * 3,000 / 1000 = 300원

linkedTicketsGranted: 165
티켓 비용 추정: 165 / 10 = 16.5원

이 경우 수익성은 정상입니다.
```

반대로 SDK reward는 100인데 앱인토스 유효 노출이 10만 잡히면 실제 수익은 10분의 1로 줄어듭니다. 이 경우 같은 유저 반복 시청, 무효 트래픽 필터링, 광고 시청 완료 조건을 같이 봐야 합니다.

## 8. 사후 무효/정산 차감 확인

SDK의 `impression`은 런타임에서 수익 노출 이벤트가 발생했다는 뜻입니다. 이것이 최종 지급 보장이라는 뜻은 아닙니다. 광고주 취소, 무효 트래픽 판정, 미디에이션 정산 조정이 있으면 나중에 예상 수익보다 낮은 금액으로 확정될 수 있습니다.

확인 순서:

1. 성과 발생 다음 날 오전 4시 이후 앱인토스 대시보드에서 날짜별 `노출`, `eCPM`을 입력합니다.
2. `/admin`의 `앱인토스 정산 대조`에서 `대시보드/SDK`, `예상 수익`, `보상비`를 봅니다.
3. 정산이 확정되면 같은 날짜에 `최종 정산액`을 입력합니다.
4. `사후 조정`이 음수인지 확인합니다.

해석:

| 상황 | 의미 |
| --- | --- |
| SDK impression 100, 대시보드 노출 100, 최종 정산액도 예상 수익과 비슷함 | 정상 |
| SDK impression 100, 대시보드 노출 20 | 런타임 impression 이후 대시보드 유효 노출 인정이 낮음 |
| 대시보드 예상 수익 300원, 최종 정산액 200원 | 사후 100원 차감/무효 가능성 |
| 최종손익이 음수 | 지급한 포인트/티켓 비용이 최종 광고 수익보다 큼 |

## 9. 정책 조정 기준

관측 후 아래 조건이면 쿨다운이나 일 한도를 조정합니다.

| 조건 | 조치 |
| --- | --- |
| `rewardsWithoutImpression > 0` | `impression` 없는 reward 지급 케이스 상세 조사 |
| 앱인토스 노출 / SDK impression < 80% | 반복 시청 패턴과 특정 유저 집중도 확인 |
| 20회 이상 유저 비율이 5% 이상 | 쿨다운 30~60초 또는 일 한도 하향 검토 |
| 특정 유저가 매일 한도까지 반복 | 유저 단위 제한 또는 리스크 점수 도입 |
| eCPM이 초기 대비 30% 이상 하락 | 보상 단가/빈도/노출 위치 재검토 |

## 10. 원인 확정용 SQL

일자별 SDK 이벤트와 티켓 지급 대조:

```sql
WITH sdk AS (
  SELECT
    DATE(created_at AT TIME ZONE 'Asia/Seoul') AS date,
    COUNT(*) AS attempts,
    COUNT(show_at) AS shows,
    COUNT(impression_at) AS impressions,
    COUNT(reward_at) AS rewards,
    COUNT(*) FILTER (WHERE reward_at IS NOT NULL AND impression_at IS NULL) AS rewards_without_impression
  FROM ad_reward_attempts
  WHERE created_at >= NOW() - INTERVAL '7 days'
  GROUP BY 1
),
earn AS (
  SELECT
    DATE(created_at AT TIME ZONE 'Asia/Seoul') AS date,
    COUNT(*) AS ticket_grants,
    SUM(earned) AS tickets_granted
  FROM user_ticket_earn_log
  WHERE created_at >= NOW() - INTERVAL '7 days'
    AND ad_attempt_id IS NOT NULL
    AND earned > 0
  GROUP BY 1
)
SELECT
  sdk.date,
  sdk.attempts,
  sdk.shows,
  sdk.impressions,
  sdk.rewards,
  sdk.rewards_without_impression,
  COALESCE(earn.ticket_grants, 0) AS ticket_grants,
  COALESCE(earn.tickets_granted, 0) AS tickets_granted
FROM sdk
LEFT JOIN earn USING (date)
ORDER BY sdk.date DESC;
```

유저별 반복 시청 상위:

```sql
SELECT
  user_id,
  COUNT(*) AS attempts,
  COUNT(impression_at) AS impressions,
  COUNT(reward_at) AS rewards,
  COUNT(*) FILTER (WHERE reward_at IS NOT NULL AND impression_at IS NULL) AS rewards_without_impression
FROM ad_reward_attempts
WHERE created_at >= NOW() - INTERVAL '7 days'
GROUP BY user_id
ORDER BY rewards DESC
LIMIT 30;
```

날짜별 앱인토스 입력값과 SDK 로그 대조:

```sql
WITH sdk AS (
  SELECT
    DATE(created_at AT TIME ZONE 'Asia/Seoul') AS report_date,
    COUNT(impression_at) AS sdk_impressions,
    COUNT(reward_at) AS sdk_rewards,
    COUNT(*) FILTER (WHERE reward_at IS NOT NULL AND impression_at IS NULL) AS rewards_without_impression
  FROM ad_reward_attempts
  WHERE created_at >= NOW() - INTERVAL '30 days'
  GROUP BY 1
),
earn AS (
  SELECT
    DATE(e.created_at AT TIME ZONE 'Asia/Seoul') AS report_date,
    COUNT(*) AS ticket_grants,
    SUM(e.earned) AS tickets_granted
  FROM user_ticket_earn_log e
  WHERE e.created_at >= NOW() - INTERVAL '30 days'
    AND e.ad_attempt_id IS NOT NULL
    AND e.earned > 0
  GROUP BY 1
)
SELECT
  sdk.report_date,
  sdk.sdk_impressions,
  sdk.sdk_rewards,
  sdk.rewards_without_impression,
  r.dashboard_impressions,
  r.dashboard_ecpm_krw,
  r.dashboard_estimated_revenue_krw,
  r.final_revenue_krw,
  r.invalid_adjustment_krw,
  COALESCE(earn.tickets_granted, 0) / 10.0 AS estimated_reward_cost_krw
FROM sdk
LEFT JOIN earn USING (report_date)
LEFT JOIN ad_reward_settlement_daily r
  ON r.report_date = sdk.report_date
 AND r.os = 'all'
ORDER BY sdk.report_date DESC;
```
