import dotenv from 'dotenv';
import path from 'path';

// .env 파일 명시적 경로 지정
const envPath = path.resolve(__dirname, '../.env');
const result = dotenv.config({ path: envPath });

if (result.error) {
  console.error('[config] dotenv error:', result.error);
} else {
  console.log('[config] dotenv loaded:', Object.keys(result.parsed || {}).length, 'variables from', envPath);
}

export const config = {
  tourApiKey: process.env.TOUR_API_KEY ?? '',
  kakaoRestApiKey: process.env.KAKAO_REST_API_KEY ?? '',
  geminiApiKey: process.env.GEMINI_API_KEY ?? '', // 향후 임베딩/분석용
  openaiApiKey: process.env.OPENAI_API_KEY ?? '', // GPT-4o-mini for banner copy

  // ── 토스 로그인 (앱인토스 파트너 API) ──────────────────────────────
  toss: {
    apiBaseUrl: 'https://apps-in-toss-api.toss.im',
    // 개인정보 복호화 키 (콘솔 이메일로 받아요, AES-256-GCM, base64 인코딩)
    decryptKey: process.env.TOSS_DECRYPT_KEY ?? '',
    decryptAad: process.env.TOSS_DECRYPT_AAD ?? '',
    // 연결끊기 콜백 검증용 시크릿 (콘솔 설정 > 연결끊기 콜백 URL 등록 시 발급)
    callbackSecret: process.env.TOSS_CALLBACK_SECRET ?? '',
    // mTLS 인증서 (콘솔 > mTLS 인증서 탭에서 발급)
    certPath: process.env.TOSS_CERT_PATH ?? '',
    keyPath: process.env.TOSS_KEY_PATH ?? '',
  },

  // ── JWT (우리 앱 자체 세션 토큰) ─────────────────────────────────
  jwtSecret: process.env.JWT_SECRET ?? 'change-me-in-production',
  jwtExpiresIn: '30d',

  db: {
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? '5432'),
    user: process.env.DB_USER ?? 'postgres',
    password: process.env.DB_PASSWORD ?? '',
    database: process.env.DB_NAME ?? 'fairpick',
  },
  s3: {
    endpoint: process.env.S3_ENDPOINT, // R2: https://<account-id>.r2.cloudflarestorage.com
    region: process.env.AWS_REGION || 'auto', // R2는 'auto', AWS는 'ap-northeast-2' 등
    accessKeyId: process.env.S3_ACCESS_KEY ?? '',
    secretAccessKey: process.env.S3_SECRET_KEY ?? '',
    bucket: process.env.S3_BUCKET ?? '',
  },
  cdnBaseUrl: process.env.CDN_BASE_URL ?? '', // https://cdn.fairpick.kr 또는 R2 public URL
};

if (!config.tourApiKey) {
  console.warn('[config] TOUR_API_KEY is not set. TourAPI collector will skip fetching.');
}

