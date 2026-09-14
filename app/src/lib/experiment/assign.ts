/**
 * 実験の割付 — 設計: claude/coe-dataset-model.md §5-3・§11（D7）
 *
 * **純関数だけ**。DB に触らない（記録は service.ts）。
 *
 * 守っている線:
 *   ① **同じシード・同じ対象なら、同じ割付になる。** 乱数は使わない
 *      （`Math.random` を使うと、事前登録の意味が消える。後から再現できないものは検証できない）
 *   ② **割り付けてよい設計だけを割り付ける。** 閾値や既存の集団から比較群を取る設計
 *      （RDD・DID・ITS・マッチング…）で「無作為割付」を作ってはいけない。
 *      比較の作り方はデータ側で決まっているので、こちらで振ると嘘になる
 *   ③ **層の中で均す。** 層別変数があるなら、その中で群の大きさを揃える
 *   ④ クラスター単位の設計では、**同じクラスターの人は必ず同じ群**になる
 *
 * ★ この層は分野に依存しない。特定の行政分野の語彙を書かないこと（check:generic）。
 */
import { createHash } from "node:crypto";

/** 割り付けられる設計。これ以外は「割付」という操作自体が成立しない */
export const ASSIGNABLE_DESIGNS = ["rct", "cluster_rct", "stepped_wedge", "waitlist"] as const;
export type AssignableDesign = (typeof ASSIGNABLE_DESIGNS)[number];

/** クラスター（会場・地区）単位で割り付ける設計 */
export const CLUSTER_DESIGNS: ReadonlySet<string> = new Set(["cluster_rct", "stepped_wedge"]);

export function isAssignable(design: string): design is AssignableDesign {
  return (ASSIGNABLE_DESIGNS as readonly string[]).includes(design);
}

/** 割付の対象1人 */
export interface AssignUnit {
  sid: string;
  /** 層別変数（準識別子から作る。年齢階級・地区など） */
  stratum?: string | null;
  /** クラスターキー（会場・地区）。クラスター単位の設計では必須 */
  clusterKey?: string | null;
}

export interface AssignInput {
  design: string;
  /** 割付の種。**これを控えておけば同じ割付を再現できる** */
  seed: string;
  /** 群の名前。stepped_wedge では導入の波（wave1, wave2 …）になる */
  arms: string[];
  units: AssignUnit[];
}

export interface Assignment {
  sid: string;
  arm: string;
  stratum: string | null;
  clusterKey: string | null;
}

export type AssignResult =
  | {
      ok: true;
      assignments: Assignment[];
      seedDigest: string;
      /** 群ごとの人数（画面と記録に出す） */
      summary: Record<string, number>;
    }
  | { ok: false; reason: string };

/** シードの指紋。シードそのものは残さず、これだけを版に残す（設計 §5-3） */
export function seedDigestOf(seed: string): string {
  return createHash("sha256").update(seed, "utf8").digest("hex");
}

/**
 * 並び替えのための鍵。シードと対象の id から決まるので、**何度やっても同じ順**になる。
 * 乱数生成器を持たないのは、状態を持った瞬間に再現できなくなるから。
 */
function orderKey(seed: string, kind: "unit" | "stratum", id: string): string {
  // 区切りは**長さを前に置く**。単純に記号でつなぐと、
  // ("ab", "c") と ("a", "bc") が同じ文字列になり、別のものが同じ順番になりうる。
  // （制御文字を区切りに使う手もあるが、ソースに生のバイトが混じるので避ける）
  const payload = `${kind}:${seed.length}:${seed}:${id.length}:${id}`;
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

/**
 * 割り付ける。**割り付けてよい設計かどうかを最初に見る。**
 *
 * 戻り値が `ok:false` のときの `reason` は、そのまま担当者に見せる文にしてある
 * （「なぜ割り付けられないのか」が分からないと、無理に別の設計を選ぶことになる）。
 */
export function assign(input: AssignInput): AssignResult {
  const { design, seed, units } = input;

  if (!isAssignable(design)) {
    return {
      ok: false,
      reason:
        `この設計（${design}）では割付を作りません。` +
        `閾値や既に分かれている集団から比較群を取る設計なので、比較の作り方はデータ側で決まっています。` +
        `ここで群を振ると、実際の比較と食い違ったものが記録に残ります`,
    };
  }
  if (!seed || seed.length < 8) {
    return { ok: false, reason: "割付の種（seed）は8文字以上にしてください。後から同じ割付を再現するために使います" };
  }

  const arms = input.arms.map((a) => a.trim()).filter((a) => a.length > 0);
  if (arms.length < 2) return { ok: false, reason: "群は2つ以上必要です" };
  if (new Set(arms).size !== arms.length) return { ok: false, reason: "群の名前が重複しています" };
  if (arms.length > 10) return { ok: false, reason: "群は10までにしてください" };

  if (units.length === 0) return { ok: false, reason: "対象者がいません" };
  const sids = units.map((u) => u.sid);
  if (new Set(sids).size !== sids.length) return { ok: false, reason: "同じ対象者が2回入っています" };

  const byCluster = CLUSTER_DESIGNS.has(design);

  if (byCluster) {
    const missing = units.filter((u) => !u.clusterKey || u.clusterKey.trim() === "").length;
    if (missing > 0) {
      return {
        ok: false,
        reason:
          `クラスター単位の設計では、全員にクラスター（会場・地区など）が要ります（${missing}人に入っていません）。` +
          `同じクラスターの人が別の群に分かれると、介入が混ざって比較が壊れます`,
      };
    }
  }

  // ── 割付の単位を作る ────────────────────────────────
  // 個人単位なら1人=1単位、クラスター単位ならクラスター=1単位
  interface Unit {
    id: string;
    stratum: string | null;
    members: AssignUnit[];
  }
  const unitList: Unit[] = [];

  if (byCluster) {
    const map = new Map<string, AssignUnit[]>();
    for (const u of units) {
      const k = String(u.clusterKey);
      const arr = map.get(k);
      if (arr) arr.push(u);
      else map.set(k, [u]);
    }
    for (const [k, members] of Array.from(map.entries())) {
      // 同じクラスターの中で層が割れていると、どちらの層で均すのか決まらない
      const strata = new Set(members.map((mem: AssignUnit) => mem.stratum ?? null));
      if (strata.size > 1) {
        return {
          ok: false,
          reason: `クラスター「${k}」の中で層別変数が割れています。クラスターは層をまたげません`,
        };
      }
      unitList.push({ id: k, stratum: members[0]?.stratum ?? null, members });
    }
  } else {
    for (const u of units) unitList.push({ id: u.sid, stratum: u.stratum ?? null, members: [u] });
  }

  if (unitList.length < arms.length) {
    return {
      ok: false,
      reason: `割り付ける単位（${unitList.length}）が群の数（${arms.length}）より少ないため、空の群ができます`,
    };
  }

  // ── 層ごとに、決まった順に並べて順ぐりに配る ──────────
  // 「順ぐり」にするのは、層の中で群の大きさを揃えるため。
  // 1件ずつ独立にコインを投げると、小さい層で偏る
  const byStratum = new Map<string, Unit[]>();
  for (const u of unitList) {
    const k = u.stratum ?? "";
    const arr = byStratum.get(k);
    if (arr) arr.push(u);
    else byStratum.set(k, [u]);
  }

  const assignments: Assignment[] = [];
  const summary: Record<string, number> = Object.fromEntries(arms.map((a) => [a, 0]));

  // 層そのものも決まった順に回す（Map の挿入順に依存させない）
  for (const stratum of Array.from(byStratum.keys()).sort()) {
    const group = byStratum.get(stratum)!;
    group.sort((a, b) => {
      const ka = orderKey(seed, "unit", a.id);
      const kb = orderKey(seed, "unit", b.id);
      return ka < kb ? -1 : ka > kb ? 1 : a.id < b.id ? -1 : 1;
    });
    // 層ごとに開始位置をずらす。全部の層が同じ順で始まると、
    // 端数がいつも同じ群に寄る（層が多いほど効いてくる）
    const offset =
      parseInt(orderKey(seed, "stratum", stratum).slice(0, 8), 16) % arms.length;
    group.forEach((u, i) => {
      const arm = arms[(i + offset) % arms.length]!;
      for (const m of u.members) {
        assignments.push({
          sid: m.sid,
          arm,
          stratum: u.stratum,
          clusterKey: byCluster ? u.id : (m.clusterKey ?? null),
        });
        summary[arm] = (summary[arm] ?? 0) + 1;
      }
    });
  }

  // 出力の順も決めておく（記録の差分を見るときに並びで揺れないように）
  assignments.sort((a, b) => (a.sid < b.sid ? -1 : a.sid > b.sid ? 1 : 0));

  return { ok: true, assignments, seedDigest: seedDigestOf(seed), summary };
}

/**
 * 割付のあとに「この2人は同じ人だった」と分かったときの食い違いを拾う（設計 §13-11）。
 *
 * 別名で寄せるのは割付の後にも起きる。そのとき、
 *   ・同じ人が違う群に割り付けられていた → **その人の結果はどちらの群としても数えられない**
 *   ・同じ人が二重に数えられていた       → 群の人数が実際より多い
 * 割付のやり直しは事前登録と矛盾するのでしない。**見えるようにするのが仕事**。
 */
export interface MergeConflict {
  canonicalSid: string;
  mergedSids: string[];
  arms: string[];
  kind: "different_arms" | "double_counted";
}

export function detectMergeConflicts(
  assignments: Pick<Assignment, "sid" | "arm">[],
  /** 寄せた結果: sid → 代表 sid */
  canonicalOf: Map<string, string>,
): MergeConflict[] {
  const groups = new Map<string, { sids: string[]; arms: Set<string> }>();
  for (const a of assignments) {
    const canon = canonicalOf.get(a.sid) ?? a.sid;
    const g = groups.get(canon) ?? { sids: [], arms: new Set<string>() };
    g.sids.push(a.sid);
    g.arms.add(a.arm);
    groups.set(canon, g);
  }
  const out: MergeConflict[] = [];
  for (const [canon, g] of Array.from(groups.entries())) {
    if (g.sids.length < 2) continue;
    out.push({
      canonicalSid: canon,
      mergedSids: g.sids.sort(),
      arms: Array.from(g.arms).sort(),
      kind: g.arms.size > 1 ? "different_arms" : "double_counted",
    });
  }
  return out.sort((a, b) => (a.canonicalSid < b.canonicalSid ? -1 : 1));
}

/** 食い違いを、担当者に見せる1行にする */
export function describeMergeConflict(c: MergeConflict): string {
  return c.kind === "different_arms"
    ? `同じ人が違う群に割り付けられていました（${c.arms.join(" と ")}）。この人の結果は、どちらの群としても数えられません`
    : `同じ人が${c.mergedSids.length}人分として数えられていました（群は ${c.arms[0]}）。群の人数が実際より多くなっています`;
}
