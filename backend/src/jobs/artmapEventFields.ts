import crypto from 'crypto';

export function artmapCanonicalKey(artmapIdx: string | number): string {
  const normalized = String(artmapIdx).trim();
  if (!normalized) throw new Error('Artmap idx is required');
  return `artmap:${normalized}`;
}

/**
 * Artmap 원본 ID에서 항상 같은 UUID를 만든다.
 *
 * canonical_key와 event_id를 모두 결정적으로 유지해, retention hard-delete
 * 이후 같은 전시가 다시 수집되어도 과거 공개 이력과 동일한 identity를 쓴다.
 */
export function stableArtmapEventId(artmapIdx: string | number): string {
  const bytes = Buffer.from(
    crypto
      .createHash('sha256')
      .update(`fairpick:${artmapCanonicalKey(artmapIdx)}`)
      .digest()
      .subarray(0, 16),
  );
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
