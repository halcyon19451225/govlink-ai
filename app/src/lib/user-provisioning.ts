/**
 * Ordo 台帳を正本とした利用者のプロビジョニング／同期。
 *
 * 組織管理者が Ordo の管理者ページで利用者を登録して招待すると、その人は
 * Ordo ID（Cognito）でログインできるようになる。しかし Coe 側には user_roles /
 * user_identities の行が無いので、認証は通るのに権限が無い＝弾かれる、という
 * 状態になっていた。ここで台帳を引いて行を作り、以後は台帳に追随させる。
 *
 * 【原則】
 * 1. 鍵は Cognito の sub のみ。メール照合は行わない（認可の穴になるため）。
 * 2. 自治体（テナント）は自動作成しない。Ordo の組織に対応する municipalities 行が
 *    まだ無いなら弾いてログに出す。テナントの新設は人の判断を通す。
 * 3. 権限の剥奪はしない。Ordo で組織管理者なら admin を保証するが、
 *    そうでない場合に Coe 側で付けられた role を下げることはしない。
 */
import { queryOne, transaction } from "@/lib/db";
import { resolveOrdoMember } from "@/lib/ordo-directory";

export type SyncOutcome =
  /** Ordo に到達できなかった。既存の判断を維持すべき（権限を消してはいけない） */
  | { status: "unreachable" }
  /** 台帳にいる・使ってよい。行を作成または更新した */
  | { status: "synced"; userRoleId: string; created: boolean }
  /** 台帳上、使わせてはいけない（失効・契約切れ・サービス対象外など） */
  | { status: "denied"; reason: string }
  /** 組織に対応する自治体行がまだ無い。人手での紐づけが必要 */
  | { status: "no_tenant"; orgName: string | null; orgCode: string | null };

/**
 * sub を Ordo 台帳と突き合わせ、user_roles / user_identities を作成・更新する。
 * 例外は投げない（ログインの妨げにしない）。判断は SyncOutcome で返す。
 */
export async function syncUserFromOrdo(sub: string): Promise<SyncOutcome> {
  const r = await resolveOrdoMember(sub, "Coe");
  if (!r) return { status: "unreachable" };

  if (!r.found || !r.allowed) {
    const reason = r.reason ?? "not_allowed";
    console.warn(`[provision] sub=${sub} は Ordo 台帳で許可されていません（reason=${reason}）`);
    return { status: "denied", reason };
  }

  const org = r.organization;
  const me = r.me;
  if (!org || !me) return { status: "denied", reason: "incomplete_payload" };

  try {
    // 自治体の特定。紐づけは「CUST:<組織ID>」が推奨形式、旧形式は組織コード直書き
    const muni = await queryOne<{ id: string }>(
      `SELECT id FROM municipalities
        WHERE org_code = $1 OR ($2::text IS NOT NULL AND org_code = $2)
        LIMIT 1`,
      [`CUST:${org.id}`, org.orgCode],
    );
    if (!muni) {
      console.warn(
        `[provision] Ordo 組織「${org.name ?? org.id}」(orgCode=${org.orgCode ?? "-"}) に対応する ` +
          `municipalities 行がありません。Coe 管理画面の組織コード連携で紐づけてください。sub=${sub}`,
      );
      return { status: "no_tenant", orgName: org.name ?? null, orgCode: org.orgCode ?? null };
    }

    const displayName = me.name ?? me.email ?? me.code;
    const department = me.department?.name ?? null;
    const email = me.email ?? "";

    return await transaction(async (client) => {
      // 既存の identity があればその user_roles を使う（自治体をまたいで動かさない）
      const existing = await client.query<{ id: string; role: string }>(
        `SELECT u.id, u.role
           FROM user_roles u
           JOIN user_identities i ON i.user_role_id = u.id
          WHERE i.cognito_sub = $1
          ORDER BY u.created_at
          LIMIT 1`,
        [sub],
      );

      let userRoleId: string;
      let created = false;

      if (existing.rows[0]) {
        userRoleId = existing.rows[0].id;
        // Ordo で組織管理者なら admin を保証する。そうでなくても降格はしない
        const nextRole = r.isOrgAdmin && existing.rows[0].role !== "admin" ? "admin" : existing.rows[0].role;
        await client.query(
          `UPDATE user_roles
              SET display_name = $2, department = $3, email = $4, role = $5
            WHERE id = $1`,
          [userRoleId, displayName, department, email, nextRole],
        );
      } else {
        // identity は無いが、旧方式で cognito_user_id に sub が入った行が残っている場合がある
        const ins = await client.query<{ id: string }>(
          `INSERT INTO user_roles (municipality_id, cognito_user_id, email, display_name, role, department)
                VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (municipality_id, cognito_user_id)
           DO UPDATE SET display_name = EXCLUDED.display_name,
                         department   = EXCLUDED.department,
                         email        = EXCLUDED.email,
                         role         = CASE WHEN EXCLUDED.role = 'admin' THEN 'admin' ELSE user_roles.role END
             RETURNING id`,
          [muni.id, sub, email, displayName, r.isOrgAdmin ? "admin" : "member", department],
        );
        const inserted = ins.rows[0];
        // ON CONFLICT DO UPDATE は必ず1行返す。返らないのは想定外なので握りつぶさない
        if (!inserted) throw new Error("user_roles の作成に失敗しました（行が返りませんでした）");
        userRoleId = inserted.id;
        created = true;
      }

      await client.query(
        `INSERT INTO user_identities (user_role_id, cognito_sub, provider)
              VALUES ($1, $2, 'cognito')
         ON CONFLICT (user_role_id, cognito_sub) DO NOTHING`,
        [userRoleId, sub],
      );

      if (created) {
        console.info(
          `[provision] sub=${sub}（${displayName}）を Ordo 台帳から受け入れました。` +
            `municipality=${muni.id} user_role=${userRoleId} admin=${!!r.isOrgAdmin}`,
        );
      }
      return { status: "synced" as const, userRoleId, created };
    });
  } catch (e) {
    // DB 側の一過性の失敗。「台帳にいない」とは区別して、権限判断を変えない
    console.warn("[provision] 同期に失敗しました（判断は保留）:", e);
    return { status: "unreachable" };
  }
}
