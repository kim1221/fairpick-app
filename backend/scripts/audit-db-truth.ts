/**
 * DB Truth Audit Script
 * 
 * 목적: popularity_score와 buzz_score 관련 테이블/컬럼의
 *       실제 DB 존재 여부 및 데이터 분포를 검증
 * 
 * 원칙: 마이그레이션 파일이 아닌 실제 DB 쿼리 결과만 근거로 판정
 */

import { pool } from '../src/db';
import * as fs from 'fs';
import * as path from 'path';

interface AuditResult {
  section: string;
  query: string;
  result: any;
  conclusion: string;
}

const auditResults: AuditResult[] = [];

// ============================================
// STEP 1: popularity_score 실체 검증
// ============================================

async function auditPopularityScore() {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║  STEP 1: popularity_score 실체 검증   ║');
  console.log('╚════════════════════════════════════════╝\n');

  // 1-1. 분포 요약
  const query1 = `
SELECT
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE popularity_score IS NULL) AS null_cnt,
  COUNT(*) FILTER (WHERE popularity_score = 0) AS zero_cnt,
  MIN(popularity_score) AS min_score,
  MAX(popularity_score) AS max_score,
  ROUND(AVG(popularity_score)::numeric, 2) AS avg_score
FROM canonical_events
WHERE is_deleted = false;
  `;

  try {
    const result1 = await pool.query(query1);
    console.log('✅ [1-1] popularity_score 분포 요약');
    console.table(result1.rows);
    
    auditResults.push({
      section: '1-1. popularity_score 분포 요약',
      query: query1.trim(),
      result: result1.rows,
      conclusion: `Total: ${result1.rows[0].total}, Max: ${result1.rows[0].max_score}, Avg: ${result1.rows[0].avg_score}`,
    });
  } catch (error: any) {
    console.error('❌ [1-1] 실패:', error.message);
    auditResults.push({
      section: '1-1. popularity_score 분포 요약',
      query: query1.trim(),
      result: { error: error.message },
      conclusion: 'FAILED - Query execution error',
    });
  }

  // 1-2. 상위 빈도값 TOP 20
  const query2 = `
SELECT popularity_score, COUNT(*) AS cnt
FROM canonical_events
WHERE is_deleted = false
GROUP BY popularity_score
ORDER BY cnt DESC
LIMIT 20;
  `;

  try {
    const result2 = await pool.query(query2);
    console.log('\n✅ [1-2] popularity_score 상위 빈도값 TOP 20');
    console.table(result2.rows);
    
    const top1 = result2.rows[0];
    const top1_pct = result2.rows.length > 0 ? (top1.cnt / result2.rows.reduce((sum, r) => sum + parseInt(r.cnt), 0) * 100).toFixed(2) : '0';
    
    auditResults.push({
      section: '1-2. popularity_score 상위 빈도값 TOP 20',
      query: query2.trim(),
      result: result2.rows,
      conclusion: `TOP 1: score=${top1?.popularity_score}, cnt=${top1?.cnt} (${top1_pct}%)`,
    });
  } catch (error: any) {
    console.error('❌ [1-2] 실패:', error.message);
    auditResults.push({
      section: '1-2. popularity_score 상위 빈도값 TOP 20',
      query: query2.trim(),
      result: { error: error.message },
      conclusion: 'FAILED - Query execution error',
    });
  }

  // 1-3. 상한 실사용 여부
  const query3 = `
SELECT
  MAX(popularity_score) AS max_score,
  COUNT(*) FILTER (WHERE popularity_score >= 480) AS ge_480_cnt,
  COUNT(*) FILTER (WHERE popularity_score >= 900) AS ge_900_cnt
FROM canonical_events
WHERE is_deleted = false;
  `;

  try {
    const result3 = await pool.query(query3);
    console.log('\n✅ [1-3] popularity_score 상한 실사용 여부');
    console.table(result3.rows);
    
    auditResults.push({
      section: '1-3. popularity_score 상한 실사용 여부',
      query: query3.trim(),
      result: result3.rows,
      conclusion: `Max: ${result3.rows[0].max_score}, ≥480: ${result3.rows[0].ge_480_cnt}, ≥900: ${result3.rows[0].ge_900_cnt}`,
    });
  } catch (error: any) {
    console.error('❌ [1-3] 실패:', error.message);
    auditResults.push({
      section: '1-3. popularity_score 상한 실사용 여부',
      query: query3.trim(),
      result: { error: error.message },
      conclusion: 'FAILED - Query execution error',
    });
  }

  // 1-4. 최근 업데이트 시각 분포
  const query4 = `
SELECT
  DATE_TRUNC('hour', updated_at AT TIME ZONE 'Asia/Seoul') AS hour_kst,
  COUNT(*) AS cnt
FROM canonical_events
WHERE updated_at >= NOW() - INTERVAL '3 days'
  AND is_deleted = false
GROUP BY 1
ORDER BY 1 DESC
LIMIT 30;
  `;

  try {
    const result4 = await pool.query(query4);
    console.log('\n✅ [1-4] popularity_score 최근 업데이트 시각 분포');
    console.table(result4.rows.slice(0, 10));
    
    auditResults.push({
      section: '1-4. 최근 업데이트 시각 분포 (3일간)',
      query: query4.trim(),
      result: result4.rows,
      conclusion: `Recent updates: ${result4.rows.length} distinct hours`,
    });
  } catch (error: any) {
    console.error('❌ [1-4] 실패:', error.message);
    auditResults.push({
      section: '1-4. 최근 업데이트 시각 분포',
      query: query4.trim(),
      result: { error: error.message },
      conclusion: 'FAILED - Query execution error',
    });
  }
}

// ============================================
// STEP 2: Buzz Score 스키마 실체 감사
// ============================================

async function auditBuzzScoreSchema() {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║  STEP 2: Buzz Score 스키마 실체 감사  ║');
  console.log('╚════════════════════════════════════════╝\n');

  // 2-1. 전체 테이블 목록
  const query1 = `
SELECT tablename
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;
  `;

  try {
    const result1 = await pool.query(query1);
    console.log('✅ [2-1] 전체 테이블 목록 (public 스키마)');
    console.log('Tables:', result1.rows.map(r => r.tablename).join(', '));
    
    auditResults.push({
      section: '2-1. 전체 테이블 목록',
      query: query1.trim(),
      result: result1.rows,
      conclusion: `Total tables: ${result1.rows.length}`,
    });
  } catch (error: any) {
    console.error('❌ [2-1] 실패:', error.message);
    auditResults.push({
      section: '2-1. 전체 테이블 목록',
      query: query1.trim(),
      result: { error: error.message },
      conclusion: 'FAILED - Query execution error',
    });
  }

  // 2-2. buzz_score 관련 후보 테이블 존재 여부
  const query2 = `
SELECT tablename
FROM pg_tables
WHERE schemaname='public'
  AND tablename IN (
    'canonical_events',
    'event_views',
    'event_actions',
    'event_impressions',
    'event_engagement_agg'
  )
ORDER BY tablename;
  `;

  try {
    const result2 = await pool.query(query2);
    console.log('\n✅ [2-2] buzz_score 관련 후보 테이블 존재 여부');
    console.table(result2.rows);
    
    const exists = result2.rows.map(r => r.tablename);
    const missing = ['canonical_events', 'event_views', 'event_actions', 'event_impressions', 'event_engagement_agg']
      .filter(t => !exists.includes(t));
    
    auditResults.push({
      section: '2-2. buzz_score 관련 후보 테이블 존재 여부',
      query: query2.trim(),
      result: result2.rows,
      conclusion: `EXISTS: [${exists.join(', ')}], MISSING: [${missing.join(', ')}]`,
    });
  } catch (error: any) {
    console.error('❌ [2-2] 실패:', error.message);
    auditResults.push({
      section: '2-2. buzz_score 관련 후보 테이블 존재 여부',
      query: query2.trim(),
      result: { error: error.message },
      conclusion: 'FAILED - Query execution error',
    });
  }

  // 2-3. canonical_events 컬럼 실체 확인
  const query3 = `
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name='canonical_events'
ORDER BY ordinal_position;
  `;

  try {
    const result3 = await pool.query(query3);
    console.log('\n✅ [2-3] canonical_events 컬럼 실체 확인');
    console.table(result3.rows);
    
    const has_popularity = result3.rows.some(r => r.column_name === 'popularity_score');
    const has_view_count = result3.rows.some(r => r.column_name === 'view_count');
    const has_buzz = result3.rows.some(r => r.column_name === 'buzz_score');
    
    auditResults.push({
      section: '2-3. canonical_events 컬럼 실체 확인',
      query: query3.trim(),
      result: result3.rows,
      conclusion: `popularity_score: ${has_popularity}, view_count: ${has_view_count}, buzz_score: ${has_buzz}`,
    });
  } catch (error: any) {
    console.error('❌ [2-3] 실패:', error.message);
    auditResults.push({
      section: '2-3. canonical_events 컬럼 실체 확인',
      query: query3.trim(),
      result: { error: error.message },
      conclusion: 'FAILED - Query execution error',
    });
  }

  // 2-4. event_views 테이블 존재 및 스키마
  const query4 = `
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name='event_views'
ORDER BY ordinal_position;
  `;

  try {
    const result4 = await pool.query(query4);
    
    if (result4.rows.length > 0) {
      console.log('\n✅ [2-4] event_views 테이블 스키마');
      console.table(result4.rows);
      
      const has_user_id = result4.rows.some(r => r.column_name === 'user_id');
      const has_session_id = result4.rows.some(r => r.column_name === 'session_id');
      
      auditResults.push({
        section: '2-4. event_views 테이블 스키마',
        query: query4.trim(),
        result: result4.rows,
        conclusion: `Exists: YES, user_id: ${has_user_id}, session_id: ${has_session_id}`,
      });
    } else {
      console.log('\n❌ [2-4] event_views 테이블 없음');
      auditResults.push({
        section: '2-4. event_views 테이블 스키마',
        query: query4.trim(),
        result: [],
        conclusion: 'Exists: NO',
      });
    }
  } catch (error: any) {
    console.error('❌ [2-4] 실패:', error.message);
    auditResults.push({
      section: '2-4. event_views 테이블 스키마',
      query: query4.trim(),
      result: { error: error.message },
      conclusion: 'FAILED - Query execution error',
    });
  }

  // 2-5. event_views FK 정합성 검증
  const query5 = `
SELECT
  ccu.table_name AS referenced_table,
  ccu.column_name AS referenced_column,
  kcu.table_name AS fk_table,
  kcu.column_name AS fk_column,
  tc.constraint_name
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage ccu
  ON ccu.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND kcu.table_name = 'event_views';
  `;

  try {
    const result5 = await pool.query(query5);
    console.log('\n✅ [2-5] event_views FK 정합성');
    
    if (result5.rows.length > 0) {
      console.table(result5.rows);
      auditResults.push({
        section: '2-5. event_views FK 정합성',
        query: query5.trim(),
        result: result5.rows,
        conclusion: `FK exists: YES, References: ${result5.rows[0]?.referenced_table}.${result5.rows[0]?.referenced_column}`,
      });
    } else {
      console.log('No FK constraints found');
      auditResults.push({
        section: '2-5. event_views FK 정합성',
        query: query5.trim(),
        result: [],
        conclusion: 'FK exists: NO',
      });
    }
  } catch (error: any) {
    console.error('❌ [2-5] 실패:', error.message);
    auditResults.push({
      section: '2-5. event_views FK 정합성',
      query: query5.trim(),
      result: { error: error.message },
      conclusion: 'FAILED - Query execution error or event_views does not exist',
    });
  }

  // 2-6. event_views 데이터 존재 여부
  const query6 = `
SELECT COUNT(*) as row_count
FROM event_views;
  `;

  try {
    const result6 = await pool.query(query6);
    console.log('\n✅ [2-6] event_views 데이터 존재 여부');
    console.log(`Row count: ${result6.rows[0].row_count}`);
    
    auditResults.push({
      section: '2-6. event_views 데이터 존재 여부',
      query: query6.trim(),
      result: result6.rows,
      conclusion: `Row count: ${result6.rows[0].row_count}`,
    });
  } catch (error: any) {
    console.error('❌ [2-6] 실패:', error.message);
    auditResults.push({
      section: '2-6. event_views 데이터 존재 여부',
      query: query6.trim(),
      result: { error: error.message },
      conclusion: 'FAILED - Table does not exist or query error',
    });
  }
}

// ============================================
// 보고서 생성
// ============================================

function generateReport(): string {
  const timestamp = new Date().toISOString();
  
  let report = `# DB Truth Audit Report

**작성일**: ${timestamp}  
**감사 방법**: 실제 DB 쿼리 결과만 근거로 판정  
**원칙**: 마이그레이션 파일은 참고만, 존재 판정은 DB 쿼리로만

---

## 📋 Executive Summary

이 보고서는 Fairpick PostgreSQL DB의 실제 상태를 감사한 결과입니다.

**감사 항목**:
1. popularity_score 실체 및 데이터 분포
2. buzz_score 관련 테이블/컬럼 존재 여부
3. 스키마 정합성 검증

**감사 결과**: 아래 내용 참조

---

`;

  // STEP 1 결과
  report += `## 🔍 STEP 1: popularity_score 실체 검증\n\n`;
  
  auditResults
    .filter(r => r.section.startsWith('1-'))
    .forEach(result => {
      report += `### ${result.section}\n\n`;
      report += `**SQL**:\n\`\`\`sql\n${result.query}\n\`\`\`\n\n`;
      report += `**결과**:\n\`\`\`json\n${JSON.stringify(result.result, null, 2)}\n\`\`\`\n\n`;
      report += `**결론**: ${result.conclusion}\n\n`;
      report += `---\n\n`;
    });

  // STEP 2 결과
  report += `## 🗄️ STEP 2: Buzz Score 스키마 실체 감사\n\n`;
  
  auditResults
    .filter(r => r.section.startsWith('2-'))
    .forEach(result => {
      report += `### ${result.section}\n\n`;
      report += `**SQL**:\n\`\`\`sql\n${result.query}\n\`\`\`\n\n`;
      report += `**결과**:\n\`\`\`json\n${JSON.stringify(result.result, null, 2)}\n\`\`\`\n\n`;
      report += `**결론**: ${result.conclusion}\n\n`;
      report += `---\n\n`;
    });

  // 결론 테이블 (템플릿)
  report += `## 📊 결론 테이블\n\n`;
  report += `### [표 1] buzz_score 관련 테이블 실존 여부\n\n`;
  report += `| 테이블명 | 존재 여부 | 증거 쿼리 | 비고 |\n`;
  report += `|---|:---:|---|---|\n`;
  report += `| canonical_events | (2-2 참조) | pg_tables | - |\n`;
  report += `| event_views | (2-2 참조) | pg_tables | - |\n`;
  report += `| event_actions | (2-2 참조) | pg_tables | - |\n`;
  report += `| event_impressions | (2-2 참조) | pg_tables | - |\n`;
  report += `| event_engagement_agg | (2-2 참조) | pg_tables | - |\n\n`;

  report += `### [표 2] canonical_events 컬럼 실존 여부\n\n`;
  report += `| 컬럼명 | 존재 여부 | 타입 | DEFAULT | 증거 쿼리 |\n`;
  report += `|---|:---:|---|---|---|\n`;
  report += `| popularity_score | (2-3 참조) | - | - | information_schema.columns |\n`;
  report += `| view_count | (2-3 참조) | - | - | information_schema.columns |\n`;
  report += `| is_free | (2-3 참조) | - | - | information_schema.columns |\n`;
  report += `| buzz_score | (2-3 참조) | - | - | information_schema.columns |\n`;
  report += `| buzz_updated_at | (2-3 참조) | - | - | information_schema.columns |\n`;
  report += `| buzz_components | (2-3 참조) | - | - | information_schema.columns |\n\n`;

  report += `### [표 3] 스키마 리스크 요약\n\n`;
  report += `| 항목 | 상태 | 증거 섹션 | 비고 |\n`;
  report += `|---|---|---|---|\n`;
  report += `| event_views.event_id 타입 | (2-4 참조) | information_schema.columns | - |\n`;
  report += `| canonical_events.id 타입 | (2-3 참조) | information_schema.columns | - |\n`;
  report += `| FK 존재 여부 | (2-5 참조) | information_schema.table_constraints | - |\n`;
  report += `| buzz_score MVP 차단 요소 | (결론 참조) | - | - |\n\n`;

  report += `---\n\n`;
  report += `## 🎯 최종 권고안\n\n`;
  report += `### [SECTION A] popularity_score 최소 보완 (선택)\n\n`;
  report += `(1-1, 1-2, 1-3, 1-4 결과 기반으로 작성)\n\n`;
  report += `### [SECTION B] buzz_score MVP 착수 가능성 판정\n\n`;
  report += `(2-2, 2-3, 2-4 결과 기반으로 작성)\n\n`;

  report += `---\n\n`;
  report += `**보고서 생성 완료**: ${timestamp}\n`;

  return report;
}

// ============================================
// Main
// ============================================

async function main() {
  try {
    console.log('\n╔════════════════════════════════════════╗');
    console.log('║  DB Truth Audit System                ║');
    console.log('╚════════════════════════════════════════╝\n');

    await auditPopularityScore();
    await auditBuzzScoreSchema();

    console.log('\n╔════════════════════════════════════════╗');
    console.log('║  보고서 생성 중...                     ║');
    console.log('╚════════════════════════════════════════╝\n');

    const report = generateReport();
    const reportPath = path.join(__dirname, '../../docs/BUZZ_AND_POPULARITY_AUDIT_DB_TRUTH.md');
    fs.writeFileSync(reportPath, report, 'utf-8');

    console.log(`✅ 보고서 생성 완료: ${reportPath}`);
    console.log('\n감사 완료!');

    await pool.end();
    process.exit(0);
  } catch (error) {
    console.error('\n❌ 감사 실패:', error);
    await pool.end();
    process.exit(1);
  }
}

// 실행
main();


