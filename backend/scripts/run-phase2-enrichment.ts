/**
 * Phase 2 Enrichment Runner
 * 
 * Usage:
 *   npm run enrich:phase2
 *   # or
 *   ts-node scripts/run-phase2-enrichment.ts
 */

import { enrichInternalFields, getInternalFieldsStats } from '../src/jobs/enrichInternalFields';

async function main() {
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║         Phase 2: Internal Fields Enrichment              ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log('');

  try {
    // 1. Run enrichment
    console.log('Step 1: Running enrichment job...\n');
    const result = await enrichInternalFields();

    console.log('\n✅ Enrichment completed successfully!');
    console.log(`   - Total: ${result.total}`);
    console.log(`   - Updated: ${result.updated}`);
    console.log(`   - Errors: ${result.errors}`);
    console.log(`   - Duration: ${result.duration}s`);

    // 2. Show statistics
    console.log('\nStep 2: Gathering statistics...\n');
    await getInternalFieldsStats();

    console.log('\n✨ Phase 2 enrichment complete! ✨');
    console.log('\nNext steps:');
    console.log('  1. Test recommendations API:');
    console.log('     curl http://localhost:4000/recommendations?companions=커플&time=evening');
    console.log('  2. Check filters:');
    console.log('     curl http://localhost:4000/recommendations/filters');
    console.log('  3. Try presets:');
    console.log('     curl http://localhost:4000/recommendations/presets/date-evening');

    process.exit(0);
  } catch (error) {
    console.error('\n❌ Enrichment failed:', error);
    process.exit(1);
  }
}

main();

