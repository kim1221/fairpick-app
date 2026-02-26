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
 * Use taskType RETRIEVAL_QUERY for user search terms.
 */
export async function embedQuery(text: string): Promise<number[]> {
  const genAI = getClient();
  const model = genAI.getGenerativeModel({ model: MODEL });
  const result = await model.embedContent({
    content: { parts: [{ text }], role: 'user' },
    taskType: TaskType.RETRIEVAL_QUERY,
  });
  return result.embedding.values;
}

/**
 * Formats a number[] embedding as PostgreSQL vector literal.
 * e.g. "[0.1, 0.2, ...]"
 */
export function toVectorLiteral(values: number[]): string {
  return `[${values.join(',')}]`;
}
