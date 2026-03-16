/**
 * 스케줄러 전용 서비스 진입점
 *
 * API 서버(index.ts)와 분리해 Railway 별도 서비스로 실행합니다.
 * 메모리 집약적인 파이프라인이 API 서버의 메모리를 침범하지 않습니다.
 *
 * Railway 설정:
 *   - Start Command: npm run start:scheduler
 *   - ENABLE_SCHEDULER=true
 *   - 나머지 환경변수(DATABASE_URL 등)는 API 서비스와 동일
 */

import express from 'express';
import { initScheduler } from './scheduler';

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

// Railway healthcheck용 최소 엔드포인트
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', role: 'scheduler' });
});

app.listen(PORT, () => {
  console.log(`[SchedulerService] Health endpoint listening on port ${PORT}`);
  console.log(`[SchedulerService] NODE_ENV=${process.env.NODE_ENV}`);
  initScheduler();
});

process.on('SIGTERM', () => {
  console.log('[SchedulerService] Received SIGTERM, shutting down gracefully...');
  process.exit(0);
});
