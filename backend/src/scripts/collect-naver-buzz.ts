/**
 * 네이버 블로그 언급 수 수집 및 Buzz Score 계산 (정확도 개선)
 * 
 * 기능:
 * 1. Sampling: 상위 N개 이벤트로 평균 정확도 계산
 * 2. 보정 계수 저장
 * 3. 전체 이벤트에 보정 계수 적용
 * 4. Percentile 기반으로 naver_buzz_score 계산 (0~100)
 * 5. update_priority 자동 설정
 * 
 * 사용법:
 * - Sampling: npm run collect:naver-buzz -- --sampling
 * - 전체 수집: npm run collect:naver-buzz
 * - 테스트: npm run collect:naver-buzz:test
 * 
 * Note: 환경 변수는 ts-node -r dotenv/config로 자동 로드됨
 */

import { Pool } from 'pg';
import { getNaverBlogMentions } from '../lib/naverApi';
import * as fs from 'fs';
import * as path from 'path';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const CORRECTION_FACTOR_FILE = path.join(__dirname, '../../.naver-correction-factor.json');

interface Event {
  id: number;
  title: string;
  region?: string;
  venue?: string;
  start_at: Date;
  end_at: Date;
}

/**
 * Percentile 계산 (0~100)
 */
function calculatePercentile(value: number, sortedValues: number[]): number {
  if (sortedValues.length === 0) return 0;
  if (value === 0) return 0;
  
  const rank = sortedValues.filter(v => v < value).length;
  return Math.round((rank / sortedValues.length) * 100);
}

/**
 * Update Priority 계산
 * P0 (매일): 임박/진행 중/매우 핫함
 * P1 (3일): 2주 내 마감/핫함
 * P2 (주1): 나머지
 */
function calculateUpdatePriority(
  startAt: Date,
  endAt: Date,
  buzzScore: number
): number {
  const now = new Date();
  const daysUntilEnd = (endAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
  const isOngoing = startAt <= now && endAt >= now;
  
  // P0: 매일
  if (daysUntilEnd <= 7) return 0;
  if (isOngoing) return 0;
  if (buzzScore > 80) return 0;
  
  // P1: 3일마다
  if (daysUntilEnd <= 14) return 1;
  if (buzzScore > 50) return 1;
  
  // P2: 주 1회
  return 2;
}

/**
 * 보정 계수 저장
 */
function saveCorrectionFactor(factor: number, sampleSize: number, avgAccuracy: number) {
  const data = {
    correctionFactor: factor,
    sampleSize: sampleSize,
    avgAccuracy: avgAccuracy,
    calculatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(CORRECTION_FACTOR_FILE, JSON.stringify(data, null, 2));
  console.log(`✅ 보정 계수 저장: ${CORRECTION_FACTOR_FILE}`);
}

/**
 * 보정 계수 로드
 */
function loadCorrectionFactor(): number | null {
  try {
    if (fs.existsSync(CORRECTION_FACTOR_FILE)) {
      const data = JSON.parse(fs.readFileSync(CORRECTION_FACTOR_FILE, 'utf8'));
      console.log(`📊 보정 계수 로드: ${data.correctionFactor.toFixed(3)} (샘플: ${data.sampleSize}개, 정확도: ${(data.avgAccuracy * 100).toFixed(1)}%)`);
      return data.correctionFactor;
    }
  } catch (error) {
    console.warn('⚠️  보정 계수 로드 실패, 기본값 사용');
  }
  return null;
}

/**
 * Sampling 모드: 상위 N개로 평균 정확도 계산
 */
async function runSamplingMode(sampleSize: number = 100) {
  console.log('========================================');
  console.log('🔬 Sampling 모드: 보정 계수 계산');
  console.log('========================================');
  console.log('');
  
  try {
    // 상위 N개 이벤트 조회 (buzz_score 높은 순)
    console.log(`📊 상위 ${sampleSize}개 이벤트 샘플링 중...`);
    
    const { rows: events } = await pool.query<Event>(`
      SELECT 
        id,
        title,
        region,
        venue,
        start_at,
        end_at
      FROM canonical_events
      WHERE 
        end_at >= NOW()
        AND title IS NOT NULL
      ORDER BY COALESCE(naver_buzz_score, popularity_score, 0) DESC
      LIMIT $1
    `, [sampleSize]);
    
    console.log(`✅ ${events.length}개 이벤트 조회 완료`);
    console.log('');
    
    // Sampling (display=100)
    console.log('🔍 정확도 측정 중 (display=100)...');
    console.log('   (예상 소요 시간: 약 2~3분)');
    console.log('');
    
    let totalAccuracy = 0;
    let processed = 0;
    
    for (const event of events) {
      const result = await getNaverBlogMentions(
        event.title,
        event.region,
        event.venue,
        true  // Sampling 모드
      );
      
      if (result.accuracy !== undefined) {
        totalAccuracy += result.accuracy;
      }
      
      processed++;
      
      if (processed % 10 === 0 || processed === events.length) {
        console.log(`   진행: ${processed}/${events.length} (${Math.round(processed/events.length*100)}%)`);
      }
      
      // Rate limiting
      if (processed < events.length) {
        await new Promise(resolve => setTimeout(resolve, 150));
      }
    }
    
    const avgAccuracy = totalAccuracy / events.length;
    const correctionFactor = avgAccuracy;
    
    console.log('');
    console.log('========================================');
    console.log('📈 Sampling 결과');
    console.log('========================================');
    console.log(`샘플 크기: ${events.length}개`);
    console.log(`평균 정확도: ${(avgAccuracy * 100).toFixed(1)}%`);
    console.log(`보정 계수: ${correctionFactor.toFixed(3)}`);
    console.log('');
    console.log(`💡 해석: 네이버 total 값의 ${(avgAccuracy * 100).toFixed(1)}%가 실제 관련 블로그입니다.`);
    console.log('');
    
    // 저장
    saveCorrectionFactor(correctionFactor, events.length, avgAccuracy);
    
    console.log('');
    console.log('✅ Sampling 완료! 이제 일반 모드로 전체 수집을 실행하세요:');
    console.log('   npm run collect:naver-buzz');
    
  } catch (error: any) {
    console.error('');
    console.error('❌ Sampling 오류:');
    console.error(error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

/**
 * 전체 수집 모드: 보정 계수 적용하여 buzz score 계산
 */
async function collectNaverBuzz(testMode: boolean = false) {
  const limit = testMode ? 10 : 100000;
  
  console.log('========================================');
  console.log('🚀 네이버 Buzz Score 수집 시작');
  console.log('========================================');
  console.log('');
  
  // 보정 계수 로드
  const correctionFactor = loadCorrectionFactor();
  
  if (!correctionFactor) {
    console.log('⚠️  보정 계수가 없습니다. 먼저 Sampling을 실행하세요:');
    console.log('   npm run collect:naver-buzz -- --sampling');
    console.log('');
    console.log('💡 Sampling 없이 진행하려면 보정 계수 1.0 사용 (권장하지 않음)');
    console.log('');
  }
  
  const factor = correctionFactor || 1.0;

  try {
    // Step 1: 이벤트 조회
    console.log(`📊 이벤트 조회 중... (최대 ${limit}개)`);
    
    const { rows: events } = await pool.query<Event>(`
      SELECT 
        id,
        title,
        region,
        venue,
        start_at,
        end_at
      FROM canonical_events
      WHERE 
        end_at >= NOW()
        AND title IS NOT NULL
      ORDER BY id
      LIMIT $1
    `, [limit]);

    console.log(`✅ ${events.length}개 이벤트 조회 완료`);
    console.log('');

    if (events.length === 0) {
      console.log('⚠️  처리할 이벤트가 없습니다.');
      return;
    }

    // Step 2: 네이버 API 호출 (보정 계수 적용)
    console.log('🔍 네이버 블로그 언급 수 수집 중...');
    console.log(`   (보정 계수: ${factor.toFixed(3)})`);
    console.log('');
    
    interface EventWithMentions extends Event {
      rawMentions: number;
      correctedMentions: number;
    }
    
    const eventsWithMentions: EventWithMentions[] = [];
    
    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      
      const result = await getNaverBlogMentions(
        event.title,
        event.region,
        event.venue,
        false,  // 일반 모드
        factor  // 보정 계수 전달
      );
      
      eventsWithMentions.push({
        ...event,
        rawMentions: Math.round(result.total / factor),  // 원본 복원 (로깅용)
        correctedMentions: result.total,
      });

      // 진행상황 출력
      if ((i + 1) % 10 === 0 || (i + 1) === events.length) {
        console.log(`   진행: ${i + 1}/${events.length} (${Math.round((i + 1) / events.length * 100)}%)`);
      }

      // Rate limiting
      if (i < events.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 150));
      }
    }

    console.log('✅ API 호출 완료');
    console.log('');

    // Step 3: Buzz Score 계산 (Percentile)
    console.log('📈 Buzz Score 계산 중 (Percentile 방식)...');
    
    const allMentions = eventsWithMentions
      .map(e => e.correctedMentions)
      .sort((a, b) => a - b);
    
    const eventsWithScore = eventsWithMentions.map(event => ({
      ...event,
      buzzScore: calculatePercentile(event.correctedMentions, allMentions),
      updatePriority: 2,  // 임시 값
    }));

    // Update Priority 재계산
    eventsWithScore.forEach(event => {
      event.updatePriority = calculateUpdatePriority(
        event.start_at,
        event.end_at,
        event.buzzScore
      );
    });

    console.log('✅ Buzz Score 계산 완료');
    console.log('');

    // Step 4: DB 업데이트
    console.log('💾 데이터베이스 업데이트 중...');
    
    for (const event of eventsWithScore) {
      await pool.query(`
        UPDATE canonical_events
        SET 
          naver_mentions = $1,
          naver_buzz_score = $2,
          naver_updated_at = NOW(),
          update_priority = $3
        WHERE id = $4
      `, [
        event.correctedMentions,
        event.buzzScore,
        event.updatePriority,
        event.id
      ]);
    }

    console.log('✅ 데이터베이스 업데이트 완료');
    console.log('');

    // Step 5: 통계 출력
    console.log('========================================');
    console.log('📊 수집 결과 통계');
    console.log('========================================');
    console.log(`총 처리: ${eventsWithScore.length}개`);
    console.log(`보정 계수: ${factor.toFixed(3)}`);
    console.log('');
    
    const p0Count = eventsWithScore.filter(e => e.updatePriority === 0).length;
    const p1Count = eventsWithScore.filter(e => e.updatePriority === 1).length;
    const p2Count = eventsWithScore.filter(e => e.updatePriority === 2).length;
    
    console.log('Update Priority 분포:');
    console.log(`  P0 (매일): ${p0Count}개`);
    console.log(`  P1 (3일): ${p1Count}개`);
    console.log(`  P2 (주1): ${p2Count}개`);
    console.log('');

    // 상위 10개
    const top10 = [...eventsWithScore]
      .sort((a, b) => b.buzzScore - a.buzzScore)
      .slice(0, 10);

    console.log('🔥 Top 10 핫한 이벤트:');
    console.log('');
    top10.forEach((event, idx) => {
      const venueShort = event.venue?.substring(0, 20) || '-';
      console.log(`${idx + 1}. [${event.buzzScore}점] ${event.title}`);
      console.log(`   언급: ${event.rawMentions.toFixed(0)} → ${event.correctedMentions} (보정됨)`);
      console.log(`   장소: ${venueShort}`);
      console.log('');
    });

    console.log('✅ 수집 완료!');

  } catch (error: any) {
    console.error('');
    console.error('❌ 수집 오류:');
    console.error(error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// 실행
const isSampling = process.argv.includes('--sampling');
const isTest = process.argv.includes('--test');

if (isSampling) {
  runSamplingMode(100);
} else {
  collectNaverBuzz(isTest);
}
