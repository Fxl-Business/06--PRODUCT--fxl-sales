/**
 * A simulated Finance producer feed: an in-memory, ordered list of FeedEvent
 * served through the package's `fetchFeedPage` seam. Only the network fetch is
 * doubled; the real inbox, cursor, idempotency and handlers run around it.
 */
import type { FeedEvent, FeedPage } from '@fxl-business/fxl-contracts';

export const FINANCE_APP = 'app.fxl-finance';

export type SimulatedFinanceFeed = {
  /** Appends an event with the next strictly increasing position. */
  publish(eventName: string, payload: unknown, opts?: { eventVersion?: number }): FeedEvent;
  fetchFeedPage: (pair: unknown, after: bigint, limit: number) => Promise<FeedPage>;
};

export function createSimulatedFinanceFeed(startAt = 0n): SimulatedFinanceFeed {
  const events: FeedEvent[] = [];
  let position = startAt;
  let seq = 0;
  return {
    publish(eventName, payload, opts = {}) {
      position += 1n;
      seq += 1;
      const event: FeedEvent = {
        position,
        eventName,
        eventVersion: opts.eventVersion ?? 1,
        idempotencyKey: `${eventName}:sim-${position}-${seq}`,
        payload,
        occurredAt: '2026-09-01T12:00:00.000Z',
      };
      events.push(event);
      return event;
    },
    async fetchFeedPage(_pair, after, limit) {
      const page = events.filter((e) => e.position > after).slice(0, limit);
      return { events: page, nextCursor: page.length ? page[page.length - 1]!.position : after };
    },
  };
}
