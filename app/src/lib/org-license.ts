/**
 * 組織コード連携（Ordo ライセンス台帳との紐づけ）。
 *
 * Ordo 管理画面で発行された組織コード（COE-XXXX-XXXX）を自治体に紐づけると、
 * Ordo 側の契約（請求書払い・自治体契約）がこの自治体のプランとして適用される。
 * Stripe のセルフサーブ契約（subscriptions テーブル）と併存し、
 * プラン判定は「Stripe契約 → 組織コード契約」の順で強い方を採用する。
 *
 * 照会は Ordo /api/license?orgCode=...&product=Coe（orgCode モードは認証不要）。
 * 結果はプロセス内メモリに6時間キャッシュする（契約停止は最長6時間で反映）。
 */
import { queryOne } from "@/lib/db";

export type OrgLicense = {
  active: boolean;
  product: string | null;
  plan: string | null;
  orgName: string | null;
  orgId: string | null; // 親契約（Ordo Customer.id）。CUST:保存方式で使用
  codeType?: "member" | "org" | null;
  licenseUntil: string | null;
  suspended: boolean;
  reason?: string;
};

const ORDO_LICENSE_API =
  process.env.ORDO_LICENSE_API_URL ??
  "https://main.d1mi97peszaux0.amplifyapp.com/api/license";

/** Ordo に組織コードを照会する（キャッシュなし）。 */
export async function verifyOrgCode(code: string): Promise<OrgLicense | null> {
  const trimmed = code.trim().toUpperCase();
  if (!trimmed) return null;
  // code= は個人許諾コード（COEM-）・組織コード（COE-）の両対応（Ordo側で自動判別）
  const url = `${ORDO_LICENSE_API}?code=${encodeURIComponent(trimmed)}&product=Coe`;
  const res = await fetch(url, { cache: "no-store" });
  if (res.status === 404) {
    return {
      active: false,
      product: null,
      plan: null,
      orgName: null,
      orgId: null,
      licenseUntil: null,
      suspended: false,
      reason: "not_found",
    };
  }
  if (!res.ok) throw new Error(`Ordo license api error: ${res.status}`);
  return (await res.json()) as OrgLicense;
}

/**
 * 親契約ID（CUST:<id> 形式）で照会する（サーバー間・LICENSE_API_KEY 必須）。
 * 紐づけ時に個人コードではなく親契約IDを保存することで、
 * 個々のコードの再発行・失効が組織全体の紐づけに影響しないようにする。
 */
export async function verifyByCustomerId(customerId: string): Promise<OrgLicense | null> {
  const key = process.env.LICENSE_API_KEY;
  if (!key) {
    console.warn("LICENSE_API_KEY が未設定のため組織契約を照会できません");
    return null;
  }
  const url = `${ORDO_LICENSE_API}?customerId=${encodeURIComponent(customerId)}&product=Coe`;
  const res = await fetch(url, { cache: "no-store", headers: { "x-license-key": key } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Ordo license api error: ${res.status}`);
  return (await res.json()) as OrgLicense;
}

/** Ordo のプラン名を Coe のプランキーへ対応付ける。 */
export function mapOrdoPlanToCoe(
  plan: string | null,
): "free" | "light" | "standard" | "premium" {
  if (!plan) return "free";
  if (plan.includes("プレミアム") || plan.includes("個別見積") || plan.includes("デモ")) {
    return "premium";
  }
  if (plan.includes("スタンダード")) return "standard";
  if (plan.includes("ライト")) return "light";
  return "free";
}

// プロセス内キャッシュ（Lambda インスタンス単位）。TTL 6時間。
const cache = new Map<string, { at: number; plan: "free" | "light" | "standard" | "premium" | null }>();
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * 自治体の組織コード契約から適用プランを返す（未連携・無効なら null）。
 * 失敗時は古いキャッシュがあればそれを使う（Ordo 一時障害への耐性）。
 */
export async function getOrgPlan(
  municipalityId: string,
): Promise<"free" | "light" | "standard" | "premium" | null> {
  const hit = cache.get(municipalityId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.plan;

  const row = await queryOne<{ org_code: string | null }>(
    "SELECT org_code FROM municipalities WHERE id = $1",
    [municipalityId],
  );
  const orgCode = row?.org_code ?? null;
  if (!orgCode) {
    cache.set(municipalityId, { at: Date.now(), plan: null });
    return null;
  }
  try {
    // CUST:<id> = 親契約ID保存方式（推奨）。それ以外は旧方式（コード直接保存）
    const lic = orgCode.startsWith("CUST:")
      ? await verifyByCustomerId(orgCode.slice(5))
      : await verifyOrgCode(orgCode);
    const plan = lic?.active ? mapOrdoPlanToCoe(lic.plan) : null;
    cache.set(municipalityId, { at: Date.now(), plan });
    return plan;
  } catch (e) {
    console.warn("組織コード照会に失敗（キャッシュにフォールバック）:", e);
    return hit ? hit.plan : null;
  }
}

/** 紐づけ変更時にキャッシュを破棄する。 */
export function invalidateOrgPlanCache(municipalityId: string): void {
  cache.delete(municipalityId);
}
