import { describe, expect, jest, test } from '@jest/globals';
import { renderHook, waitFor } from '@testing-library/react-native';
import { useAuth } from '../useAuth';

const mockGetToken = jest.fn(() => Promise.resolve('stored-token'));
const mockGetStoredUser = jest.fn(() =>
  Promise.resolve({ id: 'user-1', userKey: 101, name: '저장된 이름' })
);
const mockSetStoredUser = jest.fn<(user: unknown) => Promise<void>>(() => Promise.resolve());
const mockHttpGet = jest.fn<(url: string) => Promise<{
  data: { id: string; userKey: number | null; anonymous: boolean };
}>>(() =>
  Promise.resolve({ data: { id: 'user-1', userKey: 101, anonymous: false } })
);

jest.mock('@apps-in-toss/framework', () => ({
  appLogin: jest.fn(),
}));

jest.mock('../../lib/http', () => ({
  __esModule: true,
  default: {
    get: (url: string) => mockHttpGet(url),
    post: jest.fn(),
  },
}));

jest.mock('../../utils/authStorage', () => ({
  getToken: () => mockGetToken(),
  setToken: jest.fn(),
  clearToken: jest.fn(),
  getStoredUser: () => mockGetStoredUser(),
  setStoredUser: (user: unknown) => mockSetStoredUser(user),
  clearStoredUser: jest.fn(),
}));

jest.mock('../../utils/anonymousUser', () => ({
  getOrCreateAnonymousId: jest.fn(),
}));

jest.mock('../../utils/storage', () => ({
  getLikesV2: jest.fn(),
  getRecentV2: jest.fn(),
}));

describe('useAuth shared hydration', () => {
  test('shares the first restore request and gives later mounts the resolved state immediately', async () => {
    const firstMount = renderHook(() => {
      const first = useAuth();
      const second = useAuth();
      return { first, second };
    });

    expect(firstMount.result.current.first.isLoading).toBe(true);
    expect(firstMount.result.current.second.isLoading).toBe(true);

    await waitFor(() => {
      expect(firstMount.result.current.first).toMatchObject({
        isLoggedIn: true,
        isLinked: true,
        isLoading: false,
        // /auth/session은 name을 안 주므로 저장된 이름을 유지한다.
        user: { id: 'user-1', userKey: 101, name: '저장된 이름' },
      });
      expect(firstMount.result.current.second).toMatchObject({
        isLoggedIn: true,
        isLinked: true,
        isLoading: false,
        user: { id: 'user-1', userKey: 101, name: '저장된 이름' },
      });
    });

    expect(mockGetToken).toHaveBeenCalledTimes(1);
    expect(mockGetStoredUser).toHaveBeenCalledTimes(1);
    expect(mockHttpGet).toHaveBeenCalledTimes(1);
    expect(mockHttpGet).toHaveBeenCalledWith('/auth/session');
    expect(mockSetStoredUser).toHaveBeenCalledTimes(1);

    firstMount.unmount();

    const laterMount = renderHook(() => useAuth());

    expect(laterMount.result.current).toMatchObject({
      isLoggedIn: true,
      isLinked: true,
      isLoading: false,
      user: { id: 'user-1', userKey: 101, name: '저장된 이름' },
    });
    expect(mockGetToken).toHaveBeenCalledTimes(1);
    expect(mockGetStoredUser).toHaveBeenCalledTimes(1);
    expect(mockHttpGet).toHaveBeenCalledTimes(1);
  });
});
