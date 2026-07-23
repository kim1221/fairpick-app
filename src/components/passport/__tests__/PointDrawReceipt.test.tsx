import { describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';
import {
  formatDrawNo,
  formatReceiptDate,
  nextDrawStatus,
  PointDrawReceipt,
} from '../PointDrawReceipt';

describe('PointDrawReceipt helpers', () => {
  test('formatReceiptDate renders YYYY.MM.DD HH:mm', () => {
    expect(formatReceiptDate(new Date(2026, 6, 20, 14, 2))).toBe('2026.07.20 14:02');
    expect(formatReceiptDate(new Date(Number.NaN))).toBe('');
  });

  test('formatDrawNo pads to four digits and falls back to a dash', () => {
    expect(formatDrawNo(3)).toBe('0003');
    expect(formatDrawNo(1234)).toBe('1234');
    expect(formatDrawNo(null)).toBe('—');
    expect(formatDrawNo(0)).toBe('—');
  });

  test('nextDrawStatus reports remaining tickets or a ready state', () => {
    expect(nextDrawStatus(0, 10)).toEqual({ label: '다음 뽑기까지 티켓 10장', filled: 0 });
    expect(nextDrawStatus(7, 10)).toEqual({ label: '다음 뽑기까지 티켓 3장', filled: 7 });
    expect(nextDrawStatus(12, 10)).toEqual({
      label: '티켓이 충분해요 · 한 번 더 뽑을 수 있어요',
      filled: 10,
    });
  });
});

describe('PointDrawReceipt', () => {
  function renderReceipt(overrides: Partial<React.ComponentProps<typeof PointDrawReceipt>> = {}) {
    const onClose = jest.fn();
    const utils = render(
      <PointDrawReceipt
        amount={50}
        drawNo={3}
        usedTickets={10}
        ticketCount={2}
        ticketsPerExchange={10}
        drawnAt={new Date(2026, 6, 20, 14, 2)}
        onClose={onClose}
        {...overrides}
      />
    );
    return { ...utils, onClose };
  }

  test('shows the server-drawn amount as a stamp with receipt metadata', () => {
    const { getByText } = renderReceipt();
    expect(getByText('₩50')).toBeTruthy();
    expect(getByText('토스포인트로 지급됐어요')).toBeTruthy();
    expect(getByText('2026.07.20 14:02')).toBeTruthy();
    expect(getByText('티켓 10장')).toBeTruthy();
    expect(getByText('0003')).toBeTruthy();
  });

  test('keeps the result factual — no range/average repetition, no max-amount pitch', () => {
    // 범위·평균 고지는 뽑기 전 화면(리워드탭 바우처)의 몫이다(2026-07-23 결정).
    const { getByText, queryByText } = renderReceipt();
    expect(getByText('지급 내역은 토스포인트에서 확인할 수 있어요')).toBeTruthy();
    expect(queryByText(/평균|사이에서/)).toBeNull();
    expect(queryByText(/최대/)).toBeNull();
  });

  test('renders a dash draw number when the backend omits totalExchanged', () => {
    const { getByText } = renderReceipt({ drawNo: null });
    expect(getByText('—')).toBeTruthy();
  });

  test('confirm button closes the receipt', () => {
    const { getByText, onClose } = renderReceipt();
    fireEvent.press(getByText('확인'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
