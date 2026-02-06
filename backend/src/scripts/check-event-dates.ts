/**
 * 이벤트 날짜 확인 스크립트
 * DB에 실제로 저장된 날짜 값과 formatEventDates 처리 후 값을 비교
 */

import { pool } from '../db';

async function checkEventDates() {
  try {
    // 렘피카 이벤트 찾기
    const result = await pool.query(`
      SELECT id, title, start_at, end_at, 
             to_char(start_at, 'YYYY-MM-DD') as start_at_formatted,
             to_char(end_at, 'YYYY-MM-DD') as end_at_formatted
      FROM canonical_events
      WHERE title LIKE '%렘피카%'
      LIMIT 1
    `);

    if (result.rows.length === 0) {
      console.log('❌ 렘피카 이벤트를 찾을 수 없습니다.');
      return;
    }

    const event = result.rows[0];
    
    console.log('\n[DB Raw Data]');
    console.log(`  ID: ${event.id}`);
    console.log(`  Title: ${event.title}`);
    console.log(`  start_at (raw): ${event.start_at}`);
    console.log(`  end_at (raw): ${event.end_at}`);
    console.log(`  start_at (formatted by PostgreSQL): ${event.start_at_formatted}`);
    console.log(`  end_at (formatted by PostgreSQL): ${event.end_at_formatted}`);

    // JavaScript Date 객체로 변환 후 확인
    const startDate = new Date(event.start_at);
    const endDate = new Date(event.end_at);

    console.log('\n[JavaScript Date Object]');
    console.log(`  start_at toString(): ${startDate.toString()}`);
    console.log(`  start_at toISOString(): ${startDate.toISOString()}`);
    console.log(`  start_at getFullYear(): ${startDate.getFullYear()}`);
    console.log(`  start_at getMonth()+1: ${startDate.getMonth() + 1}`);
    console.log(`  start_at getDate(): ${startDate.getDate()}`);
    console.log(`  start_at getUTCFullYear(): ${startDate.getUTCFullYear()}`);
    console.log(`  start_at getUTCMonth()+1: ${startDate.getUTCMonth() + 1}`);
    console.log(`  start_at getUTCDate(): ${startDate.getUTCDate()}`);

    console.log('\n  end_at toString(): ' + endDate.toString());
    console.log(`  end_at toISOString(): ${endDate.toISOString()}`);
    console.log(`  end_at getDate(): ${endDate.getDate()}`);
    console.log(`  end_at getUTCDate(): ${endDate.getUTCDate()}`);

    // formatEventDates 함수 적용 (index.ts에서 복사)
    const formatDate = (date: any): string | null => {
      if (!date) return null;
      if (typeof date === 'string') return date.split('T')[0];
      if (date instanceof Date) {
        const year = date.getUTCFullYear();
        const month = String(date.getUTCMonth() + 1).padStart(2, '0');
        const day = String(date.getUTCDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      }
      return null;
    };

    console.log('\n[formatEventDates Applied]');
    console.log(`  start_at: ${formatDate(startDate)}`);
    console.log(`  end_at: ${formatDate(endDate)}`);

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pool.end();
  }
}

checkEventDates();

