import { describe, expect, jest, test } from '@jest/globals';
import { fireEvent, render } from '@testing-library/react-native';
import React from 'react';
import { TicketBalanceVoucher } from '../TicketBalanceVoucher';
import { TicketHistoryList } from '../TicketHistoryList';

jest.mock('@toss/tds-react-native', () => ({
  Icon: () => null,
  Loader: () => null,
}));

describe('TicketBalanceVoucher (포인트 뽑기 리브랜딩)', () => {
  test('shows the draw CTA and honest range copy when exchangeable', () => {
    const onExchange = jest.fn();
    const { getByRole, getByText } = render(
      <TicketBalanceVoucher
        ticketCount={23}
        ticketsPerExchange={10}
        exchanging={false}
        onExchange={onExchange}
        amountRange={{ min: 10, max: 500, average: 20 }}
      />
    );

    const cta = getByRole('button');
    expect(cta).toHaveTextContent(/포인트 뽑기/);
    expect(getByText('2번 뽑기 가능')).toBeTruthy();
    expect(getByText('10티켓 = 포인트 뽑기 1번 · 지금 2번 뽑을 수 있어요')).toBeTruthy();
    expect(getByText(/매번 10원~500원 사이에서 뽑혀요 · 평균 20원/)).toBeTruthy();

    fireEvent.press(cta);
    expect(onExchange).toHaveBeenCalledTimes(1);
  });

  test('shows remaining tickets when not exchangeable', () => {
    const { getByText } = render(
      <TicketBalanceVoucher
        ticketCount={7}
        ticketsPerExchange={10}
        exchanging={false}
        onExchange={jest.fn()}
      />
    );

    expect(getByText('3장 더 모으기')).toBeTruthy();
    expect(getByText('다음 뽑기까지 3티켓')).toBeTruthy();
  });
});

describe('TicketHistoryList (실지급액 표시)', () => {
  test('appends the paid won amount to point draw rows', () => {
    const { getByText } = render(
      <TicketHistoryList
        items={[
          {
            type: 'exchange',
            label: '포인트 뽑기',
            amount: -10,
            occurredAt: new Date().toISOString(),
            paidAmount: 50,
          },
        ]}
        loading={false}
      />
    );

    expect(getByText('포인트 뽑기')).toBeTruthy();
    expect(getByText('오늘 · 50원 지급')).toBeTruthy();
    expect(getByText('-10 티켓')).toBeTruthy();
  });

  test('keeps the plain date line when paidAmount is missing (구버전 백엔드)', () => {
    const { getByText } = render(
      <TicketHistoryList
        items={[
          {
            type: 'exchange',
            label: '포인트 뽑기',
            amount: -10,
            occurredAt: new Date().toISOString(),
          },
        ]}
        loading={false}
      />
    );

    expect(getByText('오늘')).toBeTruthy();
  });
});
