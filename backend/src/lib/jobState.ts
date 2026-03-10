/**
 * Shared job execution state
 *
 * scheduler.ts와 ops API 라우트가 동일 Set을 참조하여
 * 중복 실행 방지 및 running 상태 조회에 사용.
 */
export const runningJobs = new Set<string>();
