import "server-only";
import type { BridgeEvent, BridgeTask } from "@/lib/libera/payload";

/**
 * Libera ブリッジクライアント（S3 — Coe→Libera 片方向・共有鍵方式）
 *
 * 接続先: Libera 側 coeBridge Lambda の Function URL（env LIBERA_BRIDGE_URL）
 * 認可: 共有鍵ヘッダ x-bridge-key（env LIBERA_BRIDGE_KEY = Libera 側 COE_BRIDGE_KEY）
 * 未設定なら isBridgeConfigured() が false — 画面は案内を出し、送信ボタンを出さない。
 */

export function isBridgeConfigured(): boolean {
  return Boolean(process.env.LIBERA_BRIDGE_URL && process.env.LIBERA_BRIDGE_KEY);
}

interface BridgeResult {
  ok: boolean;
  upserted?: number;
  deleted?: number;
  rejected?: string[];
  error?: string;
}

async function callBridge(op: string, payload: Record<string, unknown>): Promise<BridgeResult> {
  const url = process.env.LIBERA_BRIDGE_URL;
  const key = process.env.LIBERA_BRIDGE_KEY;
  if (!url || !key) {
    return { ok: false, error: "LIBERA_BRIDGE_URL / LIBERA_BRIDGE_KEY が未設定です" };
  }
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-bridge-key": key },
      body: JSON.stringify({ op, ...payload }),
      // Lambda cold start を見込む
      signal: AbortSignal.timeout(25_000),
    });
    const json = (await res.json().catch(() => ({}))) as BridgeResult;
    if (!res.ok) {
      return { ok: false, error: json.error ?? `bridge ${res.status}` };
    }
    return { ...json, ok: json.ok !== false };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "bridge unreachable" };
  }
}

export async function bridgePing(): Promise<BridgeResult> {
  return callBridge("ping", {});
}

export async function bridgeUpsertEvents(events: BridgeEvent[]): Promise<BridgeResult> {
  // coeBridge は1回100件まで — 分割して送る
  let upserted = 0;
  const rejected: string[] = [];
  for (let i = 0; i < events.length; i += 100) {
    const r = await callBridge("upsertEvents", { events: events.slice(i, i + 100) });
    if (!r.ok) return { ok: false, upserted, ...(r.error ? { error: r.error } : {}) };
    upserted += r.upserted ?? 0;
    rejected.push(...(r.rejected ?? []));
  }
  return { ok: true, upserted, rejected };
}

export async function bridgeUpsertTasks(tasks: BridgeTask[]): Promise<BridgeResult> {
  let upserted = 0;
  const rejected: string[] = [];
  for (let i = 0; i < tasks.length; i += 100) {
    const r = await callBridge("upsertTasks", { tasks: tasks.slice(i, i + 100) });
    if (!r.ok) return { ok: false, upserted, ...(r.error ? { error: r.error } : {}) };
    upserted += r.upserted ?? 0;
    rejected.push(...(r.rejected ?? []));
  }
  return { ok: true, upserted, rejected };
}
