import { existsSync, readFileSync, writeFileSync } from "fs";
import type {
  BalanceHistoryEntry,
  ApyHistoryEntry,
  UserActionEntry,
  BlendPosition,
} from "./types";

const BASE_URL = "https://smoothie.capital/api";
const CACHE_FILE = "smoothie_cache.json";
const MAX_RETRIES = 3;
const KNOWN_CURRENCIES = new Set(["XLM", "USDC", "EURC"]);

// Module-level cache state
let cache: Record<string, unknown> = {};
let cacheEnabled = true;

export function loadSmoothieCache(): void {
  if (!existsSync(CACHE_FILE)) {
    cache = {};
    return;
  }
  try {
    cache = JSON.parse(readFileSync(CACHE_FILE, "utf-8"));
  } catch {
    console.warn("Could not read smoothie cache, starting fresh.");
    cache = {};
  }
}

export function saveSmoothieCache(): void {
  try {
    writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), "utf-8");
  } catch (error) {
    console.warn("Failed to save smoothie cache:", (error as Error).message);
  }
}

export function disableSmoothieCache(): void {
  cacheEnabled = false;
}

async function fetchWithRetry(url: string): Promise<unknown> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(url);
    if (res.ok) return res.json();

    if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
      const delay = 1000 * 2 ** (attempt - 1); // 1s, 2s, 4s
      console.warn(
        `  Smoothie API ${res.status} for ${url}, retrying in ${delay}ms...`,
      );
      await new Promise((r) => setTimeout(r, delay));
      continue;
    }

    const errorText = await res.text();
    throw new Error(
      `Smoothie API error (${res.status}) for ${url}: ${errorText}`,
    );
  }
  throw new Error(`Smoothie API failed after ${MAX_RETRIES} retries: ${url}`);
}

async function fetchJson<T>(url: string): Promise<T> {
  if (cacheEnabled && url in cache) {
    return cache[url] as T;
  }
  const data = await fetchWithRetry(url);
  cache[url] = data;
  return data as T;
}

/**
 * Discover active positions by fetching user actions and extracting
 * unique (pool, asset) combinations.
 */
export async function fetchBlendSnapshot(
  user: string,
): Promise<BlendPosition[]> {
  const data = await fetchJson<{ actions: UserActionEntry[] }>(
    `${BASE_URL}/user-actions?user=${user}&limit=1000`,
  );

  const seen = new Map<string, BlendPosition>();
  for (const action of data.actions) {
    if (!action.asset_symbol || !KNOWN_CURRENCIES.has(action.asset_symbol))
      continue;

    const key = `${action.pool_id}:${action.asset_address}`;
    if (!seen.has(key)) {
      seen.set(key, {
        poolId: action.pool_id,
        poolName: action.pool_name,
        assetAddress: action.asset_address,
        currency: action.asset_symbol as Currency,
      });
    }
  }

  return Array.from(seen.values());
}

export async function fetchBalanceHistory(
  user: string,
  asset: string,
  days: number,
): Promise<BalanceHistoryEntry[]> {
  const data = await fetchJson<{ history: BalanceHistoryEntry[] }>(
    `${BASE_URL}/balance-history?user=${user}&asset=${asset}&days=${days}`,
  );
  return data.history;
}

export async function fetchApyHistory(
  pool: string,
  asset: string,
  days: number,
): Promise<ApyHistoryEntry[]> {
  const data = await fetchJson<{ history: ApyHistoryEntry[] }>(
    `${BASE_URL}/apy-history?pool=${pool}&asset=${asset}&days=${days}`,
  );
  return data.history;
}

export async function fetchUserActions(
  user: string,
): Promise<UserActionEntry[]> {
  const data = await fetchJson<{ actions: UserActionEntry[] }>(
    `${BASE_URL}/user-actions?user=${user}&limit=1000`,
  );
  return data.actions;
}
