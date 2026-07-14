import crypto from 'crypto';

const OPEN_ENDED_TTL_DAYS = 30;

/**
 * Popga 원본 ID에서 항상 같은 canonical UUID를 만든다.
 * 이벤트가 장기 만료로 hard-delete된 뒤 다시 등장해도 예전 공개 이력의 event_id와
 * 같아져, 사용자가 이미 연 카드를 신규 카드로 다시 받지 않게 한다.
 */
export function stablePopgaEventId(popgaId: string | number): string {
  const bytes = Buffer.from(
    crypto.createHash('sha256').update(`fairpick:popga:${String(popgaId)}`).digest().subarray(0, 16),
  );
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function normalizeDate(raw: string | null): string | null {
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const dot = raw.match(/^(\d{4})\.(\d{2})\.(\d{2})/);
  if (dot) return `${dot[1]}-${dot[2]}-${dot[3]}`;
  const iso = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  return null;
}

export function requirePopgaEventDate(
  raw: unknown,
  field: string,
  popgaId: string | number,
): string {
  const normalized = normalizeDate(typeof raw === 'string' ? raw : null);
  if (!normalized) {
    throw new Error(`popga:${popgaId}의 ${field}이 없거나 형식이 잘못됐습니다.`);
  }

  const [year, month, day] = normalized.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new Error(`popga:${popgaId}의 ${field}이 유효한 날짜가 아닙니다: ${normalized}`);
  }
  return normalized;
}

/**
 * Popga의 closeDate=null은 오류가 아니라 상시 운영 팝업이다.
 * 30일 rolling TTL을 부여해 목록에 남아 있는 동안만 계속 연장하고,
 * 소스에서 사라진 뒤에는 별도 수동 정리 없이 만료되게 한다.
 */
export function resolvePopgaEndDate(
  raw: unknown,
  startAt: string,
  popgaId: string | number,
  nowMs = Date.now(),
): { endAt: string; openEnded: boolean } {
  if (raw !== null && raw !== undefined && raw !== '') {
    return {
      endAt: requirePopgaEventDate(raw, '종료일', popgaId),
      openEnded: false,
    };
  }

  const todayKst = new Date(nowMs + 9 * 60 * 60 * 1_000).toISOString().slice(0, 10);
  const baseMs = Math.max(
    Date.parse(`${todayKst}T00:00:00Z`),
    Date.parse(`${startAt}T00:00:00Z`),
  );
  const end = new Date(baseMs);
  end.setUTCDate(end.getUTCDate() + OPEN_ENDED_TTL_DAYS);
  return { endAt: end.toISOString().slice(0, 10), openEnded: true };
}

export function popgaEventStatus(
  startAt: string,
  endAt: string,
  nowMs = Date.now(),
): 'scheduled' | 'ongoing' | 'ended' {
  const todayKst = new Date(nowMs + 9 * 60 * 60 * 1_000).toISOString().slice(0, 10);
  if (startAt > todayKst) return 'scheduled';
  if (endAt < todayKst) return 'ended';
  return 'ongoing';
}
