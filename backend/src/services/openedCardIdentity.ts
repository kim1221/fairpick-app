import type { PoolClient } from 'pg';

export type OpenedCardIdentityDb = Pick<PoolClient, 'query'>;

export interface OpenedCardAliasGroup {
  /** Canonical rows that represent one semantic Culture Card. */
  eventIds: readonly string[];
  /** The surviving row for a merge, or the row itself for a delete snapshot. */
  firstEventId?: string;
  /** Identities that will be assigned by the pending merge update. */
  additionalContentKeys?: readonly (string | null | undefined)[];
  additionalCanonicalKeys?: readonly (string | null | undefined)[];
}

export interface OpenedCardAliasPropagationResult {
  lockedEventIds: string[];
  aliasesWritten: number;
}

interface LockedCanonicalIdentity {
  group_no: number | string;
  event_id: string;
  content_key: string | null;
  canonical_key: string | null;
}

type AliasType = 'event_id' | 'content_key' | 'canonical_key';

interface AliasInput {
  groupNo: number;
  keyType: AliasType;
  keyValue: string;
  firstEventId: string;
}

function cleanIdentity(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

/**
 * Expands every user's permanent opened-card ledger across each supplied
 * semantic identity group.
 *
 * The canonical rows are locked first. Callers that mutate/delete those rows
 * must invoke this inside the same transaction and only mutate after it
 * returns. That ordering prevents a content/canonical key change from breaking
 * the lifetime Home exclusion contract.
 */
export async function propagateOpenedCardAliases(
  db: OpenedCardIdentityDb,
  groups: readonly OpenedCardAliasGroup[],
): Promise<OpenedCardAliasPropagationResult> {
  const normalizedGroups = groups
    .map((group) => ({
      ...group,
      eventIds: Array.from(new Set(group.eventIds.map(cleanIdentity).filter((id): id is string => !!id))),
    }))
    .filter((group) => group.eventIds.length > 0);

  if (normalizedGroups.length === 0) {
    return { lockedEventIds: [], aliasesWritten: 0 };
  }

  const requestedGroupNos: number[] = [];
  const requestedEventIds: string[] = [];
  normalizedGroups.forEach((group, groupNo) => {
    group.eventIds.forEach((eventId) => {
      requestedGroupNos.push(groupNo);
      requestedEventIds.push(eventId);
    });
  });

  const lockedResult = await db.query<LockedCanonicalIdentity>(
    `WITH requested(group_no, event_id) AS (
       SELECT *
       FROM UNNEST($1::integer[], $2::text[])
     )
     SELECT
       requested.group_no,
       event.id::text AS event_id,
       event.content_key,
       event.canonical_key
     FROM requested
     JOIN canonical_events event ON event.id::text = requested.event_id
     ORDER BY requested.group_no, event.id
     FOR UPDATE OF event`,
    [requestedGroupNos, requestedEventIds],
  );

  const aliasesByGroup = new Map<number, Map<string, AliasInput>>();
  const addAlias = (
    groupNo: number,
    keyType: AliasType,
    rawValue: string | null | undefined,
    firstEventId: string,
  ) => {
    const keyValue = cleanIdentity(rawValue);
    if (!keyValue) return;
    let groupAliases = aliasesByGroup.get(groupNo);
    if (!groupAliases) {
      groupAliases = new Map();
      aliasesByGroup.set(groupNo, groupAliases);
    }
    groupAliases.set(`${keyType}\u0000${keyValue}`, {
      groupNo,
      keyType,
      keyValue,
      firstEventId,
    });
  };

  lockedResult.rows.forEach((row) => {
    const groupNo = Number(row.group_no);
    const firstEventId = cleanIdentity(normalizedGroups[groupNo]?.firstEventId)
      ?? normalizedGroups[groupNo]?.eventIds[0]
      ?? row.event_id;
    addAlias(groupNo, 'event_id', row.event_id, firstEventId);
    addAlias(groupNo, 'content_key', row.content_key, firstEventId);
    addAlias(groupNo, 'canonical_key', row.canonical_key, firstEventId);
  });

  normalizedGroups.forEach((group, groupNo) => {
    const firstEventId = cleanIdentity(group.firstEventId) ?? group.eventIds[0]!;
    group.additionalContentKeys?.forEach((key) => addAlias(groupNo, 'content_key', key, firstEventId));
    group.additionalCanonicalKeys?.forEach((key) => addAlias(groupNo, 'canonical_key', key, firstEventId));
  });

  const aliases = Array.from(aliasesByGroup.values()).flatMap((groupAliases) =>
    Array.from(groupAliases.values()),
  );
  if (aliases.length === 0) {
    return {
      lockedEventIds: lockedResult.rows.map((row) => row.event_id),
      aliasesWritten: 0,
    };
  }

  const memberGroupNos: number[] = [];
  const memberEventIds: string[] = [];
  normalizedGroups.forEach((group, groupNo) => {
    group.eventIds.forEach((eventId) => {
      memberGroupNos.push(groupNo);
      memberEventIds.push(eventId);
    });
  });

  const writeResult = await db.query(
    `WITH aliases(group_no, key_type, key_value, first_event_id) AS (
       SELECT *
       FROM UNNEST($1::integer[], $2::text[], $3::text[], $4::text[])
     ),
     members(group_no, event_id) AS (
       SELECT *
       FROM UNNEST($5::integer[], $6::text[])
     ),
     affected_times AS (
       SELECT
         alias.group_no,
         opened.user_id,
         opened.first_opened_at AS opened_at
       FROM aliases alias
       JOIN user_card_opened_keys opened
         ON opened.key_value = alias.key_value
        AND (
          opened.key_type = alias.key_type
          OR (
            opened.key_type IN ('content_key', 'canonical_key')
            AND alias.key_type IN ('content_key', 'canonical_key')
          )
        )

       UNION ALL

       SELECT
         member.group_no,
         earn.user_id,
         earn.created_at AS opened_at
       FROM members member
       JOIN user_ticket_earn_log earn
         ON earn.event_id::text = member.event_id
     ),
     affected_users AS (
       SELECT group_no, user_id, MIN(opened_at) AS first_opened_at
       FROM affected_times
       GROUP BY group_no, user_id
     )
     INSERT INTO user_card_opened_keys (
       user_id, key_type, key_value, first_event_id, first_opened_at
     )
     SELECT
       affected.user_id,
       alias.key_type,
       alias.key_value,
       alias.first_event_id,
       affected.first_opened_at
     FROM affected_users affected
     JOIN aliases alias USING (group_no)
     ON CONFLICT (user_id, key_type, key_value) DO UPDATE
     SET first_event_id = CASE
           WHEN EXCLUDED.first_opened_at < user_card_opened_keys.first_opened_at
           THEN EXCLUDED.first_event_id
           ELSE user_card_opened_keys.first_event_id
         END,
         first_opened_at = LEAST(
           user_card_opened_keys.first_opened_at,
           EXCLUDED.first_opened_at
         )
     RETURNING 1`,
    [
      aliases.map((alias) => alias.groupNo),
      aliases.map((alias) => alias.keyType),
      aliases.map((alias) => alias.keyValue),
      aliases.map((alias) => alias.firstEventId),
      memberGroupNos,
      memberEventIds,
    ],
  );

  return {
    lockedEventIds: lockedResult.rows.map((row) => row.event_id),
    aliasesWritten: writeResult.rowCount ?? 0,
  };
}

export async function propagateOpenedCardAliasesForMerge(
  db: OpenedCardIdentityDb,
  eventIds: readonly string[],
  masterEventId: string,
  nextIdentity: {
    contentKey?: string | null;
    canonicalKey?: string | null;
  } = {},
): Promise<OpenedCardAliasPropagationResult> {
  return propagateOpenedCardAliases(db, [{
    eventIds,
    firstEventId: masterEventId,
    additionalContentKeys: [nextIdentity.contentKey],
    additionalCanonicalKeys: [nextIdentity.canonicalKey],
  }]);
}

/**
 * Snapshots each unrelated event independently before retention hard-delete.
 * This intentionally does not cross-propagate aliases between event IDs.
 */
export async function snapshotOpenedCardAliasesBeforeDelete(
  db: OpenedCardIdentityDb,
  eventIds: readonly string[],
): Promise<OpenedCardAliasPropagationResult> {
  return propagateOpenedCardAliases(
    db,
    eventIds.map((eventId) => ({ eventIds: [eventId], firstEventId: eventId })),
  );
}
