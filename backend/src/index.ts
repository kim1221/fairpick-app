import express from 'express';
import cors from 'cors';
import { pool } from './db';

const app = express();
app.use(cors());
app.use(express.json());

const PLACEHOLDER_IMAGE = 'https://static.toss.im/tds/icon/picture/default-01.png';

app.get('/health', (_, res) => {
  res.json({ status: 'ok' });
});

app.get('/categories', (_, res) => {
  const categories = {
    mainCategories: ['공연', '전시', '축제', '행사'],
    subCategories: {
      공연: ['뮤지컬', '연극', '콘서트', '클래식', '무용', '국악', '기타 공연'],
      전시: ['미술 전시', '사진 전시', '미디어아트', '체험형 전시', '어린이 전시', '특별전', '기타 전시'],
      축제: ['지역 축제', '음악 축제', '불꽃 / 드론 / 빛 축제', '계절 축제', '전통 / 문화 축제', '기타 축제'],
      행사: ['문화 행사', '체험 행사', '교육 / 강연', '마켓 / 플리마켓', '기념 행사', '가족 / 어린이', '기타 행사'],
    },
  };
  res.json(categories);
});

app.get('/events', async (req, res) => {
  try {
    const page = Math.max(parseInt((req.query.page as string) ?? '1', 10) || 1, 1);
    const size = Math.min(Math.max(parseInt((req.query.size as string) ?? '20', 10) || 20, 1), 100);
    const mainCategory = (req.query.category as string) || undefined; // 호환성: category → main_category
    const subCategory = (req.query.subCategory as string) || undefined;
    const region = (req.query.region as string) || undefined;
    const sortBy = (req.query.sortBy as string) || 'start_at'; // start_at | created_at | updated_at
    const order = (req.query.order as string) || 'asc'; // asc | desc

    const filters: string[] = [];
    const params: unknown[] = [];

    // Always filter out ended events
    filters.push(`end_at >= CURRENT_DATE`);

    if (mainCategory && mainCategory !== '전체') {
      params.push(mainCategory);
      filters.push(`main_category = $${params.length}`);
    }
    if (subCategory && subCategory !== '전체') {
      params.push(subCategory);
      filters.push(`sub_category = $${params.length}`);
    }
    if (region && region !== '전국') {
      params.push(region);
      filters.push(`region = $${params.length}`);
    }

    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

    // 정렬 필드 검증
    const validSortFields = ['start_at', 'created_at', 'updated_at'];
    const sortField = validSortFields.includes(sortBy) ? sortBy : 'start_at';
    const sortOrder = order.toLowerCase() === 'desc' ? 'DESC' : 'ASC';

    params.push(size);
    const limitIndex = params.length;
    params.push((page - 1) * size);
    const offsetIndex = params.length;

    const listQuery = `
      SELECT
        id,
        title,
        COALESCE(venue, '') AS venue,
        start_at AS "startAt",
        end_at AS "endAt",
        region,
        main_category AS "mainCategory",
        sub_category AS "subCategory",
        COALESCE(image_url, '${PLACEHOLDER_IMAGE}') AS "imageUrl",
        source_priority_winner AS "sourcePriorityWinner"
      FROM canonical_events
      ${where}
      ORDER BY ${sortField} ${sortOrder}
      LIMIT $${limitIndex} OFFSET $${offsetIndex};
    `;

    const countQuery = `SELECT count(*)::int AS total FROM canonical_events ${where};`;

    const [itemsResult, countResult] = await Promise.all([
      pool.query(listQuery, params),
      pool.query(countQuery, params.slice(0, params.length - 2)),
    ]);

    res.json({
      items: itemsResult.rows,
      pageInfo: {
        page,
        size,
        totalCount: countResult.rows[0]?.total ?? 0,
      },
    });
  } catch (error) {
    console.error('[API] /events failed', error);
    res.status(500).json({ message: 'Failed to load events.' });
  }
});

// 구체적인 라우트를 먼저 정의 (/:id보다 앞에 위치해야 함)
app.get('/events/hot', async (req, res) => {
  try {
    const page = Math.max(parseInt((req.query.page as string) ?? '1', 10) || 1, 1);
    const size = Math.min(Math.max(parseInt((req.query.size as string) ?? '20', 10) || 20, 1), 100);

    const params: unknown[] = [];

    params.push(size);
    const limitIndex = params.length;
    params.push((page - 1) * size);
    const offsetIndex = params.length;

    const listQuery = `
      SELECT
        id,
        title,
        COALESCE(venue, '') AS venue,
        start_at AS "startAt",
        end_at AS "endAt",
        region,
        main_category AS "mainCategory",
        sub_category AS "subCategory",
        COALESCE(image_url, '${PLACEHOLDER_IMAGE}') AS "imageUrl",
        source_priority_winner AS "sourcePriorityWinner",
        popularity_score AS "popularityScore",
        is_ending_soon AS "isEndingSoon",
        is_free AS "isFree"
      FROM canonical_events
      WHERE end_at >= CURRENT_DATE
        AND image_url IS NOT NULL
        AND image_url != ''
      ORDER BY popularity_score DESC NULLS LAST, created_at DESC
      LIMIT $${limitIndex} OFFSET $${offsetIndex};
    `;

    const countQuery = `SELECT count(*)::int AS total FROM canonical_events WHERE end_at >= CURRENT_DATE AND image_url IS NOT NULL AND image_url != '';`;

    const [itemsResult, countResult] = await Promise.all([
      pool.query(listQuery, params),
      pool.query(countQuery),
    ]);

    res.json({
      items: itemsResult.rows,
      pageInfo: {
        page,
        size,
        totalCount: countResult.rows[0]?.total ?? 0,
      },
    });
  } catch (error) {
    console.error('[API] /events/hot failed', error);
    res.status(500).json({ message: 'Failed to load hot events.' });
  }
});

app.get('/events/free', async (req, res) => {
  try {
    const page = Math.max(parseInt((req.query.page as string) ?? '1', 10) || 1, 1);
    const size = Math.min(Math.max(parseInt((req.query.size as string) ?? '20', 10) || 20, 1), 100);

    const params: unknown[] = [];

    params.push(size);
    const limitIndex = params.length;
    params.push((page - 1) * size);
    const offsetIndex = params.length;

    const listQuery = `
      SELECT
        id,
        title,
        COALESCE(venue, '') AS venue,
        start_at AS "startAt",
        end_at AS "endAt",
        region,
        main_category AS "mainCategory",
        sub_category AS "subCategory",
        COALESCE(image_url, '${PLACEHOLDER_IMAGE}') AS "imageUrl",
        source_priority_winner AS "sourcePriorityWinner",
        popularity_score AS "popularityScore",
        is_ending_soon AS "isEndingSoon",
        is_free AS "isFree"
      FROM canonical_events
      WHERE end_at >= CURRENT_DATE AND is_free = true
      ORDER BY start_at ASC
      LIMIT $${limitIndex} OFFSET $${offsetIndex};
    `;

    const countQuery = `SELECT count(*)::int AS total FROM canonical_events WHERE end_at >= CURRENT_DATE AND is_free = true;`;

    const [itemsResult, countResult] = await Promise.all([
      pool.query(listQuery, params),
      pool.query(countQuery),
    ]);

    res.json({
      items: itemsResult.rows,
      pageInfo: {
        page,
        size,
        totalCount: countResult.rows[0]?.total ?? 0,
      },
    });
  } catch (error) {
    console.error('[API] /events/free failed', error);
    res.status(500).json({ message: 'Failed to load free events.' });
  }
});

app.get('/events/ending', async (req, res) => {
  try {
    const page = Math.max(parseInt((req.query.page as string) ?? '1', 10) || 1, 1);
    const size = Math.min(Math.max(parseInt((req.query.size as string) ?? '20', 10) || 20, 1), 100);

    const params: unknown[] = [];

    params.push(size);
    const limitIndex = params.length;
    params.push((page - 1) * size);
    const offsetIndex = params.length;

    const listQuery = `
      SELECT
        id,
        title,
        COALESCE(venue, '') AS venue,
        start_at AS "startAt",
        end_at AS "endAt",
        region,
        main_category AS "mainCategory",
        sub_category AS "subCategory",
        COALESCE(image_url, '${PLACEHOLDER_IMAGE}') AS "imageUrl",
        source_priority_winner AS "sourcePriorityWinner",
        popularity_score AS "popularityScore",
        is_ending_soon AS "isEndingSoon",
        is_free AS "isFree"
      FROM canonical_events
      WHERE end_at >= CURRENT_DATE AND is_ending_soon = true
      ORDER BY end_at ASC
      LIMIT $${limitIndex} OFFSET $${offsetIndex};
    `;

    const countQuery = `SELECT count(*)::int AS total FROM canonical_events WHERE end_at >= CURRENT_DATE AND is_ending_soon = true;`;

    const [itemsResult, countResult] = await Promise.all([
      pool.query(listQuery, params),
      pool.query(countQuery),
    ]);

    res.json({
      items: itemsResult.rows,
      pageInfo: {
        page,
        size,
        totalCount: countResult.rows[0]?.total ?? 0,
      },
    });
  } catch (error) {
    console.error('[API] /events/ending failed', error);
    res.status(500).json({ message: 'Failed to load ending events.' });
  }
});

app.get('/events/new', async (req, res) => {
  try {
    const page = Math.max(parseInt((req.query.page as string) ?? '1', 10) || 1, 1);
    const size = Math.min(Math.max(parseInt((req.query.size as string) ?? '20', 10) || 20, 1), 100);

    const params: unknown[] = [];

    params.push(size);
    const limitIndex = params.length;
    params.push((page - 1) * size);
    const offsetIndex = params.length;

    const listQuery = `
      SELECT
        id,
        title,
        COALESCE(venue, '') AS venue,
        start_at AS "startAt",
        end_at AS "endAt",
        region,
        main_category AS "mainCategory",
        sub_category AS "subCategory",
        COALESCE(image_url, '${PLACEHOLDER_IMAGE}') AS "imageUrl",
        source_priority_winner AS "sourcePriorityWinner",
        popularity_score AS "popularityScore",
        is_ending_soon AS "isEndingSoon",
        is_free AS "isFree"
      FROM canonical_events
      WHERE end_at >= CURRENT_DATE
      ORDER BY created_at DESC
      LIMIT $${limitIndex} OFFSET $${offsetIndex};
    `;

    const countQuery = `SELECT count(*)::int AS total FROM canonical_events WHERE end_at >= CURRENT_DATE;`;

    const [itemsResult, countResult] = await Promise.all([
      pool.query(listQuery, params),
      pool.query(countQuery),
    ]);

    res.json({
      items: itemsResult.rows,
      pageInfo: {
        page,
        size,
        totalCount: countResult.rows[0]?.total ?? 0,
      },
    });
  } catch (error) {
    console.error('[API] /events/new failed', error);
    res.status(500).json({ message: 'Failed to load new events.' });
  }
});

app.get('/events/recommend', async (req, res) => {
  try {
    const page = Math.max(parseInt((req.query.page as string) ?? '1', 10) || 1, 1);
    const size = Math.min(Math.max(parseInt((req.query.size as string) ?? '20', 10) || 20, 1), 100);

    const params: unknown[] = [];

    params.push(size);
    const limitIndex = params.length;
    params.push((page - 1) * size);
    const offsetIndex = params.length;

    const listQuery = `
      SELECT
        id,
        title,
        COALESCE(venue, '') AS venue,
        start_at AS "startAt",
        end_at AS "endAt",
        region,
        main_category AS "mainCategory",
        sub_category AS "subCategory",
        COALESCE(image_url, '${PLACEHOLDER_IMAGE}') AS "imageUrl",
        source_priority_winner AS "sourcePriorityWinner",
        popularity_score AS "popularityScore",
        is_ending_soon AS "isEndingSoon",
        is_free AS "isFree"
      FROM canonical_events
      WHERE end_at >= CURRENT_DATE
        AND image_url IS NOT NULL
        AND image_url != ''
      ORDER BY 
        CASE WHEN is_featured THEN 0 ELSE 1 END,
        popularity_score DESC NULLS LAST,
        created_at DESC
      LIMIT $${limitIndex} OFFSET $${offsetIndex};
    `;

    const countQuery = `SELECT count(*)::int AS total FROM canonical_events WHERE end_at >= CURRENT_DATE AND image_url IS NOT NULL AND image_url != '';`;

    const [itemsResult, countResult] = await Promise.all([
      pool.query(listQuery, params),
      pool.query(countQuery),
    ]);

    res.json({
      items: itemsResult.rows,
      pageInfo: {
        page,
        size,
        totalCount: countResult.rows[0]?.total ?? 0,
      },
    });
  } catch (error) {
    console.error('[API] /events/recommend failed', error);
    res.status(500).json({ message: 'Failed to load recommended events.' });
  }
});

// 동적 라우트는 가장 마지막에 정의 (구체적인 라우트들 뒤)
app.get('/events/:id', async (req, res) => {
  try {
    const result = await pool.query(
      `
        SELECT
          id,
          title,
          COALESCE(venue, '') AS venue,
          start_at AS "startAt",
          end_at AS "endAt",
          region,
          main_category AS "mainCategory",
          sub_category AS "subCategory",
          COALESCE(image_url, '${PLACEHOLDER_IMAGE}') AS "imageUrl",
          source_priority_winner AS "sourcePriorityWinner",
          sources,
          address,
          lat,
          lng
        FROM canonical_events
        WHERE id = $1 AND end_at >= CURRENT_DATE
        LIMIT 1;
      `,
      [req.params.id],
    );

    if (!result.rowCount) {
      return res.status(404).json({ message: 'Event not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('[API] /events/:id failed', error);
    res.status(500).json({ message: 'Failed to load event.' });
  }
});

const PORT = Number(process.env.PORT ?? 4000);
app.listen(PORT, () => {
  console.log(`[API] Server listening on http://localhost:${PORT}`);
});

