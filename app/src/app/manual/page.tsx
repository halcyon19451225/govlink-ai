export const dynamic = "force-dynamic";

import Link from "next/link";
import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { HELP_TOPICS, SECTION_LABELS, CONVENTIONS_ID } from "@/lib/manual/topics";
import { manualExists } from "@/lib/manual/loader";

/**
 * マニュアル目次（M1）— /manual
 * 全メニューのマニュアルへの入口（自動生成）。未整備は「準備中」表示。
 */
export default async function ManualIndexPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  const sections = ["P", "D", "C", "A", "admin"] as const;

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-primary, #0b0e14)", padding: "32px 16px" }}>
      <div style={{ maxWidth: 860, margin: "0 auto" }}>
        <h1 className="text-2xl font-bold" style={{ color: "var(--text-primary, #e2e8f0)" }}>
          📖 Coe マニュアル
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--text-secondary, #94a3b8)" }}>
          各画面の「❓ ヘルプ」からも同じ内容を開けます。まずは{" "}
          <Link href={`/manual/${CONVENTIONS_ID}`} style={{ color: "#22d3ee" }}>
            図の読み方
          </Link>{" "}
          をどうぞ。
        </p>
        <div className="mt-6 space-y-6">
          {sections.map((sec) => {
            const topics = HELP_TOPICS.filter((t) => t.section === sec);
            if (topics.length === 0) return null;
            return (
              <div key={sec}>
                <h2 className="text-sm font-bold mb-2" style={{ color: "var(--text-secondary, #94a3b8)" }}>
                  {SECTION_LABELS[sec]}
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {topics.map((t) => {
                    const exists = manualExists(t.id);
                    return exists ? (
                      <Link
                        key={t.id}
                        href={`/manual/${t.id}`}
                        className="rounded-xl px-4 py-3 text-sm"
                        style={{
                          border: "1px solid var(--border, #1e293b)",
                          color: "var(--text-primary, #e2e8f0)",
                          textDecoration: "none",
                        }}
                      >
                        {t.label}
                      </Link>
                    ) : (
                      <div
                        key={t.id}
                        className="rounded-xl px-4 py-3 text-sm"
                        style={{ border: "1px dashed var(--border, #1e293b)", color: "var(--text-secondary, #64748b)" }}
                      >
                        {t.label} <span style={{ fontSize: 11 }}>（準備中）</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
