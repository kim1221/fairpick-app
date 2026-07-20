/**
 * 테마 컬렉션 주간 발행을 수동 실행한다(스케줄러와 같은 로직).
 *
 *   npx ts-node -r dotenv/config src/scripts/publish-collection-sets.ts --dry-run
 *   npx ts-node -r dotenv/config src/scripts/publish-collection-sets.ts
 *
 * --dry-run은 아무것도 쓰지 않고 이번 주에 발행될 계획만 보여준다.
 */
import { pool } from '../db';
import { buildSetPlans, kstWeekKey, runPublishCollectionSets } from '../jobs/publishCollectionSets';

const SET_LIFETIME_DAYS = 28;

async function dryRun(): Promise<void> {
  const now = new Date();
  const weekKey = kstWeekKey(now);
  const expiresOn = new Date(now.getTime() + SET_LIFETIME_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const plans = await buildSetPlans(expiresOn, weekKey, now);
  console.log(`[dry-run] weekKey=${weekKey} 만료일=${expiresOn} 계획=${plans.length}`);
  for (const plan of plans) {
    console.log(`\n■ ${plan.title}  (${plan.slug})`);
    console.log(`  template=${plan.template} tier=${plan.tier} region=${plan.regionScope ?? '전국'}`);
    for (const slot of plan.slots) {
      console.log(`   [${slot.slotIndex}] ${slot.hintText} ← ${JSON.stringify(slot.matchRule)} teaser=${slot.teaserEventId ?? '없음'}`);
    }
  }
}

async function main(): Promise<void> {
  const isDryRun = process.argv.includes('--dry-run');
  try {
    if (isDryRun) {
      await dryRun();
    } else {
      const result = await runPublishCollectionSets();
      console.log(JSON.stringify(result, null, 2));
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
