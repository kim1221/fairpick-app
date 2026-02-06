# 🛡️ Option 1 보안 강화 완료 보고서

**작성일**: 2026-01-23  
**버전**: 1.0.2 (Critical Fixes + Security Enhancements)

---

## 📋 구현 내용 요약

GPT가 제안한 3가지 중 **실용적이고 부작용 없는 것만** 선별하여 구현했습니다.

| 제안 | 채택 여부 | 구현 방식 | 이유 |
|------|----------|----------|------|
| **(A) Rate Limit** | ✅ **채택** | IP당 1시간 5회 | 스팸 방지, 부작용 없음 |
| **(B) imageUrl 검증** | ⚠️ **부분 채택** | Optional로 로그 기록만 | 정당한 신고 차단 방지 |
| **(C) action ENUM** | ❌ **보류** | TypeScript로 관리 | 우선순위 낮음 |

---

## ✅ (A) DMCA Report Rate Limiter

### 구현 내용
```typescript
const dmcaReportLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,  // 1시간
  max: 5,                     // 최대 5회
  message: {
    error: 'DMCA 신고 횟수 제한 초과',
    message: '1시간당 최대 5건까지 신고 가능합니다. 잠시 후 다시 시도하세요.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip || 'unknown',
});

app.post('/api/dmca/report', dmcaReportLimiter, async (req, res) => {
  // ...
});
```

### 막는 공격/오류
1. ✅ **스팸 도배 공격**
   - 악의적 사용자가 `image_audit_log` 테이블을 스팸으로 도배
   - DB 성능 저하 방지
   - 디스크 공간 낭비 방지

2. ✅ **Admin 검토 부담 감소**
   - 허위 신고가 대량으로 쌓이면 Admin이 처리 불가
   - 1시간 5회면 정당한 저작권자는 충분히 사용 가능

3. ✅ **비용 절감**
   - DB write 비용 감소
   - Admin 인건비 절감

**테스트**:
```bash
# 6번째 신고 시도
curl -X POST http://localhost:5001/api/dmca/report \
  -d '{...}' 
# → 429 Too Many Requests
```

---

## ⚠️ (B) imageUrl Optional 처리

### 구현 내용
```typescript
// Request body에서 imageUrl 받기 (optional)
const { eventId, copyrightHolderName, copyrightHolderEmail, reason, evidenceUrl, imageUrl } = req.body;

// 로그에만 기록 (검증은 하지 않음)
JSON.stringify({
  copyrightHolderName,
  evidenceUrl,
  reportedImageUrl: imageUrl,  // optional - 있으면 기록, 없으면 undefined
  reportedAt: new Date().toISOString(),
  status: 'pending',
})
```

### 왜 필수 검증을 하지 않았나?

**문제점 (GPT 제안의 허점)**:
1. ❌ **UX 최악**
   - 일반인이 브라우저 개발자 도구로 imageUrl 복사? 불가능
   - "이 이미지 우클릭 → 주소 복사" 해야 함 → 너무 어려움

2. ❌ **정당한 신고 차단**
   ```
   저작권자: "제 사진이 이 이벤트에 쓰였어요!"
   시스템: "imageUrl을 정확히 입력하세요"
   저작권자: "무슨 URL이요? eventId만 알아요..."
   시스템: 400 Bad Request ❌
   ```

3. ❌ **CDN URL vs 원본 URL 불일치**
   - 저작권자는 자기 원본 이미지 URL을 알고 있음
   - DB에는 우리 CDN URL 저장됨
   - **절대 일치하지 않음** → 신고 실패

**우리 솔루션**:
- ✅ `imageUrl`을 **optional**로 받음
- ✅ 있으면 로그에 기록 → Admin 검토 시 참고
- ✅ 없어도 신고 접수 → 정당한 신고자 보호

### 막는 오류
1. ✅ **정당한 신고 차단 방지**
   - 저작권자가 기술적 지식 없어도 신고 가능
   - `eventId`만으로도 충분히 식별 가능

2. ✅ **Admin 검토 효율 향상**
   - `imageUrl`이 있으면 더 빠른 검토
   - 없어도 `event.image_url`로 확인 가능

---

## ❌ (C) action ENUM화 - 보류

### 보류 이유

**PostgreSQL ENUM의 단점**:
1. ⚠️ 수정이 매우 어려움
   - 새 action 추가 시 `ALTER TYPE` 필요
   - ENUM 값 삭제 불가
   - 순서 변경 불가
   - 운영 중 스키마 변경 리스크

2. ✅ **TypeScript로 충분**
   ```typescript
   type AuditAction = 
     | 'upload' 
     | 'delete' 
     | 'dmca_report_pending' 
     | 'dmca_takedown';
   ```
   - 코드 레벨에서 타입 안전성 보장
   - 유연하게 수정 가능
   - 런타임 체크는 application 레벨에서

3. 📝 **우선순위 낮음**
   - 현재 action 타입은 충분히 안정적
   - 오타 위험보다 스키마 유연성이 더 중요
   - 나중에 action이 완전히 고정되면 고려

---

## 📊 변경 요약

### 수정된 파일 (3개)
1. ✅ `backend/src/index.ts` 
   - `dmcaReportLimiter` 추가
   - `/api/dmca/report`에 rate limiter 적용
   - `imageUrl` optional 처리

2. ✅ `backend/TESTING_IMAGE_UPLOAD.md`
   - Rate limit 테스트 케이스 추가
   - imageUrl optional 설명 추가

3. ✅ `backend/CRITICAL_FIXES_APPLIED.md`
   - 추가 보안 강화 내역 기록

### 새로 생성된 파일 (1개)
1. ✅ `backend/OPTION1_SECURITY_ENHANCEMENTS.md` - 본 문서

---

## 🧪 테스트 시나리오

### 1. 정상 신고 (imageUrl 포함)
```bash
curl -X POST http://localhost:5001/api/dmca/report \
  -H "Content-Type: application/json" \
  -d '{
    "eventId": "abc-123",
    "copyrightHolderName": "홍길동",
    "copyrightHolderEmail": "test@example.com",
    "reason": "저작권 침해",
    "imageUrl": "https://cdn.fairpick.kr/events/2026/01/abc.webp"
  }'
```
**예상**: ✅ 신고 접수 (200 OK)

### 2. 정상 신고 (imageUrl 없음)
```bash
curl -X POST http://localhost:5001/api/dmca/report \
  -H "Content-Type: application/json" \
  -d '{
    "eventId": "abc-123",
    "copyrightHolderName": "홍길동",
    "copyrightHolderEmail": "test@example.com",
    "reason": "저작권 침해"
  }'
```
**예상**: ✅ 신고 접수 (200 OK) - imageUrl 없어도 됨!

### 3. Rate Limit 테스트
```bash
# 1시간에 6번 신고 시도
for i in {1..6}; do
  curl -X POST http://localhost:5001/api/dmca/report -d '{...}'
  sleep 1
done
```
**예상**: 
- 1~5번: ✅ 신고 접수
- 6번: ❌ 429 Too Many Requests

### 4. Admin 승인
```bash
curl -X POST http://localhost:5001/admin/dmca/approve \
  -H "x-admin-key: fairpick-admin-2024" \
  -d '{
    "reportId": "12345-uuid",
    "eventId": "abc-123"
  }'
```
**예상**: ✅ 이미지 삭제 (200 OK)

---

## 🎯 최종 평가

### GPT 제안 vs 실제 구현

| 항목 | GPT 제안 | 우리 구현 | 이유 |
|------|----------|----------|------|
| Rate Limit | 1시간 5회 | ✅ 동일 | 완벽한 제안 |
| imageUrl | 필수 검증 | ⚠️ Optional 로그만 | 정당한 신고 보호 |
| action ENUM | 즉시 구현 | ❌ 보류 | 스키마 유연성 우선 |

### 의사결정 기준
1. ✅ **부작용 없는 개선**: 즉시 적용
2. ⚠️ **Trade-off 있는 개선**: 신중히 판단 후 조정
3. ❌ **우선순위 낮은 개선**: 보류

---

## 🚀 배포 전 체크리스트

- [x] Rate Limiter 추가 (dmcaReportLimiter)
- [x] imageUrl optional 처리
- [x] Linter 에러 없음 확인
- [x] 테스트 문서 업데이트
- [ ] Rate Limit 실제 테스트 (6번 신고 시도)
- [ ] imageUrl 없이 신고 테스트
- [ ] Admin 승인 플로우 테스트

---

## 💡 앞으로의 개선 방향

### 즉시 고려 (운영 안정화)
1. **Cloudflare Turnstile (Captcha)**
   - Rate limit 우회 방지
   - 봇 신고 차단

2. **Admin 알림**
   - 신고 접수 시 Slack 알림
   - 24시간 내 처리 알림

### 나중에 고려 (최적화)
1. **action ENUM화**
   - action 타입이 완전히 고정되면
   - 스키마 안정성이 더 중요해지면

2. **이미지 fingerprinting**
   - 같은 이미지를 다른 URL로 재업로드 감지
   - 저작권 침해 재발 방지

---

## 📞 결론

GPT의 제안은 **방향성은 100% 옳았지만**, 일부는 **실무 UX와 충돌**했습니다.

우리는:
- ✅ 좋은 제안은 즉시 채택 (Rate Limit)
- ⚠️ 문제 있는 제안은 조정 (imageUrl 필수 → optional)
- ❌ 우선순위 낮은 제안은 보류 (ENUM화)

**결과**: 보안은 강화하되, 정당한 사용자를 차단하지 않는 균형잡힌 구현! 🎯

---

**작성자**: Fairpick Dev Team  
**리뷰**: GPT-4o + Human Critical Thinking  
**최종 검증**: 2026-01-23


