/**
 * 수동 Cleanup 실행 스크립트
 *
 * Usage: npx ts-node -r dotenv/config src/scripts/manual-cleanup.ts
 */

import { runCleanupJob } from '../jobs/cleanup/index';

async function main() {
  console.log('\n🧹 수동 Cleanup 실행...\n');

  try {
    await runCleanupJob();
    console.log('\n✅ Cleanup 완료\n');
    process.exit(0);
  } catch (error: any) {
    console.error('\n❌ Cleanup 실패:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
