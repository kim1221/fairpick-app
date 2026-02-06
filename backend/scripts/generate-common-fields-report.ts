/**
 * Common Fields Status Report Generator
 * 
 * 목적: canonical_events 테이블의 컬럼 존재 여부와 커버리지를 자동으로 감사하여 Markdown 보고서 생성
 * 
 * 실행: cd backend && npm run audit:common-fields
 */

import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================
// 타입 정의
// ============================================================

interface ColumnInfo {
  column_name: string;
  data_type: string;
  is_nullable: string;
}

interface CoverageRow {
  field_name: string;
  non_null_count: string;
  null_or_blank_count: string;
  coverage_pct: string;
}

interface FieldDefinition {
  group: string;
  field: string;
  expectedType: string;
  purpose: string;
  nextAction?: string;
}

// ============================================================
// 필드 정의 (25개 + 기타)
// ============================================================

const FIELD_DEFINITIONS: FieldDefinition[] = [
  // Core Identity
  { group: 'Core Identity', field: 'id', expectedType: 'uuid', purpose: 'Primary Key' },
  { group: 'Core Identity', field: 'title', expectedType: 'text', purpose: '이벤트 제목' },
  { group: 'Core Identity', field: 'display_title', expectedType: 'text', purpose: '표시용 제목 (중복 제거)' },
  { group: 'Core Identity', field: 'content_key', expectedType: 'text', purpose: '콘텐츠 중복 판별 키' },
  
  // Time
  { group: 'Time', field: 'start_at', expectedType: 'date', purpose: '시작일' },
  { group: 'Time', field: 'end_at', expectedType: 'date', purpose: '종료일' },
  { group: 'Time', field: 'is_ending_soon', expectedType: 'boolean', purpose: '종료 임박 플래그' },
  
  // Location
  { group: 'Location', field: 'venue', expectedType: 'text', purpose: '장소명' },
  { group: 'Location', field: 'region', expectedType: 'text', purpose: '지역' },
  { group: 'Location', field: 'address', expectedType: 'text', purpose: '상세 주소' },
  { group: 'Location', field: 'lat', expectedType: 'float', purpose: '위도' },
  { group: 'Location', field: 'lng', expectedType: 'float', purpose: '경도' },
  
  // Category
  { group: 'Category', field: 'main_category', expectedType: 'text', purpose: '주 카테고리' },
  { group: 'Category', field: 'sub_category', expectedType: 'text', purpose: '부 카테고리' },
  
  // Content
  { group: 'Content', field: 'overview', expectedType: 'text', purpose: '상세 설명' },
  { group: 'Content', field: 'image_url', expectedType: 'text', purpose: '대표 이미지' },
  
  // Price
  { group: 'Price', field: 'is_free', expectedType: 'boolean', purpose: '무료 여부' },
  { group: 'Price', field: 'price_info', expectedType: 'text', purpose: '가격 정보 텍스트' },
  
  // Scoring
  { group: 'Scoring', field: 'popularity_score', expectedType: 'integer', purpose: 'Popularity Score (DB 계산)' },
  { group: 'Scoring', field: 'buzz_score', expectedType: 'float', purpose: 'Buzz Score (사용자 행동 기반 인기도)', nextAction: 'OK - Phase 1 완성' },
  
  // AI/Context (미구현)
  { group: 'AI/Context', field: 'tags_context', expectedType: 'jsonb', purpose: 'AI 생성 태그 (분위기/타겟/특징)', nextAction: 'AI 생성 필요 - Gemini API 연동' },
  { group: 'AI/Context', field: 'metadata', expectedType: 'jsonb', purpose: '추가 메타데이터 (확장용)', nextAction: '마이그레이션 필요 - jsonb 컬럼 추가' },
  
  // Curation
  { group: 'Curation', field: 'is_featured', expectedType: 'boolean', purpose: 'Featured 플래그' },
  { group: 'Curation', field: 'featured_order', expectedType: 'integer', purpose: 'Featured 정렬 순서' },
  { group: 'Curation', field: 'featured_at', expectedType: 'timestamp', purpose: 'Featured 등록 시각' },
];

// ============================================================
// Main
// ============================================================

async function main() {
  console.log('🔍 Starting Common Fields Audit...\n');

  // DB 연결
  const pool = new Pool({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5432'),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  try {
    // 1. DB 메타정보
    console.log('📊 Fetching DB metadata...');
    const metaResult = await pool.query('SELECT current_database() as db, current_user as user, version() as version');
    const meta = metaResult.rows[0];

    // 2. 컬럼 존재 여부 확인
    console.log('📋 Checking column existence...');
    const columnsResult = await pool.query<ColumnInfo>(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'canonical_events'
      ORDER BY ordinal_position
    `);
    const existingColumns = new Map(columnsResult.rows.map(c => [c.column_name, c]));

    // 3. audit-common-fields.sql 실행
    console.log('🔍 Running audit SQL...');
    const sqlPath = path.join(__dirname, 'audit-common-fields.sql');
    const sql = fs.readFileSync(sqlPath, 'utf-8');
    
    // SQL을 섹션별로 파싱 (psql \echo는 제거)
    const cleanSql = sql.replace(/\\echo[^\n]*/g, '');
    
    // 각 쿼리 실행 (간단하게 전체 실행)
    const auditResult = await pool.query(cleanSql);

    // 4. 커버리지 데이터 추출
    console.log('📈 Extracting coverage data...');
    const coverageMap = new Map<string, CoverageRow>();
    
    // Coverage 쿼리 결과 파싱 (여러 결과셋 중 coverage 부분)
    // 간단하게 다시 쿼리
    const coverageResult = await pool.query<CoverageRow>(`
      WITH active_total AS (
        SELECT COUNT(*) as total FROM canonical_events WHERE is_deleted = false
      )
      SELECT
        'id' as field_name,
        COUNT(*) FILTER (WHERE id IS NOT NULL) as non_null_count,
        ROUND(100.0 * COUNT(*) FILTER (WHERE id IS NOT NULL) / (SELECT total FROM active_total), 2) as coverage_pct
      FROM canonical_events WHERE is_deleted = false
      UNION ALL
      SELECT 'title', COUNT(*) FILTER (WHERE title IS NOT NULL AND title != ''), ROUND(100.0 * COUNT(*) FILTER (WHERE title IS NOT NULL AND title != '') / (SELECT total FROM active_total), 2) FROM canonical_events WHERE is_deleted = false
      UNION ALL
      SELECT 'start_at', COUNT(*) FILTER (WHERE start_at IS NOT NULL), ROUND(100.0 * COUNT(*) FILTER (WHERE start_at IS NOT NULL) / (SELECT total FROM active_total), 2) FROM canonical_events WHERE is_deleted = false
      UNION ALL
      SELECT 'end_at', COUNT(*) FILTER (WHERE end_at IS NOT NULL), ROUND(100.0 * COUNT(*) FILTER (WHERE end_at IS NOT NULL) / (SELECT total FROM active_total), 2) FROM canonical_events WHERE is_deleted = false
      UNION ALL
      SELECT 'venue', COUNT(*) FILTER (WHERE venue IS NOT NULL AND venue != ''), ROUND(100.0 * COUNT(*) FILTER (WHERE venue IS NOT NULL AND venue != '') / (SELECT total FROM active_total), 2) FROM canonical_events WHERE is_deleted = false
      UNION ALL
      SELECT 'region', COUNT(*) FILTER (WHERE region IS NOT NULL AND region != ''), ROUND(100.0 * COUNT(*) FILTER (WHERE region IS NOT NULL AND region != '') / (SELECT total FROM active_total), 2) FROM canonical_events WHERE is_deleted = false
      UNION ALL
      SELECT 'main_category', COUNT(*) FILTER (WHERE main_category IS NOT NULL AND main_category != ''), ROUND(100.0 * COUNT(*) FILTER (WHERE main_category IS NOT NULL AND main_category != '') / (SELECT total FROM active_total), 2) FROM canonical_events WHERE is_deleted = false
      UNION ALL
      SELECT 'sub_category', COUNT(*) FILTER (WHERE sub_category IS NOT NULL AND sub_category != ''), ROUND(100.0 * COUNT(*) FILTER (WHERE sub_category IS NOT NULL AND sub_category != '') / (SELECT total FROM active_total), 2) FROM canonical_events WHERE is_deleted = false
      UNION ALL
      SELECT 'image_url', COUNT(*) FILTER (WHERE image_url IS NOT NULL AND image_url != ''), ROUND(100.0 * COUNT(*) FILTER (WHERE image_url IS NOT NULL AND image_url != '') / (SELECT total FROM active_total), 2) FROM canonical_events WHERE is_deleted = false
      UNION ALL
      SELECT 'overview', COUNT(*) FILTER (WHERE overview IS NOT NULL AND overview != ''), ROUND(100.0 * COUNT(*) FILTER (WHERE overview IS NOT NULL AND overview != '') / (SELECT total FROM active_total), 2) FROM canonical_events WHERE is_deleted = false
      UNION ALL
      SELECT 'address', COUNT(*) FILTER (WHERE address IS NOT NULL AND address != ''), ROUND(100.0 * COUNT(*) FILTER (WHERE address IS NOT NULL AND address != '') / (SELECT total FROM active_total), 2) FROM canonical_events WHERE is_deleted = false
      UNION ALL
      SELECT 'lat', COUNT(*) FILTER (WHERE lat IS NOT NULL), ROUND(100.0 * COUNT(*) FILTER (WHERE lat IS NOT NULL) / (SELECT total FROM active_total), 2) FROM canonical_events WHERE is_deleted = false
      UNION ALL
      SELECT 'lng', COUNT(*) FILTER (WHERE lng IS NOT NULL), ROUND(100.0 * COUNT(*) FILTER (WHERE lng IS NOT NULL) / (SELECT total FROM active_total), 2) FROM canonical_events WHERE is_deleted = false
      UNION ALL
      SELECT 'is_free', COUNT(*) FILTER (WHERE is_free IS NOT NULL), ROUND(100.0 * COUNT(*) FILTER (WHERE is_free IS NOT NULL) / (SELECT total FROM active_total), 2) FROM canonical_events WHERE is_deleted = false
      UNION ALL
      SELECT 'price_info', COUNT(*) FILTER (WHERE price_info IS NOT NULL AND price_info != ''), ROUND(100.0 * COUNT(*) FILTER (WHERE price_info IS NOT NULL AND price_info != '') / (SELECT total FROM active_total), 2) FROM canonical_events WHERE is_deleted = false
      UNION ALL
      SELECT 'display_title', COUNT(*) FILTER (WHERE display_title IS NOT NULL AND display_title != ''), ROUND(100.0 * COUNT(*) FILTER (WHERE display_title IS NOT NULL AND display_title != '') / (SELECT total FROM active_total), 2) FROM canonical_events WHERE is_deleted = false
      UNION ALL
      SELECT 'content_key', COUNT(*) FILTER (WHERE content_key IS NOT NULL AND content_key != ''), ROUND(100.0 * COUNT(*) FILTER (WHERE content_key IS NOT NULL AND content_key != '') / (SELECT total FROM active_total), 2) FROM canonical_events WHERE is_deleted = false
      UNION ALL
      SELECT 'is_ending_soon', COUNT(*) FILTER (WHERE is_ending_soon IS NOT NULL), ROUND(100.0 * COUNT(*) FILTER (WHERE is_ending_soon IS NOT NULL) / (SELECT total FROM active_total), 2) FROM canonical_events WHERE is_deleted = false
      UNION ALL
      SELECT 'popularity_score', COUNT(*) FILTER (WHERE popularity_score IS NOT NULL), ROUND(100.0 * COUNT(*) FILTER (WHERE popularity_score IS NOT NULL) / (SELECT total FROM active_total), 2) FROM canonical_events WHERE is_deleted = false
      UNION ALL
      SELECT 'buzz_score', COUNT(*) FILTER (WHERE buzz_score IS NOT NULL), ROUND(100.0 * COUNT(*) FILTER (WHERE buzz_score IS NOT NULL) / (SELECT total FROM active_total), 2) FROM canonical_events WHERE is_deleted = false
      UNION ALL
      SELECT 'is_featured', COUNT(*) FILTER (WHERE is_featured IS NOT NULL), ROUND(100.0 * COUNT(*) FILTER (WHERE is_featured IS NOT NULL) / (SELECT total FROM active_total), 2) FROM canonical_events WHERE is_deleted = false
      UNION ALL
      SELECT 'featured_order', COUNT(*) FILTER (WHERE featured_order IS NOT NULL), ROUND(100.0 * COUNT(*) FILTER (WHERE featured_order IS NOT NULL) / (SELECT total FROM active_total), 2) FROM canonical_events WHERE is_deleted = false
      UNION ALL
      SELECT 'featured_at', COUNT(*) FILTER (WHERE featured_at IS NOT NULL), ROUND(100.0 * COUNT(*) FILTER (WHERE featured_at IS NOT NULL) / (SELECT total FROM active_total), 2) FROM canonical_events WHERE is_deleted = false
    `);

    coverageResult.rows.forEach(row => {
      coverageMap.set(row.field_name, row);
    });

    // 5. Active count
    const countResult = await pool.query('SELECT COUNT(*) FILTER (WHERE is_deleted = false) as active FROM canonical_events');
    const activeCount = parseInt(countResult.rows[0].active);

    // 6. 정합성 체크
    const integrityResult = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE start_at > end_at) as date_anomalies,
        COUNT(*) FILTER (WHERE lat < -90 OR lat > 90) as lat_anomalies,
        COUNT(*) FILTER (WHERE lng < -180 OR lng > 180) as lng_anomalies
      FROM canonical_events
      WHERE is_deleted = false
        AND start_at IS NOT NULL
        AND end_at IS NOT NULL
    `);
    const integrity = integrityResult.rows[0];

    // 7. 보고서 생성
    console.log('📝 Generating report...');
    const report = generateMarkdownReport(
      meta,
      existingColumns,
      coverageMap,
      activeCount,
      integrity
    );

    // 8. 보고서 저장
    const reportPath = path.join(__dirname, '../../docs/COMMON_FIELDS_STATUS_REPORT.md');
    fs.writeFileSync(reportPath, report, 'utf-8');

    console.log(`\n✅ Report generated: ${reportPath}`);
    console.log(`📊 Active events: ${activeCount.toLocaleString()}`);
    console.log(`📋 Fields checked: ${FIELD_DEFINITIONS.length}`);

    await pool.end();
  } catch (error) {
    console.error('❌ Error:', error);
    await pool.end();
    process.exit(1);
  }
}

// ============================================================
// Report Generator
// ============================================================

function generateMarkdownReport(
  meta: any,
  existingColumns: Map<string, ColumnInfo>,
  coverageMap: Map<string, CoverageRow>,
  activeCount: number,
  integrity: any
): string {
  const now = new Date();
  const kstTime = new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().replace('T', ' ').substring(0, 19);

  let md = '';

  // Header
  md += `# Common Fields Status Report\n\n`;
  md += `**작성일:** ${kstTime} KST  \n`;
  md += `**Database:** ${meta.db}  \n`;
  md += `**User:** ${meta.user}  \n`;
  md += `**Active Events:** ${activeCount.toLocaleString()}  \n\n`;

  md += `---\n\n`;

  // Executive Summary
  md += `## 📊 Executive Summary\n\n`;
  
  const coverageStats = Array.from(coverageMap.values());
  const avgCoverage = coverageStats.length > 0
    ? coverageStats.reduce((sum, r) => sum + parseFloat(r.coverage_pct), 0) / coverageStats.length
    : 0;

  md += `- **Overall Coverage:** ${avgCoverage.toFixed(2)}% (존재 컬럼 기준)\n`;
  md += `- **Total Fields Defined:** ${FIELD_DEFINITIONS.length}\n`;
  md += `- **Existing Columns:** ${existingColumns.size}\n`;
  md += `- **Missing Columns:** ${FIELD_DEFINITIONS.filter(f => !existingColumns.has(f.field)).length}\n\n`;

  // Status Legend
  md += `### Status Legend\n\n`;
  md += `- ✅ **Good:** Coverage ≥ 95%\n`;
  md += `- ⚠️ **Warning:** 50% ≤ Coverage < 95%\n`;
  md += `- ❌ **Critical:** Coverage < 50% or Column Missing\n\n`;

  md += `---\n\n`;

  // 25개 필드 상태표
  md += `## 📋 25 Fields Status Table\n\n`;
  md += `| Group | Field | Expected Type | Exists | Coverage | Status | Next Action |\n`;
  md += `|-------|-------|---------------|--------|----------|--------|-------------|\n`;

  for (const def of FIELD_DEFINITIONS) {
    const exists = existingColumns.has(def.field);
    const coverage = coverageMap.get(def.field);
    const coveragePct = coverage ? parseFloat(coverage.coverage_pct) : 0;

    let status = '❌';
    let nextAction = def.nextAction || '';

    if (!exists) {
      status = '❌';
      nextAction = nextAction || '마이그레이션 필요';
    } else if (coveragePct >= 95) {
      status = '✅';
      nextAction = nextAction || 'OK';
    } else if (coveragePct >= 50) {
      status = '⚠️';
      nextAction = nextAction || `데이터 보완 필요 (${coveragePct.toFixed(1)}%)`;
    } else {
      status = '❌';
      nextAction = nextAction || `데이터 수집 필요 (${coveragePct.toFixed(1)}%)`;
    }

    const actualType = exists ? existingColumns.get(def.field)!.data_type : 'N/A';
    const coverageStr = exists ? `${coveragePct.toFixed(1)}%` : 'N/A';

    md += `| ${def.group} | \`${def.field}\` | ${def.expectedType} | ${exists ? '✅' : '❌'} | ${coverageStr} | ${status} | ${nextAction} |\n`;
  }

  md += `\n---\n\n`;

  // 미완료 항목 상세
  md += `## ⚠️ Incomplete Fields Detail\n\n`;

  const incompleteFields = FIELD_DEFINITIONS.filter(f => {
    const exists = existingColumns.has(f.field);
    const coverage = coverageMap.get(f.field);
    const coveragePct = coverage ? parseFloat(coverage.coverage_pct) : 0;
    return !exists || coveragePct < 95;
  });

  for (const field of incompleteFields) {
    const exists = existingColumns.has(field.field);
    const coverage = coverageMap.get(field.field);
    const coveragePct = coverage ? parseFloat(coverage.coverage_pct) : 0;

    md += `### \`${field.field}\` (${field.group})\n\n`;
    md += `- **Purpose:** ${field.purpose}\n`;
    md += `- **Exists:** ${exists ? '✅ Yes' : '❌ No'}\n`;
    md += `- **Coverage:** ${exists ? `${coveragePct.toFixed(1)}%` : 'N/A'}\n`;

    if (!exists) {
      md += `- **Issue:** 컬럼이 DB에 존재하지 않음\n`;
      md += `- **Next Action:** ${field.nextAction || '마이그레이션 필요'}\n`;
    } else if (coveragePct < 50) {
      md += `- **Issue:** 데이터 커버리지가 매우 낮음 (<50%)\n`;
      md += `- **Next Action:** ${field.nextAction || '데이터 수집/계산 로직 추가 필요'}\n`;
    } else {
      md += `- **Issue:** 데이터 커버리지 부족 (50-95%)\n`;
      md += `- **Next Action:** ${field.nextAction || '데이터 보완 권장'}\n`;
    }

    md += `\n`;
  }

  md += `---\n\n`;

  // 정합성 오류
  md += `## 🔍 Data Integrity Issues\n\n`;

  if (parseInt(integrity.date_anomalies) > 0) {
    md += `### ❌ start_at > end_at Anomalies\n\n`;
    md += `- **Count:** ${integrity.date_anomalies}\n`;
    md += `- **Action:** 데이터 수정 필요\n\n`;
  }

  if (parseInt(integrity.lat_anomalies) > 0 || parseInt(integrity.lng_anomalies) > 0) {
    md += `### ❌ lat/lng Range Anomalies\n\n`;
    md += `- **lat out of range (-90~90):** ${integrity.lat_anomalies}\n`;
    md += `- **lng out of range (-180~180):** ${integrity.lng_anomalies}\n`;
    md += `- **Action:** 지오코딩 재실행 필요\n\n`;
  }

  if (parseInt(integrity.date_anomalies) === 0 && parseInt(integrity.lat_anomalies) === 0 && parseInt(integrity.lng_anomalies) === 0) {
    md += `✅ **No integrity issues found.**\n\n`;
  }

  md += `---\n\n`;

  // Footer
  md += `## 📚 References\n\n`;
  md += `- **SQL Script:** \`backend/scripts/audit-common-fields.sql\`\n`;
  md += `- **Generator:** \`backend/scripts/generate-common-fields-report.ts\`\n`;
  md += `- **Execution:** \`cd backend && npm run audit:common-fields\`\n\n`;

  md += `---\n\n`;
  md += `**Generated by:** Fairpick Backend Auditor  \n`;
  md += `**Timestamp:** ${new Date().toISOString()}  \n`;

  return md;
}

// Run
main();

