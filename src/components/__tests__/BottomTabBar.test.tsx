import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';
import { BottomTabBar } from '../BottomTabBar';

const mockReplace = jest.fn();
const mockNavigate = jest.fn();

jest.mock('@granite-js/react-native', () => ({
  useNavigation: () => ({ replace: mockReplace, navigate: mockNavigate }),
}));

jest.mock('@toss/tds-react-native', () => ({
  Icon: () => null,
}));

jest.mock('@toss/tds-react-native/private', () => ({
  useAdaptive: () => ({
    background: '#FFFFFF',
    grey500: '#777777',
  }),
}));

describe('BottomTabBar', () => {
  beforeEach(() => {
    mockReplace.mockClear();
    mockNavigate.mockClear();
  });

  test('replaces the current top-level route instead of stacking it with navigate', () => {
    const screen = render(<BottomTabBar currentTab="home" />);

    fireEvent.press(screen.getByText('컬렉션'));
    fireEvent.press(screen.getByText('리워드'));

    expect(mockReplace).toHaveBeenNthCalledWith(1, '/passport');
    expect(mockReplace).toHaveBeenNthCalledWith(2, '/points');
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  test('does not replace an already active tab but still handles a home-tab reselect', () => {
    const onHomeTabPress = jest.fn();
    const screen = render(
      <BottomTabBar currentTab="home" onHomeTabPress={onHomeTabPress} />
    );

    fireEvent.press(screen.getByText('오늘'));

    expect(onHomeTabPress).toHaveBeenCalledTimes(1);
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  test('replaces another tab with home after running the home scroll callback', () => {
    const onHomeTabPress = jest.fn();
    const screen = render(
      <BottomTabBar currentTab="passport" onHomeTabPress={onHomeTabPress} />
    );

    fireEvent.press(screen.getByText('오늘'));

    expect(onHomeTabPress).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith('/');
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
