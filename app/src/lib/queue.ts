// Offline queue for earn sales at the till. Only earn sales are queued; redemptions always need a connection.
// Safety rests on two things: every sale has a fixed id (the server ignores a repeat of an id it has seen),
// and a sale is removed from the queue only after the server confirms it.

export type QueuedSale = {
  id: string;                 // client_txn_id, created when the cashier taps Confirm
  customerId: string;
  customerLabel: string;
  amount: number;
  occurredAt: string;         // ISO time of the sale, so points and expiry date from the real sale time
  qrTs?: number;              // the customer's signed QR (time and signature), checked by the server when the sale is sent
  qrSig?: string;
  status: 'pending' | 'rejected';
  attempts: number;
  lastError?: string;
};

export type SendResult = { ok: true } | { ok: false; offline: boolean; message: string };
export type Sender = (sale: QueuedSale) => Promise<SendResult>;
export type Storage = { getItem(k: string): Promise<string | null>; setItem(k: string, v: string): Promise<void> };

export const MAX_QUEUE = 200;
export const SERVER_WINDOW_DAYS = 7;       // the database refuses sales older than this
export const WARN_AFTER_DAYS = 5;
export const MAX_SCANS_PER_HOUR = 3;       // mirrors the network setting; the server stays the judge

export const daysOld = (s: QueuedSale, now = Date.now()) => (now - Date.parse(s.occurredAt)) / 86400000;

export class SaleQueue {
  private items: QueuedSale[] = [];
  private listeners = new Set<() => void>();
  private running: Promise<SyncSummary> | null = null;

  private storage: Storage;
  private key: string;

  constructor(storage: Storage, key = 'fiji.saleQueue.v1') {
    this.storage = storage;
    this.key = key;
  }

  async load(): Promise<void> {
    try {
      const raw = await this.storage.getItem(this.key);
      const parsed = raw ? JSON.parse(raw) : [];
      this.items = Array.isArray(parsed) ? parsed.filter(isSale) : [];
    } catch {
      this.items = [];   // unreadable data should never block the till
    }
    this.emit();
  }

  list(): readonly QueuedSale[] { return this.items; }
  pendingCount(): number { return this.items.filter((s) => s.status === 'pending').length; }
  rejectedCount(): number { return this.items.filter((s) => s.status === 'rejected').length; }

  subscribe(fn: () => void): () => void { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }

  /** Sales for this customer in the last hour (queued here), to apply the scan limit before the server can. */
  recentFor(customerId: string, now = Date.now()): number {
    return this.items.filter((s) => s.customerId === customerId && s.status === 'pending' && now - Date.parse(s.occurredAt) < 3600000).length;
  }

  async add(sale: Omit<QueuedSale, 'status' | 'attempts'>): Promise<'added' | 'duplicate' | 'full'> {
    if (this.items.some((s) => s.id === sale.id)) return 'duplicate';
    if (this.items.length >= MAX_QUEUE) return 'full';
    this.items = [...this.items, { ...sale, status: 'pending', attempts: 0 }];
    await this.save();
    return 'added';
  }

  async discard(id: string): Promise<void> {
    this.items = this.items.filter((s) => s.id !== id);
    await this.save();
  }

  /** Sends pending sales oldest first. Stops at the first connection failure; rejected sales are kept for the cashier to see. */
  sync(send: Sender): Promise<SyncSummary> {
    if (this.running) return this.running;        // never two syncs at once
    this.running = this.run(send).finally(() => { this.running = null; });
    return this.running;
  }

  private async run(send: Sender): Promise<SyncSummary> {
    const summary: SyncSummary = { sent: 0, rejected: 0, stoppedOffline: false };
    for (const sale of [...this.items]) {
      if (sale.status !== 'pending') continue;
      let result: SendResult;
      try { result = await send(sale); } catch { result = { ok: false, offline: true, message: 'network' }; }
      if (result.ok) {
        this.items = this.items.filter((s) => s.id !== sale.id);
        summary.sent++;
      } else if (result.offline) {
        this.patch(sale.id, { attempts: sale.attempts + 1 });
        summary.stoppedOffline = true;
        await this.save();
        return summary;
      } else {
        this.patch(sale.id, { status: 'rejected', attempts: sale.attempts + 1, lastError: result.message });
        summary.rejected++;
      }
      await this.save();
    }
    return summary;
  }

  private patch(id: string, change: Partial<QueuedSale>) {
    this.items = this.items.map((s) => (s.id === id ? { ...s, ...change } : s));
  }
  private async save() {
    this.emit();
    await this.storage.setItem(this.key, JSON.stringify(this.items));
  }
  private emit() { this.listeners.forEach((l) => l()); }
}

export type SyncSummary = { sent: number; rejected: number; stoppedOffline: boolean };

function isSale(x: unknown): x is QueuedSale {
  const s = x as QueuedSale;
  return !!s && typeof s.id === 'string' && typeof s.customerId === 'string' && typeof s.amount === 'number'
    && typeof s.occurredAt === 'string' && (s.status === 'pending' || s.status === 'rejected');
}
