// Cheap phone clocks drift. Both the customer's QR and the till's sale times use the server's time,
// corrected by an offset learned whenever the phone is online.
let offsetMs = 0;

export const serverNow = (): number => Date.now() + offsetMs;
export const serverEpochSeconds = (): number => Math.floor(serverNow() / 1000);
export const getClockOffset = (): number => offsetMs;
export const setClockOffset = (ms: number): void => { offsetMs = Number.isFinite(ms) ? ms : 0; };

/** Learns the offset from one server reading, taken between sending and receiving the request. */
export function offsetFromReading(serverMs: number, sentLocalMs: number, receivedLocalMs: number): number {
  return serverMs - (sentLocalMs + receivedLocalMs) / 2;
}
