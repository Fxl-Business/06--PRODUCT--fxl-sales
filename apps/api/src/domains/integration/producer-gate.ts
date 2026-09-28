/**
 * Producer activation gate. Default is CLOSED: no org emits integration events
 * until the boot (slice 08) installs the real predicate.
 */
export type ProducerFlowGate = (orgId: string) => boolean;

let gate: ProducerFlowGate = () => false;

export function isProducerFlowLive(orgId: string): boolean {
  return gate(orgId) === true;
}

export function registerProducerFlowGate(fn: ProducerFlowGate): void {
  gate = fn;
}
