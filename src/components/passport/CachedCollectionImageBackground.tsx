import React, { type ReactNode, useState } from 'react';
import {
  Image,
  type ImageResizeMode,
  type ImageStyle,
  StyleSheet,
  type StyleProp,
  View,
  type ViewStyle,
} from 'react-native';
import { isValidImageUrl } from '../../utils/imageHelpers';
import {
  normalizeSavedCategory,
  SAVED_CATEGORY_DARK_COLORS,
} from '../saved/savedTicketUtils';

const MAX_REMEMBERED_IMAGES = 256;
const DEFAULT_PREFETCH_CONCURRENCY = 6;

/**
 * React Native keeps the actual bitmap in its native cache. This small LRU only
 * remembers which URLs completed loading so a remounted collection tab does not
 * return to its loading state while the native cache resolves the same image.
 */
const loadedImageUrls = new Map<string, true>();
const inFlightImagePrefetches = new Map<string, Promise<boolean>>();

type LoadPhase = 'idle' | 'loading' | 'loaded' | 'error';

export interface RemoteImagePrefetchResult {
  requestedUrls: string[];
  loadedUrls: string[];
  failedUrls: string[];
}

export interface CachedCollectionImageBackgroundProps {
  uri?: string | null;
  category?: string | null;
  subCategory?: string | null;
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  imageStyle?: StyleProp<ImageStyle>;
  resizeMode?: ImageResizeMode;
  placeholderColor?: string;
  accessibilityLabel?: string;
  testID?: string;
  onImageLoad?: (uri: string) => void;
  onImageError?: (uri: string) => void;
}

function normalizedRemoteUri(uri?: string | null): string | null {
  const normalized = uri?.trim();
  return normalized && isValidImageUrl(normalized) ? normalized : null;
}

function rememberLoadedUrl(uri: string): void {
  // Delete before setting so access order is reflected in the Map's insertion order.
  loadedImageUrls.delete(uri);
  loadedImageUrls.set(uri, true);

  while (loadedImageUrls.size > MAX_REMEMBERED_IMAGES) {
    const oldest = loadedImageUrls.keys().next().value as string | undefined;
    if (!oldest) break;
    loadedImageUrls.delete(oldest);
  }
}

function forgetLoadedUrl(uri: string): void {
  loadedImageUrls.delete(uri);
}

function initialPhase(uri: string | null): LoadPhase {
  if (!uri) return 'idle';
  return loadedImageUrls.has(uri) ? 'loaded' : 'loading';
}

export function getCollectionImagePlaceholderColor(
  category?: string | null,
  subCategory?: string | null,
): string {
  const combined = `${category ?? ''} ${subCategory ?? ''}`.toLowerCase();
  if (combined.includes('팝업') || combined.includes('popup')) {
    return SAVED_CATEGORY_DARK_COLORS.팝업;
  }
  if (
    combined.includes('전시') ||
    combined.includes('미술') ||
    combined.includes('갤러리') ||
    combined.includes('exhibition')
  ) {
    return SAVED_CATEGORY_DARK_COLORS.전시;
  }
  if (
    combined.includes('공연') ||
    combined.includes('뮤지컬') ||
    combined.includes('연극') ||
    combined.includes('콘서트') ||
    combined.includes('클래식') ||
    combined.includes('무용') ||
    combined.includes('concert')
  ) {
    return SAVED_CATEGORY_DARK_COLORS.공연;
  }
  if (
    combined.includes('축제') ||
    combined.includes('페스티벌') ||
    combined.includes('festival')
  ) {
    return SAVED_CATEGORY_DARK_COLORS.축제;
  }
  return SAVED_CATEGORY_DARK_COLORS[normalizeSavedCategory(category, subCategory)];
}

/**
 * Clears only the JS load-state memory. React Native remains responsible for its
 * native image cache. Passing a URL is useful when an upstream image was replaced.
 */
export function resetRememberedCollectionImages(uri?: string | null): void {
  const normalized = normalizedRemoteUri(uri);
  if (normalized) {
    forgetLoadedUrl(normalized);
    inFlightImagePrefetches.delete(normalized);
    return;
  }
  loadedImageUrls.clear();
  inFlightImagePrefetches.clear();
}

function prefetchOneCollectionImage(uri: string): Promise<boolean> {
  if (loadedImageUrls.has(uri)) {
    rememberLoadedUrl(uri);
    return Promise.resolve(true);
  }
  const existing = inFlightImagePrefetches.get(uri);
  if (existing) return existing;

  const request = Image.prefetch(uri)
    .then((loaded) => {
      if (loaded === false) return false;
      rememberLoadedUrl(uri);
      return true;
    })
    .catch(() => false)
    .finally(() => {
      if (inFlightImagePrefetches.get(uri) === request) inFlightImagePrefetches.delete(uri);
    });
  inFlightImagePrefetches.set(uri, request);
  return request;
}

/**
 * Warms React Native's native image cache with bounded concurrency. Invalid and
 * duplicate URLs are ignored, and one failed image does not reject the full batch.
 */
export async function prefetchCollectionImageUrls(
  urls: readonly (string | null | undefined)[],
  concurrency = DEFAULT_PREFETCH_CONCURRENCY,
): Promise<RemoteImagePrefetchResult> {
  const requestedUrls = Array.from(
    new Set(urls.map(normalizedRemoteUri).filter((uri): uri is string => Boolean(uri))),
  );
  const loadedUrls: string[] = [];
  const failedUrls: string[] = [];
  const safeConcurrency = Number.isFinite(concurrency)
    ? Math.max(1, Math.floor(concurrency))
    : DEFAULT_PREFETCH_CONCURRENCY;

  let cursor = 0;
  const worker = async () => {
    while (cursor < requestedUrls.length) {
      const uri = requestedUrls[cursor];
      cursor += 1;
      if (!uri) continue;

      const loaded = await prefetchOneCollectionImage(uri);
      if (loaded) {
        loadedUrls.push(uri);
      } else {
        failedUrls.push(uri);
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(safeConcurrency, requestedUrls.length) }, () => worker()),
  );

  return { requestedUrls, loadedUrls, failedUrls };
}

/**
 * Remote-image background for collection cards.
 *
 * The category placeholder is always painted underneath the image, including on
 * the very first frame and after an error. Children are rendered in a separate
 * layer above the image, matching ImageBackground's overlay behavior.
 */
export function CachedCollectionImageBackground({
  uri,
  category,
  subCategory,
  children,
  style,
  imageStyle,
  resizeMode = 'cover',
  placeholderColor,
  accessibilityLabel,
  testID,
  onImageLoad,
  onImageError,
}: CachedCollectionImageBackgroundProps) {
  const remoteUri = normalizedRemoteUri(uri);
  const identity = remoteUri ?? '';
  const [loadState, setLoadState] = useState<{ identity: string; phase: LoadPhase }>(() => ({
    identity,
    phase: initialPhase(remoteUri),
  }));
  const phase = loadState.identity === identity ? loadState.phase : initialPhase(remoteUri);
  const fallback = placeholderColor ?? getCollectionImagePlaceholderColor(category, subCategory);

  return (
    <View style={[styles.container, { backgroundColor: fallback }, style]} testID={testID}>
      <View
        pointerEvents="none"
        style={[StyleSheet.absoluteFillObject, { backgroundColor: fallback }]}
        testID={testID ? `${testID}-placeholder` : undefined}
      >
        <View style={styles.placeholderHalo} />
        <View style={styles.placeholderStripe} />
        <View style={styles.placeholderDot} />
      </View>
      {remoteUri ? (
        <Image
          key={identity}
          accessibilityLabel={accessibilityLabel}
          fadeDuration={0}
          resizeMode={resizeMode}
          source={{ uri: remoteUri, cache: 'force-cache' }}
          style={[
            StyleSheet.absoluteFillObject,
            imageStyle,
            { opacity: phase === 'loaded' ? 1 : 0 },
          ]}
          testID={testID ? `${testID}-image` : undefined}
          onLoad={() => {
            rememberLoadedUrl(remoteUri);
            setLoadState({ identity, phase: 'loaded' });
            onImageLoad?.(remoteUri);
          }}
          onError={() => {
            forgetLoadedUrl(remoteUri);
            setLoadState({ identity, phase: 'error' });
            onImageError?.(remoteUri);
          }}
        />
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
  },
  placeholderHalo: {
    position: 'absolute',
    width: 210,
    height: 210,
    borderRadius: 105,
    right: -72,
    top: -76,
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  placeholderStripe: {
    position: 'absolute',
    width: '140%',
    height: 46,
    left: '-20%',
    top: '46%',
    transform: [{ rotate: '-18deg' }],
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  placeholderDot: {
    position: 'absolute',
    width: 64,
    height: 64,
    borderRadius: 32,
    left: -18,
    bottom: 22,
    borderWidth: 12,
    borderColor: 'rgba(255,255,255,0.08)',
  },
});
