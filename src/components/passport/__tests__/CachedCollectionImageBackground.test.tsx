import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';
import { Image, StyleSheet, Text } from 'react-native';
import {
  CachedCollectionImageBackground,
  getCollectionImagePlaceholderColor,
  prefetchCollectionImageUrls,
  resetRememberedCollectionImages,
} from '../CachedCollectionImageBackground';

const FIRST_URI = 'https://images.example.com/first.jpg';
const SECOND_URI = 'https://images.example.com/second.jpg';

function opacityOf(style: unknown): number | undefined {
  return (StyleSheet.flatten(style as never) as { opacity?: number } | undefined)?.opacity;
}

describe('CachedCollectionImageBackground', () => {
  beforeEach(() => {
    resetRememberedCollectionImages();
    jest.restoreAllMocks();
  });

  test('uses a deterministic category placeholder and preserves overlay children', () => {
    const screen = render(
      <CachedCollectionImageBackground uri={FIRST_URI} category="공연" testID="poster">
        <Text>카드 제목</Text>
      </CachedCollectionImageBackground>,
    );

    expect(getCollectionImagePlaceholderColor('공연')).toBe('#2A1018');
    expect(getCollectionImagePlaceholderColor('뮤지컬')).toBe('#2A1018');
    expect(getCollectionImagePlaceholderColor('전시')).toBe('#16223F');
    expect(screen.getByTestId('poster-placeholder').props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ backgroundColor: '#2A1018' })]),
    );
    expect(screen.getByText('카드 제목')).toBeTruthy();
    expect(opacityOf(screen.getByTestId('poster-image').props.style)).toBe(0);
  });

  test('remembers a loaded URL so a tab remount starts with the cached image visible', () => {
    const first = render(
      <CachedCollectionImageBackground uri={FIRST_URI} category="전시" testID="first" />,
    );

    fireEvent(first.getByTestId('first-image'), 'load');
    expect(opacityOf(first.getByTestId('first-image').props.style)).toBe(1);
    first.unmount();

    const remounted = render(
      <CachedCollectionImageBackground uri={FIRST_URI} category="전시" testID="again" />,
    );
    expect(opacityOf(remounted.getByTestId('again-image').props.style)).toBe(1);
  });

  test('keeps the placeholder after an error and resets loading state for a new URL', () => {
    const onImageError = jest.fn();
    const screen = render(
      <CachedCollectionImageBackground
        uri={FIRST_URI}
        category="팝업"
        testID="poster"
        onImageError={onImageError}
      />,
    );

    fireEvent(screen.getByTestId('poster-image'), 'error');
    expect(onImageError).toHaveBeenCalledWith(FIRST_URI);
    expect(opacityOf(screen.getByTestId('poster-image').props.style)).toBe(0);

    screen.rerender(
      <CachedCollectionImageBackground uri={SECOND_URI} category="팝업" testID="poster" />,
    );
    expect(screen.getByTestId('poster-image').props.source).toMatchObject({ uri: SECOND_URI });
    expect(opacityOf(screen.getByTestId('poster-image').props.style)).toBe(0);
    fireEvent(screen.getByTestId('poster-image'), 'load');
    expect(opacityOf(screen.getByTestId('poster-image').props.style)).toBe(1);
  });

  test('prefetches unique valid URLs, records successes, and isolates failures', async () => {
    const prefetch = jest.spyOn(Image, 'prefetch').mockImplementation(async (uri: string) => {
      if (uri === SECOND_URI) throw new Error('network failure');
      return true;
    });

    const result = await prefetchCollectionImageUrls([
      FIRST_URI,
      FIRST_URI,
      '',
      'not-a-url',
      SECOND_URI,
    ]);

    expect(prefetch).toHaveBeenCalledTimes(2);
    expect(result.requestedUrls).toEqual([FIRST_URI, SECOND_URI]);
    expect(result.loadedUrls).toEqual([FIRST_URI]);
    expect(result.failedUrls).toEqual([SECOND_URI]);

    const screen = render(
      <CachedCollectionImageBackground uri={FIRST_URI} category="전시" testID="prefetched" />,
    );
    expect(opacityOf(screen.getByTestId('prefetched-image').props.style)).toBe(1);
  });

  test('shares an in-flight native prefetch across collection sections', async () => {
    let resolvePrefetch!: (loaded: boolean) => void;
    const nativeRequest = new Promise<boolean>((resolve) => {
      resolvePrefetch = resolve;
    });
    const prefetch = jest.spyOn(Image, 'prefetch').mockReturnValue(nativeRequest);

    const overviewRequest = prefetchCollectionImageUrls([FIRST_URI]);
    const fullScreenRequest = prefetchCollectionImageUrls([FIRST_URI]);

    expect(prefetch).toHaveBeenCalledTimes(1);
    resolvePrefetch(true);

    await expect(Promise.all([overviewRequest, fullScreenRequest])).resolves.toEqual([
      { requestedUrls: [FIRST_URI], loadedUrls: [FIRST_URI], failedUrls: [] },
      { requestedUrls: [FIRST_URI], loadedUrls: [FIRST_URI], failedUrls: [] },
    ]);
  });
});
