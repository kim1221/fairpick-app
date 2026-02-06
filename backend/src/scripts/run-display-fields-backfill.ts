/**
 * Phase 3: Display Fields Backfill 실행 스크립트
 * 
 * 실행 방법:
 * npm run enrich:display
 */

import { displayFieldsBackfill } from '../jobs/displayFieldsBackfill';

(async () => {
  try {
    await displayFieldsBackfill();
    process.exit(0);
  } catch (error) {
    console.error('[Script] Failed to run display fields backfill:', error);
    process.exit(1);
  }
})();

