import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';
import { QueuedSale, SaleQueue, SendResult, SyncSummary } from '../lib/queue';
import { earn, newTxnId } from './api';

export const saleQueue = new SaleQueue(AsyncStorage);

let deviceId: string | null = null;
/** A stable id for this phone, stored with each sale so a till can be traced. */
export async function getDeviceId(): Promise<string> {
  if (deviceId) return deviceId;
  try {
    const saved = await AsyncStorage.getItem('fiji.deviceId');
    if (saved) return (deviceId = saved);
    const fresh = newTxnId();
    await AsyncStorage.setItem('fiji.deviceId', fresh);
    return (deviceId = fresh);
  } catch { return (deviceId = newTxnId()); }
}

async function send(sale: QueuedSale): Promise<SendResult> {
  const r = await earn(sale.customerId, sale.amount, sale.id, await getDeviceId(), sale.occurredAt,
    sale.qrTs !== undefined && sale.qrSig ? { ts: sale.qrTs, sig: sale.qrSig } : undefined);
  return r.ok ? { ok: true } : { ok: false, offline: r.offline, message: r.message };
}

export const syncNow = (): Promise<SyncSummary> => saleQueue.sync(send);

// The queue replaces its list on every change, so the list itself is a safe snapshot.
export const useQueuedSales = () => useSyncExternalStore((fn) => saleQueue.subscribe(fn), () => saleQueue.list());
