import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import {
  markVisited,
  subscribeVisitChange,
  unmarkVisited,
  type VisitChangeEvent,
} from '../visitService';

const mockPost = jest.fn<
  (url: string, body: unknown) => Promise<{
    data: { ok: true; alreadyVisited: boolean; stampCount: number };
  }>
>();
const mockDelete = jest.fn<
  (url: string) => Promise<{ data: { ok: true; stampCount: number } }>
>();

jest.mock('../../lib/http', () => ({
  __esModule: true,
  default: {
    post: (url: string, body: unknown) => mockPost(url, body),
    delete: (url: string) => mockDelete(url),
  },
}));

describe('visit service change notifications', () => {
  beforeEach(() => {
    mockPost.mockReset();
    mockDelete.mockReset();
  });

  test('notifies subscribers after successful mark and unmark requests, then stops after unsubscribe', async () => {
    const listener = jest.fn<(event: VisitChangeEvent) => void>();
    const unsubscribe = subscribeVisitChange(listener);
    mockPost
      .mockResolvedValueOnce({ data: { ok: true, alreadyVisited: false, stampCount: 1 } })
      .mockResolvedValueOnce({ data: { ok: true, alreadyVisited: true, stampCount: 1 } });
    mockDelete.mockResolvedValueOnce({ data: { ok: true, stampCount: 0 } });

    await expect(markVisited('event / 1')).resolves.toEqual({
      alreadyVisited: false,
      stampCount: 1,
    });
    await expect(unmarkVisited('event / 1')).resolves.toEqual({ stampCount: 0 });

    expect(mockPost).toHaveBeenCalledWith('/api/visits', { eventId: 'event / 1' });
    expect(mockDelete).toHaveBeenCalledWith('/api/visits/event%20%2F%201');
    expect(listener.mock.calls).toEqual([
      [{ eventId: 'event / 1', visited: true }],
      [{ eventId: 'event / 1', visited: false }],
    ]);

    unsubscribe();
    await markVisited('event / 1');
    expect(listener).toHaveBeenCalledTimes(2);
  });

  test('does not announce a state change when the request fails', async () => {
    const listener = jest.fn<(event: VisitChangeEvent) => void>();
    const unsubscribe = subscribeVisitChange(listener);
    mockPost.mockRejectedValueOnce(new Error('network failed'));

    await expect(markVisited('failed-event')).rejects.toThrow('network failed');
    expect(listener).not.toHaveBeenCalled();

    unsubscribe();
  });

  test('isolates a broken subscriber after the server mutation succeeds', async () => {
    const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
    const brokenUnsubscribe = subscribeVisitChange(() => {
      throw new Error('subscriber failed');
    });
    const healthyListener = jest.fn<(event: VisitChangeEvent) => void>();
    const healthyUnsubscribe = subscribeVisitChange(healthyListener);
    mockPost.mockResolvedValueOnce({ data: { ok: true, alreadyVisited: false, stampCount: 1 } });

    await expect(markVisited('safe-event')).resolves.toEqual({
      alreadyVisited: false,
      stampCount: 1,
    });
    expect(healthyListener).toHaveBeenCalledWith({ eventId: 'safe-event', visited: true });
    expect(errorLog).toHaveBeenCalledWith('[visitService][emitVisitChange]', expect.any(Error));

    brokenUnsubscribe();
    healthyUnsubscribe();
    errorLog.mockRestore();
  });
});
