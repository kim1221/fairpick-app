import { pool } from '../db';

interface DiagnosticsResult {
  schemaVersion: 1;
  generatedAt: string;
  db: {
    database: string;
  };
  canonicalEvents: {
    totalCount: number;
    categoryDistribution: {
      main: Array<{ mainCategory: string; count: number }>;
      mainSub: Array<{ mainCategory: string; subCategory: string; count: number }>;
    };
    imageCoverage: {
      total: number;
      withImage: number;
      withoutImage: number;
      coveragePercent: number;
    };
    upcomingBuckets: {
      upcoming30: number;
      upcoming60: number;
      upcoming90: number;
    };
    duplicates: {
      duplicateGroupsCount: number;
      duplicateRowsCount: number;
      topDuplicates: Array<{
        title: string;
        startAt: string;
        cnt: number;
        venues: string[];
        winners: string[];
      }>;
    };
  };
}

/**
 * 베이스라인 진단 실행
 */
async function runDiagnostics(): Promise<DiagnosticsResult> {
  // 1. 전체 건수
  const totalCountResult = await pool.query(`
    SELECT COUNT(*)::int AS count
    FROM canonical_events;
  `);
  const totalCount = totalCountResult.rows[0]?.count || 0;

  // 2. 메인 카테고리 분포
  const mainCategoryResult = await pool.query(`
    SELECT
      COALESCE(main_category, '(null)') AS main_category,
      COUNT(*)::int AS count
    FROM canonical_events
    GROUP BY main_category
    ORDER BY count DESC;
  `);

  // 3. 메인 + 서브 카테고리 분포
  const mainSubCategoryResult = await pool.query(`
    SELECT
      COALESCE(main_category, '(null)') AS main_category,
      COALESCE(sub_category, '(null)') AS sub_category,
      COUNT(*)::int AS count
    FROM canonical_events
    GROUP BY main_category, sub_category
    ORDER BY main_category ASC, count DESC, sub_category ASC;
  `);

  // 4. 이미지 보유율
  const imageCoverageResult = await pool.query(`
    SELECT
      COUNT(*)::int AS total,
      COUNT(CASE WHEN image_url IS NOT NULL AND image_url != '' THEN 1 END)::int AS with_image
    FROM canonical_events;
  `);
  const imageTotal = imageCoverageResult.rows[0]?.total || 0;
  const imageWithImage = imageCoverageResult.rows[0]?.with_image || 0;
  const imageWithoutImage = imageTotal - imageWithImage;
  const imageCoveragePercent = imageTotal > 0
    ? parseFloat(((imageWithImage / imageTotal) * 100).toFixed(2))
    : 0;

  // 5. 일정 기준 분포
  const upcoming30Result = await pool.query(`
    SELECT COUNT(*)::int AS count
    FROM canonical_events
    WHERE start_at <= CURRENT_DATE + INTERVAL '30 days'
      AND end_at >= CURRENT_DATE;
  `);

  const upcoming60Result = await pool.query(`
    SELECT COUNT(*)::int AS count
    FROM canonical_events
    WHERE start_at <= CURRENT_DATE + INTERVAL '60 days'
      AND end_at >= CURRENT_DATE;
  `);

  const upcoming90Result = await pool.query(`
    SELECT COUNT(*)::int AS count
    FROM canonical_events
    WHERE start_at <= CURRENT_DATE + INTERVAL '90 days'
      AND end_at >= CURRENT_DATE;
  `);

  // 6. 중복 의심 통계
  // 6-1. 중복 그룹 수
  const duplicateGroupsResult = await pool.query(`
    SELECT COUNT(*)::int AS count
    FROM (
      SELECT title, start_at
      FROM canonical_events
      GROUP BY title, start_at
      HAVING COUNT(*) > 1
    ) t;
  `);

  // 6-2. 중복 row 수
  const duplicateRowsResult = await pool.query(`
    SELECT COALESCE(SUM(cnt), 0)::int AS count
    FROM (
      SELECT COUNT(*)::int AS cnt
      FROM canonical_events
      GROUP BY title, start_at
      HAVING COUNT(*) > 1
    ) t;
  `);

  // 6-3. 상위 중복 20개
  const topDuplicatesResult = await pool.query(`
    SELECT
      title,
      start_at,
      COUNT(*)::int AS cnt,
      STRING_AGG(DISTINCT COALESCE(venue, ''), ' || ') AS venues,
      STRING_AGG(DISTINCT COALESCE(source_priority_winner, ''), ' || ') AS winners
    FROM canonical_events
    GROUP BY title, start_at
    HAVING COUNT(*) > 1
    ORDER BY cnt DESC, title ASC
    LIMIT 20;
  `);

  // STRING_AGG 결과를 배열로 변환
  const topDuplicates = topDuplicatesResult.rows.map(row => ({
    title: row.title,
    startAt: row.start_at,
    cnt: row.cnt,
    venues: row.venues ? row.venues.split(' || ').filter((v: string) => v !== '') : [],
    winners: row.winners ? row.winners.split(' || ').filter((w: string) => w !== '') : [],
  }));

  // 결과 조합
  const result: DiagnosticsResult = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    db: {
      database: 'fairpick',
    },
    canonicalEvents: {
      totalCount,
      categoryDistribution: {
        main: mainCategoryResult.rows.map(row => ({
          mainCategory: row.main_category,
          count: row.count,
        })),
        mainSub: mainSubCategoryResult.rows.map(row => ({
          mainCategory: row.main_category,
          subCategory: row.sub_category,
          count: row.count,
        })),
      },
      imageCoverage: {
        total: imageTotal,
        withImage: imageWithImage,
        withoutImage: imageWithoutImage,
        coveragePercent: imageCoveragePercent,
      },
      upcomingBuckets: {
        upcoming30: upcoming30Result.rows[0]?.count || 0,
        upcoming60: upcoming60Result.rows[0]?.count || 0,
        upcoming90: upcoming90Result.rows[0]?.count || 0,
      },
      duplicates: {
        duplicateGroupsCount: duplicateGroupsResult.rows[0]?.count || 0,
        duplicateRowsCount: duplicateRowsResult.rows[0]?.count || 0,
        topDuplicates,
      },
    },
  };

  return result;
}

/**
 * 메인 실행
 */
async function main() {
  try {
    const result = await runDiagnostics();
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

// 실행
main();
