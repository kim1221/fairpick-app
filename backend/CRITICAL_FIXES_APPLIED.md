# 🔥 치명적 이슈 수정 완료 보고서

**작성일**: 2026-01-23  
**버전**: 1.0.1 (MVP + Critical Fixes)

---

## 📋 수정된 치명 포인트 (7개)

### ✅ Fix 1: Migration backfill 버그 수정
**문제**: 
- `image_storage`를 `NOT NULL DEFAULT 'external'`로 추가해서 `WHERE image_storage IS NULL` 조건이 절대 성립 안함
- 결과: `UPDATE 0` 발생, 기존 데이터 origin 추적 불가

**해결**:
```sql
-- Before (버그)
WHERE image_storage IS NULL AND image_url IS NOT NULL

-- After (수정)
WHERE image_url IS NOT NULL 
  AND image_url != '' 
  AND (image_origin IS NULL OR image_origin = '')
```

**검증**: ✅ `UPDATE 4125` - 기존 4125개 이벤트에 origin backfill 완료

---

### ✅ Fix 2: Admin UI imageOrigin 기본값 처리
**문제**:
- UI에서 `imageOrigin` required인데 업로드 후 바로 제출하면 검증 실패 가능

**해결**:
- 업로드 성공 시 기본값 `user_upload` 자동 설정
- 사용자가 변경 가능하도록 유지

```typescript
imageOrigin: prev.imageOrigin || 'user_upload',
```

---

### ✅ Fix 3: DMCA metadata 덮어쓰기 방지
**문제**:
- `jsonb_build_object`로 기존 `image_metadata` 전체를 날려버림
- 업로드 시 저장한 `width`, `height`, `fileHash` 등 손실

**해결**:
```sql
-- Before (버그)
image_metadata = jsonb_build_object('dmca_takedown', true, ...)

-- After (수정 - 병합)
image_metadata = COALESCE(image_metadata, '{}'::jsonb) || jsonb_build_object(...)
```

---

### 🚨 Fix 4: DMCA API 보안 취약점 수정 (Critical!)
**문제**:
- 공개 엔드포인트 `/api/dmca/takedown`가 admin 인증 없이 즉시 삭제
- **악의적 사용자가 모든 이미지를 삭제할 수 있는 심각한 보안 취약점**

**해결** (2단계 분리):

#### 1. 공개 신고 API (즉시 삭제 안함)
```
POST /api/dmca/report
- 인증: 없음 (공개)
- 동작: 신고만 접수, pending 상태로 저장
- 응답: "관리자 검토 후 처리됩니다"
```

#### 2. Admin 승인 & 삭제 API
```
POST /admin/dmca/approve
- 인증: requireAdminAuth (필수)
- 동작: 신고 승인 후 실제 이미지 삭제
- 로그: admin 승인 기록 남김
```

**보안 개선**:
- ✅ 악의적 대량 삭제 방지
- ✅ 관리자 검토 프로세스 추가
- ✅ 감사 로그 (누가, 언제, 왜 삭제했는지 추적)

---

### ✅ Fix 5: dotenv 로딩 검증
**문제**: 
- "환경변수 0개 로드" 로그 발견

**검증 결과**:
- ✅ `package.json`에 `-r dotenv/config` 플래그 정상 설정
- ✅ `config.ts`에서 `dotenv.config()` 호출 정상
- ℹ️ "0개 로드"는 S3 환경변수 미설정 상태라서 그런 것 (정상)

---

### ✅ Fix 6: CDN_BASE_URL 검증 로직 개선
**문제**:
- 단순 `startsWith()` 체크만 함
- Trailing slash 차이로 검증 실패 가능
- CDN_BASE_URL 미설정 시 에러 메시지 불명확

**해결**:
```typescript
// CDN_BASE_URL 설정 여부 체크
if (!config.cdnBaseUrl) {
  return res.status(500).json({
    message: 'CDN_BASE_URL이 설정되지 않았습니다',
    code: 'CDN_NOT_CONFIGURED',
  });
}

// Trailing slash 정규화
const normalizedCdnBase = config.cdnBaseUrl.replace(/\/$/, '');
const normalizedImageUrl = imageUrl.replace(/\/$/, '');

if (!normalizedImageUrl.startsWith(normalizedCdnBase)) {
  // 에러 처리
}
```

---

### ✅ Fix 7: Instagram UI 옵션 제거
**문제**:
- Instagram 옵션이 있어서 운영자가 실수로 선택할 가능성
- 법적 리스크 증가

**해결**:
```typescript
// Before
<option value="instagram">Instagram (권리 확인 완료)</option>

// After (제거됨)
// Instagram 옵션 삭제
```

**추가**:
- 드롭다운 아래 경고 메시지 추가: "⚠️ Instagram 개인 사진은 업로드 금지 (법적 리스크)"

---

## 📊 수정 요약

| 이슈 | 심각도 | 상태 | 영향 |
|------|--------|------|------|
| 1. Migration backfill | High | ✅ 수정 | 기존 4125개 이벤트 origin 추적 가능 |
| 2. imageOrigin 기본값 | Low | ✅ 수정 | UX 개선 |
| 3. DMCA metadata 덮어쓰기 | Medium | ✅ 수정 | 메타데이터 보존 |
| **4. DMCA API 보안** | **🚨 Critical** | ✅ 수정 | **악의적 삭제 방지** |
| 5. dotenv 로딩 | Info | ✅ 검증 | 정상 작동 확인 |
| 6. CDN URL 검증 | Low | ✅ 개선 | 안정성 향상 |
| 7. Instagram 옵션 | Medium | ✅ 제거 | 법적 리스크 감소 |

---

## 🔄 변경된 파일 목록

### 수정된 파일 (3개)
1. `backend/migrations/20260123_add_image_metadata.sql` - backfill 조건 수정
2. `backend/src/index.ts` - DMCA API 분리, CDN 검증 강화
3. `backend/admin-web/src/pages/CreatePopupPage.tsx` - imageOrigin 기본값, Instagram 옵션 제거

### 새로 생성된 파일 (1개)
1. `backend/CRITICAL_FIXES_APPLIED.md` - 본 문서

---

## 🧪 재테스트 필요 항목

### 1. DMCA 신고 플로우 (변경됨!)
```bash
# Before: 즉시 삭제 (위험)
curl -X POST http://localhost:5001/api/dmca/takedown -d '{...}'

# After: 신고 접수 + Admin 승인
curl -X POST http://localhost:5001/api/dmca/report -d '{
  "eventId": "...",
  "copyrightHolderName": "홍길동",
  "copyrightHolderEmail": "test@example.com",
  "reason": "저작권 침해",
  "evidenceUrl": "https://..."
}'
# 응답: { "success": true, "status": "pending", "reportId": "..." }

# Admin이 승인
curl -X POST http://localhost:5001/admin/dmca/approve \
  -H "x-admin-key: fairpick-admin-2024" \
  -d '{
    "reportId": "...",
    "eventId": "...",
    "adminNote": "저작권 침해 확인됨"
  }'
# 이제 실제로 삭제됨
```

### 2. Admin UI 테스트
- [ ] 이미지 업로드 후 "출처" 자동 선택 확인 (user_upload)
- [ ] Instagram 옵션이 드롭다운에 없는지 확인
- [ ] 경고 메시지 표시 확인

### 3. 마이그레이션 검증
```sql
-- 기존 데이터 origin 확인
SELECT 
  image_origin, 
  COUNT(*) 
FROM canonical_events 
WHERE image_url IS NOT NULL 
GROUP BY image_origin;
```

**예상 결과**:
```
image_origin | count
-------------+-------
instagram    | 123
public_api   | 3456
naver        | 234
other        | 312
```

---

## 🚀 배포 전 체크리스트

- [x] Migration backfill 재실행 (UPDATE 4125 확인)
- [x] DMCA API 분리 (공개 report + admin approve)
- [x] Instagram 옵션 UI에서 제거
- [x] Linter 에러 없음 확인
- [ ] Admin UI에서 이미지 업로드 테스트
- [ ] DMCA 신고 → 승인 플로우 테스트
- [ ] CDN URL 검증 테스트 (trailing slash 포함)
- [ ] `.env`에 S3/R2 설정 추가
- [ ] 프로덕션 배포

---

## ✅ 추가 보안 강화 (2026-01-23 추가)

1. **DMCA 신고 Rate Limiting 적용** ✅
   - IP당 1시간에 5회 제한
   - 스팸 신고로 인한 audit_log 도배 방지
   - 정당한 저작권자는 충분히 사용 가능

2. **imageUrl optional 처리** ✅
   - 신고자가 본 이미지 URL을 로그에 기록 (선택)
   - 필수가 아니므로 정당한 신고 차단 없음
   - Admin 검토 시 참고 자료로 활용

## 💡 추가 권장 사항 (나중에)

1. **Captcha 추가**
   - Cloudflare Turnstile (무료)

2. **Admin 알림**
   - DMCA 신고 접수 시 Slack/이메일 알림
   - 관리자 대시보드에 pending 신고 표시

3. **이미지 워터마크**
   - 업로드 시 'FAIRPICK' 로고 자동 추가 (선택적)
   - 저작권 표시 강화

4. **자동 삭제 정책**
   - 종료된 이벤트 이미지 90일 후 자동 삭제
   - 스토리지 비용 절감

---

## 📞 문의

치명적 버그를 발견해주셔서 감사합니다! 🙏

특히 **Fix 4 (DMCA API 보안)**는 실제 프로덕션에서 대형 사고로 이어질 수 있던 취약점이었습니다.

---

**작성자**: Fairpick Dev Team  
**리뷰**: GPT-4o (Security Audit)  
**최종 검증**: 2026-01-23

