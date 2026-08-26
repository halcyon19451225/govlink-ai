export const dynamic = "force-dynamic";

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { loadManual } from "@/lib/manual/loader";
import { topicOf, CONVENTIONS_ID } from "@/lib/manual/topics";
import ManualView from "@/components/help/ManualView";

/**
 * マニュアルの全画面表示（M1）— /manual/[topicId]（印刷・リンク共有用）
 */
export default async function ManualPage({ params }: { params: { topicId: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  const manual = await loadManual(params.topicId);
  if (!manual) notFound();
  const topic = topicOf(params.topicId);

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-primary, #0b0e14)", padding: "32px 16px" }}>
      <div style={{ maxWidth: 860, margin: "0 auto" }}>
        <div className="flex items-center gap-3 text-xs mb-4" style={{ color: "var(--text-secondary, #94a3b8)" }}>
          <Link href="/manual" style={{ color: "#22d3ee" }}>← マニュアル目次</Link>
          {params.topicId !== CONVENTIONS_ID && (
            <Link href={`/manual/${CONVENTIONS_ID}`} style={{ color: "var(--text-secondary, #94a3b8)" }}>
              図の読み方
            </Link>
          )}
          {manual.meta?.updated && <span className="ml-auto">更新 {manual.meta.updated}</span>}
        </div>
        <ManualView body={manual.body} />
        {topic && (
          <p className="mt-8 text-xs" style={{ color: "var(--text-secondary, #64748b)" }}>
            対象画面: {topic.menuPath}
          </p>
        )}
      </div>
    </div>
  );
}
