/**
 * parseRuntime 함수 테스트
 */

import { parseRuntime } from '../../../src/lib/displayFieldsGenerator/utils/payloadReader';

function testParseRuntime() {
  console.log('[Test] Testing parseRuntime function...\n');
  
  const testCases = [
    { input: '1시간 30분', expected: 90 },
    { input: '2시간 15분', expected: 135 },
    { input: '1시간', expected: 60 },
    { input: '3시간', expected: 180 },
    { input: '100분', expected: 100 },
    { input: '45분', expected: 45 },
    { input: '120분', expected: 120 },
    { input: null, expected: null },
    { input: undefined, expected: null },
    { input: '', expected: null },
    { input: '약 1시간', expected: 60 },
    { input: '약 1시간 30분', expected: 90 },
  ];
  
  let passed = 0;
  let failed = 0;
  
  for (const testCase of testCases) {
    const result = parseRuntime(testCase.input as any);
    const status = result === testCase.expected ? '✅ PASS' : '❌ FAIL';
    
    if (result === testCase.expected) {
      passed++;
    } else {
      failed++;
    }
    
    console.log(`${status} | Input: "${testCase.input}" | Expected: ${testCase.expected} | Got: ${result}`);
  }
  
  console.log(`\n[Test] Results: ${passed} passed, ${failed} failed`);
  
  if (failed > 0) {
    process.exit(1);
  }
}

testParseRuntime();

