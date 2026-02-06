# Fairpick Backend (WIP)

## 구조
- `src/config.ts`: 환경 변수 로딩(`.env`)
- `src/db.ts`: PostgreSQL 연결 및 `upsertEvent`
- `src/mappers/tourApiMapper.ts`: TourAPI → 공통 스키마 매핑
- `src/collectors/tourApiCollector.ts`: TourAPI 호출 후 DB 저장

## 사용법
1. `.env` 생성
   ```
   TOUR_API_KEY=YOUR_KEY
   DB_HOST=localhost
   DB_PORT=5432
   DB_USER=postgres
   DB_PASSWORD=secret
   DB_NAME=fairpick
   ```
2. PostgreSQL에 `docs/backend/db-schema.sql` 실행
3. `npm install`
4. 수집: `npm run collect:tourapi`
5. API 서버 실행: `npm run start` (기본 포트 4000, `/events`, `/events/:id`, `/health`)

## TODO
- 다른 소스 Collector 추가
- REST API 서버 구현
- 테스트/모니터링 보완

