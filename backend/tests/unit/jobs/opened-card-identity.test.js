require('ts-node/register/transpile-only');

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  propagateOpenedCardAliasesForMerge,
  snapshotOpenedCardAliasesBeforeDelete,
} = require('../../../src/services/openedCardIdentity');
const {
  artmapCanonicalKey,
  stableArtmapEventId,
} = require('../../../src/jobs/artmapEventFields');

test('Artmap source ids produce stable canonical and event identities', () => {
  assert.equal(artmapCanonicalKey(' 12345 '), 'artmap:12345');
  assert.equal(stableArtmapEventId('12345'), stableArtmapEventId(12345));
  assert.notEqual(stableArtmapEventId('12345'), stableArtmapEventId('12346'));
  assert.match(stableArtmapEventId('12345'), /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('canonical merge locks rows and propagates every old and next identity alias', async () => {
  const calls = [];
  const db = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('FOR UPDATE OF event')) {
        assert.deepEqual(params, [[0, 0], ['event-a', 'event-b']]);
        return {
          rows: [
            { group_no: 0, event_id: 'event-a', content_key: 'content-a', canonical_key: 'source:a' },
            { group_no: 0, event_id: 'event-b', content_key: 'content-b', canonical_key: 'source:b' },
          ],
          rowCount: 2,
        };
      }

      assert.match(sql, /JOIN user_card_opened_keys opened/);
      assert.match(sql, /JOIN user_ticket_earn_log earn/);
      assert.match(sql, /ON CONFLICT \(user_id, key_type, key_value\) DO UPDATE/);

      const [groupNos, keyTypes, keyValues, firstEventIds, memberGroups, memberIds] = params;
      assert.deepEqual(new Set(groupNos), new Set([0]));
      assert.deepEqual(new Set(keyTypes), new Set(['event_id', 'content_key', 'canonical_key']));
      assert.deepEqual(new Set(keyValues), new Set([
        'event-a', 'event-b',
        'content-a', 'content-b', 'content-next',
        'source:a', 'source:b',
      ]));
      assert.deepEqual(new Set(firstEventIds), new Set(['event-a']));
      assert.deepEqual(memberGroups, [0, 0]);
      assert.deepEqual(memberIds, ['event-a', 'event-b']);
      return { rows: [], rowCount: keyValues.length };
    },
  };

  const result = await propagateOpenedCardAliasesForMerge(
    db,
    ['event-a', 'event-b'],
    'event-a',
    { contentKey: 'content-next', canonicalKey: 'source:a' },
  );

  assert.deepEqual(result.lockedEventIds, ['event-a', 'event-b']);
  assert.equal(result.aliasesWritten, 7);
  assert.equal(calls.length, 2);
});

test('retention snapshots unrelated hard-delete rows as separate alias groups', async () => {
  const db = {
    async query(sql, params) {
      if (sql.includes('FOR UPDATE OF event')) {
        assert.deepEqual(params, [[0, 1], ['event-a', 'event-b']]);
        return {
          rows: [
            { group_no: 0, event_id: 'event-a', content_key: 'content-a', canonical_key: 'source:a' },
            { group_no: 1, event_id: 'event-b', content_key: 'content-b', canonical_key: 'source:b' },
          ],
          rowCount: 2,
        };
      }

      const [groupNos, , keyValues, , memberGroups, memberIds] = params;
      const groupFor = new Map(keyValues.map((value, index) => [value, groupNos[index]]));
      assert.equal(groupFor.get('event-a'), 0);
      assert.equal(groupFor.get('content-a'), 0);
      assert.equal(groupFor.get('source:a'), 0);
      assert.equal(groupFor.get('event-b'), 1);
      assert.equal(groupFor.get('content-b'), 1);
      assert.equal(groupFor.get('source:b'), 1);
      assert.deepEqual(memberGroups, [0, 1]);
      assert.deepEqual(memberIds, ['event-a', 'event-b']);
      return { rows: [], rowCount: keyValues.length };
    },
  };

  const result = await snapshotOpenedCardAliasesBeforeDelete(db, ['event-a', 'event-b']);
  assert.equal(result.aliasesWritten, 6);
});
