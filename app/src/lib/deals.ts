import { distanceKm } from './geo.ts';
import type { LatLng } from './geo.ts';

export type Reward = {
  id: string; title: string; points_cost: number; value_fjd: number; active_from: string; active_to: string | null;
};
export type MerchantRow = {
  id: string; business_name: string; category: string; town: string; address: string | null;
  lat: number | null; lng: number | null; points_per_fjd: number; rewards: Reward[];
};
export type Deal = MerchantRow & { distanceKm: number | null; rewards: Reward[]; cheapest: Reward | null };

export function activeRewards(rewards: Reward[], now = new Date()): Reward[] {
  return rewards
    .filter((r) => new Date(r.active_from) <= now && (!r.active_to || new Date(r.active_to) > now))
    .sort((a, b) => a.points_cost - b.points_cost);
}

/** Merchants that have at least one live reward, nearest first (or A-Z when location is unknown). */
export function buildDeals(rows: MerchantRow[], here: LatLng | null, now = new Date()): Deal[] {
  const deals = rows
    .map((m) => {
      const rewards = activeRewards(m.rewards ?? [], now);
      const d = here && m.lat != null && m.lng != null ? distanceKm(here, { lat: m.lat, lng: m.lng }) : null;
      return { ...m, rewards, distanceKm: d, cheapest: rewards[0] ?? null };
    })
    .filter((m) => m.rewards.length > 0);
  return deals.sort((a, b) =>
    a.distanceKm !== null && b.distanceKm !== null ? a.distanceKm - b.distanceKm : a.business_name.localeCompare(b.business_name));
}

export const categoriesOf = (deals: Deal[]) => Array.from(new Set(deals.map((d) => d.category))).sort();
export const filterByCategory = (deals: Deal[], category: string | null) =>
  category ? deals.filter((d) => d.category === category) : deals;
