# Database Migrations

This directory contains SQL migration files for the fairpick-app backend database.

## Quick Start (신규 설치)

```bash
cd backend

# 1. Featured 컬럼 전체 추가 (통합 마이그레이션)
psql $DATABASE_URL -f migrations/20251223_add_all_featured_columns.sql

# 2. 조회수 기능 추가
psql $DATABASE_URL -f migrations/20251223_add_event_views.sql
```

## Migration File Naming Convention

```
YYYYMMDDHHMMSS_description.sql
```

Example: `20251223_add_all_featured_columns.sql`

## How to Run Migrations

### Option 1: Using psql with DATABASE_URL (권장)

```bash
cd backend

# Featured 컬럼 추가
psql $DATABASE_URL -f migrations/20251223_add_all_featured_columns.sql

# 조회수 기능 추가
psql $DATABASE_URL -f migrations/20251223_add_event_views.sql
```

### Option 2: Using psql directly

```bash
psql -h localhost -U kimsungtae -d fairpick \
  -f migrations/20251223_add_all_featured_columns.sql
```

### Option 3: Interactive psql

```bash
# Connect to your PostgreSQL database
psql -h localhost -U kimsungtae -d fairpick

# Run the migration
\i migrations/20251223_add_all_featured_columns.sql
```

## Verification

After running a migration, verify the changes:

```sql
-- Check if columns were added
SELECT column_name, data_type, column_default, is_nullable
FROM information_schema.columns
WHERE table_name = 'canonical_events'
  AND column_name IN ('is_featured', 'featured_score');

-- Check indexes
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'canonical_events'
  AND indexname LIKE '%featured%';

-- Count featured events
SELECT COUNT(*) AS featured_count
FROM canonical_events
WHERE is_featured = true;
```

## Rollback

Each migration file contains a rollback section at the bottom. To rollback:

```sql
-- Copy the DOWN migration section from the migration file and run it
BEGIN;
DROP INDEX IF EXISTS idx_canonical_events_featured_score;
DROP INDEX IF EXISTS idx_canonical_events_is_featured;
ALTER TABLE canonical_events DROP COLUMN IF EXISTS featured_score;
ALTER TABLE canonical_events DROP COLUMN IF EXISTS is_featured;
COMMIT;
```

## Migration History

| Date | File | Description |
|------|------|-------------|
| 2025-12-23 | `20251223_add_featured_columns_to_canonical_events.sql` | Phase 1: Add `is_featured` and `featured_score` columns for recommendation system |

## Notes

- All migrations are wrapped in `BEGIN` and `COMMIT` for transactional safety
- Use `IF NOT EXISTS` / `IF EXISTS` for idempotency
- Always test migrations on a development database first
- Keep rollback scripts for emergency recovery
