/**
 * embeddingService.ts
 *
 * Gemini text-embedding-004 wrapper for vector search.
 * - RETRIEVAL_DOCUMENT: used when indexing events
 * - RETRIEVAL_QUERY: used when embedding a user search query
 */

import { GoogleGenerativeAI, TaskType } from '@google/generative-ai';

const MODEL = 'gemini-embedding-001';
export const EMBEDDING_DIMENSIONS = 3072;

// ─────────────────────────────────────────────────────────────
// Text builder
// ─────────────────────────────────────────────────────────────

interface EventTextInput {
  title?: string | null;
  displayTitle?: string | null;
  venue?: string | null;
  address?: string | null;
  overview?: string | null;
  mainCategory?: string | null;
  subCategory?: string | null;
  tags?: string[] | null;
  region?: string | null;
  priceInfo?: string | null;
}

/**
 * Builds a rich text representation of an event for embedding.
 * Combines key fields so the vector captures semantic meaning.
 */
export function buildEventText(event: EventTextInput): string {
  const parts: string[] = [];

  // Primary title (display_title preferred over raw title)
  if (event.displayTitle) parts.push(event.displayTitle);
  else if (event.title) parts.push(event.title);

  // Category context
  if (event.mainCategory) parts.push(event.mainCategory);
  if (event.subCategory) parts.push(event.subCategory);

  // Location context
  if (event.venue) parts.push(event.venue);
  if (event.region) parts.push(event.region);
  if (event.address) parts.push(event.address);

  // Price context (무료/유료)
  if (event.priceInfo) parts.push(event.priceInfo.slice(0, 100));

  // Description (truncated)
  if (event.overview) parts.push(event.overview.slice(0, 400));

  // Tags
  if (event.tags?.length) parts.push(event.tags.join(' '));

  return parts.filter(Boolean).join(' · ');
}

// ─────────────────────────────────────────────────────────────
// Query embedding cache (in-memory LRU)
// ─────────────────────────────────────────────────────────────

const QUERY_CACHE_MAX = 2000; // 최대 2,000개 쿼리 캐시 (메모리 ~50MB 이내)
const queryCache = new Map<string, number[]>();

function getCacheKey(text: string): string {
  return text.trim().toLowerCase();
}

function cacheSet(key: string, value: number[]): void {
  // LRU: 한도 초과 시 가장 오래된 항목 제거
  if (queryCache.size >= QUERY_CACHE_MAX) {
    const firstKey = queryCache.keys().next().value;
    queryCache.delete(firstKey);
  }
  queryCache.set(key, value);
}

// ─────────────────────────────────────────────────────────────
// Embedding generation
// ─────────────────────────────────────────────────────────────

function getClient(): GoogleGenerativeAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');
  return new GoogleGenerativeAI(apiKey);
}

/**
 * Generates an embedding vector for an event document.
 * Use taskType RETRIEVAL_DOCUMENT when indexing.
 */
export async function embedDocument(text: string): Promise<number[]> {
  const genAI = getClient();
  const model = genAI.getGenerativeModel({ model: MODEL });
  const result = await model.embedContent({
    content: { parts: [{ text }], role: 'user' },
    taskType: TaskType.RETRIEVAL_DOCUMENT,
  });
  return result.embedding.values;
}

/**
 * Generates an embedding vector for a search query.
 * 동일한 쿼리는 캐시에서 반환하여 Gemini API 호출 절약.
 */
export async function embedQuery(text: string): Promise<number[]> {
  const key = getCacheKey(text);

  const cached = queryCache.get(key);
  if (cached) {
    console.log(`[embedQuery] cache hit: "${key}"`);
    return cached;
  }

  const genAI = getClient();
  const model = genAI.getGenerativeModel({ model: MODEL });
  const result = await model.embedContent({
    content: { parts: [{ text }], role: 'user' },
    taskType: TaskType.RETRIEVAL_QUERY,
  });

  const embedding = result.embedding.values;
  cacheSet(key, embedding);
  return embedding;
}

/**
 * Formats a number[] embedding as PostgreSQL vector literal.
 * e.g. "[0.1, 0.2, ...]"
 */
export function toVectorLiteral(values: number[]): string {
  return `[${values.join(',')}]`;
}
