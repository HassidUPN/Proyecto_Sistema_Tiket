import type { Ticket } from '@/types/ticket';

export const PN_LOW_BACKLOG = 5;

export interface Ratio {
  te: number;
  pn: number;
}

export interface PriorityState {
  teServedSinceSwitch: number;
  currentRatioTe: number;
}

export interface PrioritySelectorResult {
  ticket: Ticket | null;
  updatedState: PriorityState;
}

export function getRatio(pnQueueLength: number): Ratio {
  if (pnQueueLength < PN_LOW_BACKLOG) return { te: 2, pn: 1 };
  return { te: 1, pn: 1 };
}

export function selectNextTicket(
  teQueue: Ticket[],
  pnQueue: Ticket[],
  state: PriorityState,
): PrioritySelectorResult {
  const teAvailable = teQueue.length > 0;
  const pnAvailable = pnQueue.length > 0;

  if (!teAvailable && !pnAvailable) return { ticket: null, updatedState: state };
  if (!teAvailable) return { ticket: pnQueue[0], updatedState: { ...state, teServedSinceSwitch: 0 } };
  if (!pnAvailable) return { ticket: teQueue[0], updatedState: state };

  const ratio = getRatio(pnQueue.length);
  const teServedSinceSwitch = ratio.te !== state.currentRatioTe ? 0 : state.teServedSinceSwitch;

  if (teServedSinceSwitch < ratio.te) {
    return {
      ticket: teQueue[0],
      updatedState: { teServedSinceSwitch: teServedSinceSwitch + 1, currentRatioTe: ratio.te },
    };
  }

  return {
    ticket: pnQueue[0],
    updatedState: { teServedSinceSwitch: 0, currentRatioTe: ratio.te },
  };
}
