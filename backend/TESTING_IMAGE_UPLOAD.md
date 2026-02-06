# 이미지 업로드 & CDN 안정화 기능 테스트 가이드

## 🎯 구현 완료 항목

### ✅ 백엔드
- [x] DB 마이그레이션 (image_storage, image_origin 등 5개 컬럼 추가)
- [x] S3/R2 업로드 유틸 (`imageUpload.ts`)
- [x] 이미지 업로드 API (`POST /admin/uploads/image`)
- [x] 팝업 생성 API 확장 (이미지 메타 필드 추가)
- [x] Instagram scontent URL 차단
- [x] DMCA Takedown API (`POST /api/dmca/takedown`)
- [x] Rate Limiting (15분당 20개)

### ✅ Admin UI
- [x] 타입 정의 (`UploadImageResponse`, `ImageMetadata`)
- [x] API 클라이언트 (`uploadImage` 메서드)
- [x] CreatePopupPage 업로드 UI
- [x] 이미지 출처 선택 (naver/official_site/instagram/other)
- [x] 저작권 경고 & 동의 체크박스
- [x] 업로드 진행률 표시
- [x] 이미지 미리보기

---

## 🔧 환경변수 설정

`backend/.env` 파일에 추가:

```bash
# ============================================================================
# S3/R2 설정 (Cloudflare R2 추천)
# ============================================================================

# Cloudflare R2 사용 시
S3_ENDPOINT=https://<YOUR_ACCOUNT_ID>.r2.cloudflarestorage.com
AWS_REGION=auto
S3_ACCESS_KEY=<YOUR_R2_ACCESS_KEY>
S3_SECRET_KEY=<YOUR_R2_SECRET_KEY>
S3_BUCKET=fairpick-images
CDN_BASE_URL=https://pub-xxxxx.r2.dev

# 또는 AWS S3 사용 시
# AWS_REGION=ap-northeast-2
# S3_ENDPOINT=  # 비워두면 기본 AWS 엔드포인트 사용
# S3_ACCESS_KEY=<YOUR_AWS_ACCESS_KEY>
# S3_SECRET_KEY=<YOUR_AWS_SECRET_KEY>
# S3_BUCKET=fairpick-images
# CDN_BASE_URL=https://d1234abcd.cloudfront.net
```

### Cloudflare R2 설정 방법

1. https://dash.cloudflare.com/ 로그인
2. **R2 Object Storage** 메뉴 클릭
3. **버킷 생성**: `fairpick-images`
4. **Public Access 설정**: R2 버킷 설정에서 "Allow Public Access" 활성화
5. **API 토큰 생성**:
   - "Manage R2 API Tokens" 클릭
   - "Create API Token" (Read & Write 권한)
   - Access Key와 Secret Key 복사
6. **Public URL 확인**: 버킷 설정에서 `https://pub-xxxxx.r2.dev` 형태의 URL 확인

---

## 🧪 테스트 시나리오

### 1. 환경변수 검증

```bash
cd backend
node -e "
require('dotenv').config();
console.log('S3_BUCKET:', process.env.S3_BUCKET);
console.log('CDN_BASE_URL:', process.env.CDN_BASE_URL);
console.log('S3_ENDPOINT:', process.env.S3_ENDPOINT);
"
```

**예상 출력:**
```
S3_BUCKET: fairpick-images
CDN_BASE_URL: https://pub-xxxxx.r2.dev
S3_ENDPOINT: https://...r2.cloudflarestorage.com
```

### 2. 백엔드 서버 시작

```bash
cd backend
npm run dev
```

**예상 출력:**
```
[API] Server listening on http://localhost:5001
```

### 3. 이미지 업로드 API 테스트

#### 방법 A: 테스트 스크립트 사용
```bash
cd backend
./test-upload.sh
```

#### 방법 B: 수동 curl
```bash
curl -X POST http://localhost:5001/admin/uploads/image \
  -H "x-admin-key: fairpick-admin-2024" \
  -F "image=@/path/to/test-image.jpg" \
  | jq
```

**예상 응답 (성공):**
```json
{
  "success": true,
  "url": "https://pub-xxxxx.r2.dev/events/2026/01/abc123.webp",
  "key": "events/2026/01/abc123.webp",
  "width": 1200,
  "height": 800,
  "sizeKB": 45,
  "format": "webp",
  "fileHash": "sha256...",
  "uploadedAt": "2026-01-23T12:34:56.789Z"
}
```

**예상 응답 (실패 - 파일 없음):**
```json
{
  "success": false,
  "error": "파일이 업로드되지 않았습니다",
  "code": "NO_FILE"
}
```

**예상 응답 (실패 - S3 설정 오류):**
```json
{
  "success": false,
  "error": "CDN 설정이 올바르지 않습니다",
  "details": [
    "S3_BUCKET 환경변수가 설정되지 않았습니다",
    "CDN_BASE_URL 환경변수가 설정되지 않았습니다"
  ]
}
```

### 4. Admin UI 테스트

1. **Admin Web 실행**:
   ```bash
   cd backend/admin-web
   npm run dev
   ```

2. **브라우저에서 접속**: http://localhost:5173

3. **테스트 흐름**:
   - "새 팝업 추가" 클릭
   - 이미지 업로드 섹션에서 파일 선택
   - 업로드 진행률 표시 확인
   - 미리보기 이미지 렌더링 확인
   - "이미지 출처" 드롭다운에서 선택
   - "출처 페이지 URL" 입력 (선택)
   - 저작권 동의 체크박스 선택
   - 나머지 필드 입력 후 "생성" 클릭

4. **DB 확인**:
   ```sql
   SELECT 
     id, title, image_url, image_storage, image_origin, 
     image_source_page_url, image_key, image_metadata
   FROM canonical_events
   ORDER BY created_at DESC
   LIMIT 1;
   ```

   **예상 결과:**
   ```
   image_storage: 'cdn'
   image_origin: 'official_site'
   image_url: 'https://pub-xxxxx.r2.dev/events/2026/01/abc123.webp'
   image_key: 'events/2026/01/abc123.webp'
   image_metadata: {
     "width": 1200,
     "height": 800,
     "sizeKB": 45,
     "format": "webp",
     "fileHash": "sha256...",
     "uploadedAt": "2026-01-23T..."
   }
   ```

### 5. Instagram URL 차단 테스트

#### Admin UI에서 Instagram scontent URL 입력 시도:
1. 이미지 URL 필드에 입력: `https://scontent-gmp1-1.cdninstagram.com/v/t51...`
2. "생성" 버튼 클릭

**예상 결과:**
```
⚠️ Instagram CDN URL(scontent)은 24시간 후 만료됩니다. 
이미지를 직접 업로드해주세요.
```

### 6. DMCA 신고 & 승인 API 테스트 (2단계)

⚠️ **보안 개선**: 공개 API는 신고만 받고, 실제 삭제는 Admin 승인 필요  
🛡️ **Rate Limit**: IP당 1시간 5회 제한 (스팸 방지)

#### Step 1: 공개 신고 접수 (즉시 삭제 안됨)
```bash
curl -X POST http://localhost:5001/api/dmca/report \
  -H "Content-Type: application/json" \
  -d '{
    "eventId": "abc-123-def",
    "copyrightHolderName": "홍길동",
    "copyrightHolderEmail": "copyright@example.com",
    "reason": "내 저작물이 무단으로 사용되었습니다",
    "evidenceUrl": "https://example.com/proof",
    "imageUrl": "https://cdn.fairpick.kr/events/2026/01/abc.webp"
  }' | jq
```

**필드 설명**:
- `eventId`, `copyrightHolderName`, `copyrightHolderEmail`, `reason`: **필수**
- `evidenceUrl`: 선택 (증빙 자료 URL)
- `imageUrl`: 선택 (신고자가 본 이미지 URL, 로그 참고용)

**예상 응답 (신고 접수):**
```json
{
  "success": true,
  "message": "신고가 접수되었습니다. 관리자 검토 후 처리됩니다.",
  "reportId": "12345-uuid",
  "eventId": "abc-123-def",
  "status": "pending"
}
```

**예상 응답 (Rate Limit 초과):**
```json
{
  "error": "DMCA 신고 횟수 제한 초과",
  "message": "1시간당 최대 5건까지 신고 가능합니다. 잠시 후 다시 시도하세요."
}
```
(HTTP 429 Too Many Requests)

#### Step 2: Admin 승인 & 삭제
```bash
curl -X POST http://localhost:5001/admin/dmca/approve \
  -H "x-admin-key: fairpick-admin-2024" \
  -H "Content-Type: application/json" \
  -d '{
    "reportId": "12345-uuid",
    "eventId": "abc-123-def",
    "adminNote": "저작권 침해 확인됨"
  }' | jq
```

**예상 응답 (삭제 완료):**
```json
{
  "success": true,
  "message": "이미지가 삭제되었습니다",
  "eventId": "abc-123-def",
  "removedImageUrl": "https://pub-xxxxx.r2.dev/events/2026/01/abc123.webp"
}
```

**DB 확인**:
```sql
-- 신고 로그 확인
SELECT * FROM image_audit_log 
WHERE action IN ('dmca_report_pending', 'dmca_takedown')
ORDER BY created_at DESC LIMIT 5;
```

---

## 🐛 트러블슈팅

### 문제 1: "CDN 설정이 올바르지 않습니다"
**원인**: 환경변수가 설정되지 않음  
**해결**: `.env` 파일 확인 후 백엔드 재시작

### 문제 2: "업로드 실패 (403 Forbidden)"
**원인**: S3/R2 API 키 권한 부족  
**해결**: API 토큰에 "Read & Write" 권한 확인

### 문제 3: "이미지는 표시되지만 깨짐"
**원인**: R2 버킷이 Public Access로 설정되지 않음  
**해결**: R2 대시보드에서 "Allow Public Access" 활성화

### 문제 4: "업로드는 성공했지만 CDN URL로 접근 불가"
**원인**: CDN_BASE_URL이 잘못 설정됨  
**해결**: R2 버킷의 Public URL 확인 (보통 `https://pub-xxxxx.r2.dev`)

---

## 📊 비용 추정 (DAU 1000 기준)

| 항목 | AWS S3+CloudFront | Cloudflare R2 |
|------|-------------------|---------------|
| 스토리지 (10GB) | $0.23/월 | **무료** (10GB 포함) |
| 전송량 (30GB/월) | ~$2.7/월 | **무료** (무제한) |
| API 요청 (100만) | $0.40/월 | **무료** (1천만/월 포함) |
| **총합** | **~$3.33/월** | **$0/월** |

**결론**: Cloudflare R2 강력 추천! 💰

---

## ✅ 완료 체크리스트

- [ ] `.env` 파일에 S3/R2 설정 추가
- [ ] Cloudflare R2 버킷 생성 & Public Access 설정
- [ ] 백엔드 서버 재시작
- [ ] 이미지 업로드 API 테스트 (curl)
- [ ] Admin UI에서 팝업 생성 & 이미지 업로드
- [ ] DB에서 image_storage='cdn' 확인
- [ ] Instagram scontent URL 차단 확인
- [ ] DMCA Takedown API 테스트
- [ ] 프론트엔드(사용자 앱)에서 이미지 렌더링 확인

---

## 🚀 다음 단계 (선택적 개선)

1. **이미지 중복 체크**: 동일 파일 해시 업로드 방지
2. **자동 크롭**: AI 기반 중요 영역 감지 & 크롭
3. **Lazy Loading**: 사용자 앱에서 이미지 lazy-load
4. **WebP 폴백**: 구형 브라우저를 위한 JPEG 폴백
5. **이미지 통계**: 가장 많이 사용된 이미지 출처 분석
6. **자동 삭제**: 종료된 이벤트 이미지 90일 후 자동 삭제
7. **워터마크**: 'FAIRPICK' 로고 자동 추가 (선택)

---

## 📞 문의

문제가 발생하면 다음을 확인하세요:
1. Backend 서버 로그 (`backend/logs/`)
2. Browser 콘솔 (F12 DevTools)
3. PostgreSQL 로그 (`image_audit_log` 테이블)
4. R2/S3 대시보드 (업로드 내역)

---

**작성일**: 2026-01-23  
**버전**: 1.0.0 (MVP)  
**담당자**: Fairpick Dev Team

