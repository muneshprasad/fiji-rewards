import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';

/** Must match qr_signature() in the database: HMAC-SHA256 of "customerId:timestamp", first 20 hex characters. */
export function signQr(secretHex: string, customerId: string, ts: number): string {
  const mac = hmac(sha256, hexToBytes(secretHex), utf8ToBytes(`${customerId}:${ts}`));
  return bytesToHex(mac).slice(0, 20);
}
