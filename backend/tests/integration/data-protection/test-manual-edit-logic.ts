/**
 * 수동 편집 로직 단위 테스트 (빠른 테스트)
 * 
 * 실행: ts-node -r dotenv/config tests/integration/data-protection/test-manual-edit-logic.ts
 */

// isManuallyEdited 함수 복사 (테스트용)
function isManuallyEdited(
  manuallyEditedFields: Record<string, boolean> | null,
  fieldName: string,
  forceFields: string[]
): boolean {
  // forceFields에 포함되어 있으면 수동 편집 무시
  if (forceFields.includes(fieldName)) {
    return false;
  }
  
  // manually_edited_fields 체크
  if (manuallyEditedFields && manuallyEditedFields[fieldName] === true) {
    return true;
  }
  
  return false;
}

function runTests() {
  console.log('🧪 Manual Edit Logic Unit Tests\n');

  let passCount = 0;
  let failCount = 0;

  function test(name: string, result: boolean, expected: boolean) {
    const status = result === expected ? '✅ PASS' : '❌ FAIL';
    console.log(`${status}: ${name}`);
    if (result === expected) {
      passCount++;
    } else {
      failCount++;
      console.log(`   Expected: ${expected}, Got: ${result}`);
    }
  }

  // Test 1: 수동 편집 안 됨
  test(
    'Not manually edited',
    isManuallyEdited(null, 'derived_tags', []),
    false
  );

  // Test 2: 수동 편집됨
  test(
    'Manually edited',
    isManuallyEdited({ derived_tags: true }, 'derived_tags', []),
    true
  );

  // Test 3: forceFields에 포함 (수동 편집 무시)
  test(
    'Force field overrides manual edit',
    isManuallyEdited({ derived_tags: true }, 'derived_tags', ['derived_tags']),
    false
  );

  // Test 4: 다른 필드는 수동 편집됨
  test(
    'Other field is manually edited',
    isManuallyEdited({ overview: true }, 'derived_tags', []),
    false
  );

  // Test 5: forceFields에 다른 필드만 있음
  test(
    'Force field for different field',
    isManuallyEdited({ derived_tags: true }, 'derived_tags', ['overview']),
    true
  );

  // Test 6: manually_edited_fields가 빈 객체
  test(
    'Empty manually_edited_fields',
    isManuallyEdited({}, 'derived_tags', []),
    false
  );

  // Test 7: manually_edited_fields에 false 값
  test(
    'Manually edited field is false',
    isManuallyEdited({ derived_tags: false }, 'derived_tags', []),
    false
  );

  console.log('\n' + '='.repeat(50));
  console.log(`📊 Results: ${passCount} passed, ${failCount} failed`);
  
  if (failCount === 0) {
    console.log('✅ All tests passed!');
  } else {
    console.log('❌ Some tests failed!');
    process.exit(1);
  }
}

runTests();

