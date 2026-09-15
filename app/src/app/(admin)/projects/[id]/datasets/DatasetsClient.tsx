"use client";

/**
 * データセット管理（D2）— 箱と版の画面
 *
 * 設計: claude/coe-dataset-model.md §4・§12。
 * 「箱を作る → 版を上げる → 履歴から版を選んで詳細・ダウンロード」の3手で使えるようにし、
 * 迷いやすい所（箱と版の違い・列定義の役割・個票を直接上げられない理由）は画面内に説明を置く
 * （文言の正本は src/content/manual/datasets.md）。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { AttributeDefinition, ColumnSpec, DatasetKind, KeyTypeDefinition } from "@/lib/dataset/types";
import type { KeyNormalization, NormalizationStyle } from "@/lib/dataset/keyTypes";
import type { DatasetListItem, DatasetRow, DatasetVersionRow, TemplateRow } from "@/lib/dataset/service";

export interface DomainInfo {
  planType: string;
  label: string;
  reviewed: boolean;
}
export interface StyleInfo {
  style: NormalizationStyle;
  label: string;
  description: string;
  allowsZeroPad: boolean;
  example: string;
}

interface ProjectRow {
  id: string;
  title: string;
  plan_type: string | null;
}

type Api<T> = { data: T | null; error: string | null };

const card = { background: "var(--bg-secondary)", borderColor: "var(--border)" };
const inputClass =
  "w-full rounded-lg border px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 transition-colors";
const inputStyle = { background: "var(--bg-input)", borderColor: "var(--border)" };
const btnPrimary = "px-4 py-2 rounded-lg text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50";
const btnGhost = "px-3 py-1.5 rounded-lg text-sm border text-slate-300 hover:text-slate-100";

const KIND_LABEL: Record<DatasetKind, string> = { aggregate: "集計データ", individual: "個票データ" };
const ROLE_LABEL: Record<ColumnSpec["role"], string> = { dimension: "区分", time: "時点", measure: "数値" };
const TYPE_LABEL: Record<ColumnSpec["type"], string> = {
  text: "文字", int: "整数", numeric: "数値", fiscal_year: "年度", year: "年", month: "年月", date: "日付",
};
const STATUS_LABEL: Record<DatasetVersionRow["status"], string> = { pending: "未検証", validated: "有効", rejected: "無効" };
const STATUS_COLOR: Record<DatasetVersionRow["status"], string> = { pending: "#f59e0b", validated: "#10b981", rejected: "#ef4444" };
const VIA_LABEL: Record<string, string> = {
  ui: "画面", bulk: "一括", gap_analysis: "ギャップ分析", dialogue: "AI対話（担当者が承認）", evaluation: "評価", auto_tasks: "自動集計", migration: "移行",
};
const ROLE_DESC: Record<string, { label: string; hint: string }> = {
  quasi_identifier: { label: "準識別子", hint: "組合せで個人が絞られる属性。k 検定の対象で、必要に応じて自動で粗くなります" },
  sensitive: { label: "機微", hint: "セル内で値が偏ると露見するため、偏ったセルでは伏せられます" },
  exposure: { label: "曝露", hint: "施策・事業を受けたかどうか" },
  outcome: { label: "アウトカム", hint: "施策の結果として見たい値" },
  neutral: { label: "その他", hint: "識別にも結果にも使わない補助的な情報" },
};
const ORIGIN_LABEL: Record<string, string> = { core: "共通", domain: "分野", tenant: "自団体" };
const VALUE_TYPE_LABEL: Record<string, string> = {
  code: "区分", band: "帯", int: "整数", numeric: "数値", bool: "有無", month: "年月", fiscal_year: "年度",
};
const GRAN_LABEL: Record<string, string> = { day: "日", month: "月", fiscal_year: "年度", static: "変わらない" };

const REASON_LABEL: Record<string, string> = {
  missing: "値が空", invalid_number: "数値でない", invalid_time: "時点として読めない", invalid_code: "許容値に無い", looks_like_my_number: "個人番号の形式",
};

function fmtDate(s: string | null | undefined): string {
  if (!s) return "—";
  return s.slice(0, 10);
}
function fmtDateTime(s: string | null | undefined): string {
  if (!s) return "—";
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}
function today(): string {
  return new Date().toISOString().slice(0, 10);
}
/** 値の語彙が未設定（自治体が地区の区分などを登録していない）なら、まだ選べない */
function isUsable(d: AttributeDefinition): boolean {
  if (!d.cloudAllowed) return false;
  if ((d.valueType === "code" || d.valueType === "band") && Object.keys(d.codes ?? {}).length === 0) return false;
  return true;
}

// ── 説明ブロック（迷わせないための掲載。文言は manual と同趣旨） ──
function Intro() {
  return (
    <div className="rounded-2xl border p-5 text-sm text-slate-300 leading-relaxed" style={card}>
      <p>
        データは<strong className="text-slate-100">箱</strong>（何のデータか）と
        <strong className="text-slate-100">版</strong>（いつ時点のものを、いつ上げたか）で管理します。
        最初に箱を作り、箱に版を上げます。同じ箱に新しい版を上げても古い版は消えず、指標管理はこの版から値を計算します。
      </p>
      <ul className="mt-2 space-y-1 text-xs text-slate-400">
        <li><span className="text-slate-200">集計データ</span> … 表形式の集計値（ニーズ調査の集計・事業状況報告など）。列定義に沿って行を取り込みます。</li>
        <li><span className="text-slate-200">個票データ</span> … 一人ひとりの観測。氏名や個人番号はクラウドに上げず、庁内の変換ツールで仮名化・帯域化したものだけを取り込みます（変換ツールは今後の段階で提供）。</li>
      </ul>
    </div>
  );
}

export default function DatasetsClient({
  project,
  initialDatasets,
  templates,
  dictionary,
  domain,
  keyTypes,
  normalizationStyles,
}: {
  project: ProjectRow;
  initialDatasets: DatasetListItem[];
  templates: TemplateRow[];
  dictionary: AttributeDefinition[];
  domain: DomainInfo | null;
  keyTypes: KeyTypeDefinition[];
  normalizationStyles: StyleInfo[];
}) {
  const [datasets, setDatasets] = useState<DatasetListItem[]>(initialDatasets);
  const [dict, setDict] = useState<AttributeDefinition[]>(dictionary);
  const [keys, setKeys] = useState<KeyTypeDefinition[]>(keyTypes);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showDict, setShowDict] = useState(false);
  const [showKeys, setShowKeys] = useState(false);
  const base = `/api/admin/projects/${project.id}/datasets`;

  const reloadList = useCallback(async () => {
    const res = await fetch(base);
    const json = (await res.json()) as Api<{ datasets: DatasetListItem[] }>;
    if (json.data) setDatasets(json.data.datasets);
  }, [base]);

  const reloadDict = useCallback(async () => {
    const res = await fetch(`${base}/dictionary`);
    const json = (await res.json()) as Api<{ attributes: AttributeDefinition[] }>;
    if (json.data) setDict(json.data.attributes);
  }, [base]);

  const reloadKeys = useCallback(async () => {
    const res = await fetch(`${base}/key-types`);
    const json = (await res.json()) as Api<{ keyTypes: KeyTypeDefinition[] }>;
    if (json.data) setKeys(json.data.keyTypes);
  }, [base]);

  const selected = datasets.find((d) => d.id === selectedId) ?? null;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-100">{project.title}</h1>
          <p className="text-sm text-slate-500 mt-1">データセット管理 — 箱と版</p>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          <button className={btnGhost} style={{ borderColor: "var(--border)" }} onClick={() => setShowDict(true)}>属性辞書</button>
          <button className={btnGhost} style={{ borderColor: "var(--border)" }} onClick={() => setShowKeys(true)}>庁内キーの語彙</button>
          {/*
            個票の変換は庁内の端末で行う。辞書・キー種別・粗化のはしご・k/ℓ を
            人が二重に入力すると必ずずれるので、Coe の決めごとを書き出して持っていく。
            鍵はこのファイルに入らない（鍵は庁内にしかない）
          */}
          <a
            className={btnGhost}
            style={{ borderColor: "var(--border)" }}
            href={`${base}/config-pack`}
            title="庁内の変換ツールに読み込ませる設定ファイル。鍵は入りません"
          >
            設定を書き出す
          </a>
          {!selected && <button className={btnPrimary} onClick={() => setShowCreate(true)}>＋ 箱を作る</button>}
        </div>
      </div>

      {!selected && <Intro />}

      {!selected ? (
        <BoxList datasets={datasets} onOpen={(id) => setSelectedId(id)} />
      ) : (
        <BoxDetail
          base={base}
          item={selected}
          dictionary={dict}
          onBack={() => { setSelectedId(null); void reloadList(); }}
          onChanged={reloadList}
        />
      )}

      {showCreate && (
        <CreateBoxModal
          base={base}
          templates={templates}
          dictionary={dict}
          domain={domain}
          onClose={() => setShowCreate(false)}
          onCreated={async (created) => { setShowCreate(false); await reloadList(); setSelectedId(created.id); }}
          onOpenDictionary={() => { setShowCreate(false); setShowDict(true); }}
        />
      )}
      {showDict && (
        <DictionaryModal base={base} dictionary={dict} domain={domain} onClose={() => setShowDict(false)} onChanged={reloadDict} />
      )}
      {showKeys && (
        <KeyTypesModal base={base} keyTypes={keys} styles={normalizationStyles} onClose={() => setShowKeys(false)} onChanged={reloadKeys} />
      )}
    </div>
  );
}

// ── 箱の一覧 ──────────────────────────────────────────────
function BoxList({ datasets, onOpen }: { datasets: DatasetListItem[]; onOpen: (id: string) => void }) {
  if (datasets.length === 0) {
    return (
      <div className="rounded-2xl border p-8 text-center text-sm text-slate-400" style={card}>
        まだ箱がありません。「＋ 箱を作る」から、テンプレートを選ぶか列定義を作って始めてください。
      </div>
    );
  }
  return (
    <div className="rounded-2xl border overflow-hidden" style={card}>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-slate-400" style={{ background: "var(--bg-input)" }}>
            <th className="px-4 py-2">箱</th>
            <th className="px-4 py-2">種別</th>
            <th className="px-4 py-2">最新の基準日</th>
            <th className="px-4 py-2">版数</th>
            <th className="px-4 py-2">最新の状態</th>
            <th className="px-4 py-2" />
          </tr>
        </thead>
        <tbody>
          {datasets.map((d) => (
            <tr key={d.id} className="border-t hover:bg-white/5 cursor-pointer" style={{ borderColor: "var(--border)" }} onClick={() => onOpen(d.id)}>
              <td className="px-4 py-3">
                <div className="text-slate-100 font-medium">{d.name}</div>
                {d.description && <div className="text-xs text-slate-500 truncate max-w-md">{d.description}</div>}
              </td>
              <td className="px-4 py-3"><KindBadge kind={d.kind} /></td>
              <td className="px-4 py-3 text-slate-300">{fmtDate(d.latest_as_of)}</td>
              <td className="px-4 py-3 text-slate-300">{d.version_count}</td>
              <td className="px-4 py-3">{d.latest_status ? <StatusBadge status={d.latest_status} /> : <span className="text-xs text-slate-500">版なし</span>}</td>
              <td className="px-4 py-3 text-right text-xs text-indigo-400">開く →</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function KindBadge({ kind }: { kind: DatasetKind }) {
  return (
    <span className="text-xs px-2 py-0.5 rounded border" style={{ borderColor: "var(--border)", color: kind === "individual" ? "#f0abfc" : "#7dd3fc", background: "var(--bg-input)" }}>
      {KIND_LABEL[kind]}
    </span>
  );
}
function StatusBadge({ status }: { status: DatasetVersionRow["status"] }) {
  return <span className="text-xs px-2 py-0.5 rounded" style={{ color: STATUS_COLOR[status], background: "var(--bg-input)" }}>{STATUS_LABEL[status]}</span>;
}

// ── 箱の詳細（版の履歴） ────────────────────────────────────
function BoxDetail({
  base, item, dictionary, onBack, onChanged,
}: {
  base: string;
  item: DatasetListItem;
  dictionary: AttributeDefinition[];
  onBack: () => void;
  onChanged: () => Promise<void>;
}) {
  const [dataset, setDataset] = useState<DatasetRow>(item);
  const [versions, setVersions] = useState<DatasetVersionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showUpload, setShowUpload] = useState(false);
  const [showAcq, setShowAcq] = useState(false);
  const [versionId, setVersionId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`${base}/${item.id}`);
    const json = (await res.json()) as Api<{ dataset: DatasetRow; versions: DatasetVersionRow[] }>;
    if (json.data) {
      setDataset(json.data.dataset);
      setVersions(json.data.versions);
    }
    setLoading(false);
  }, [base, item.id]);

  useEffect(() => { void load(); }, [load]);

  const schema = dataset.schema;
  const isAgg = dataset.kind === "aggregate";
  const columns = isAgg ? (schema as ColumnSpec[]) : [];
  const attrKeys = !isAgg ? ((schema as { attr_keys: string[] }).attr_keys ?? []) : [];
  const acq = (dataset.acquisition ?? {}) as Record<string, string>;

  const reject = async (v: DatasetVersionRow) => {
    const note = window.prompt("この版を無効にします（削除はされず、一覧から隠れます）。理由を残す場合は入力してください。", "");
    if (note === null) return;
    const res = await fetch(`${base}/${item.id}/versions/${v.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "rejected", note }),
    });
    const json = (await res.json()) as Api<DatasetVersionRow>;
    if (json.error) window.alert(json.error);
    await load();
    await onChanged();
  };

  return (
    <div className="space-y-5">
      <button className="text-sm text-indigo-400 hover:text-indigo-300" onClick={onBack}>← 箱の一覧へ</button>

      <div className="rounded-2xl border p-5 space-y-3" style={card}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-slate-100">{dataset.name}</h2>
              <KindBadge kind={dataset.kind} />
            </div>
            {dataset.description && <p className="text-sm text-slate-400 mt-1">{dataset.description}</p>}
            {dataset.template_id && <p className="text-xs text-slate-500 mt-1">テンプレート: {dataset.template_id}</p>}
          </div>
          <div className="flex gap-2 flex-shrink-0">
            <button className={btnGhost} style={{ borderColor: "var(--border)" }} onClick={() => setShowAcq(true)}>取得方法を記録</button>
            {isAgg && <button className={btnPrimary} onClick={() => setShowUpload(true)}>版を上げる</button>}
          </div>
        </div>

        {isAgg ? (
          <div>
            <div className="text-xs text-slate-500 mb-1">列定義（CSV のヘッダ名と一致させてください。余分な列は捨てられ、足りない列は拒否されます）</div>
            <div className="flex flex-wrap gap-1.5">
              {columns.map((c) => (
                <span key={c.name} className="text-xs px-2 py-0.5 rounded border" style={{ borderColor: "var(--border)", background: "var(--bg-input)", color: c.role === "measure" ? "#a7f3d0" : c.role === "time" ? "#fde68a" : "#cbd5e1" }}>
                  {c.name} <span className="text-slate-500">· {ROLE_LABEL[c.role]}/{TYPE_LABEL[c.type]}{c.required === false ? "・任意" : ""}</span>
                </span>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="text-xs text-slate-500">この箱に入る属性（属性辞書のキー）</div>
            <div className="flex flex-wrap gap-1.5">
              {attrKeys.map((k) => {
                const d = dictionary.find((x) => x.key === k);
                return <span key={k} className="text-xs px-2 py-0.5 rounded border" style={{ borderColor: "var(--border)", background: "var(--bg-input)", color: "#e9d5ff" }} title={d?.description}>{d?.label ?? k} <span className="text-slate-500">{k}</span></span>;
              })}
            </div>
            <div className="rounded-lg border p-3 text-xs text-slate-300 leading-relaxed" style={{ borderColor: "var(--border)", background: "var(--bg-input)" }}>
              <strong className="text-slate-100">個票データの版は、この画面から直接は上げられません。</strong>
              氏名・住所・生年月日・個人番号をクラウドに上げないため、庁内 PC の変換ツールが宛名番号などから仮名 ID を作り、年齢や地区を帯域にまとめ、
              10 人未満の組合せを抑制してから、その出力（zip）だけを取り込みます。仮名 ID は自治体ごとの鍵で計算するので対応表を持たず、
              Coe には鍵の識別子だけを登録します。変換ツールと取込機能は今後の段階（D5）で提供します。
            </div>
          </div>
        )}

        <div className="rounded-lg border p-3" style={{ borderColor: "var(--border)" }}>
          <div className="text-xs text-slate-500 mb-1">取得方法（任意）— どのシステムのどの帳票を、どんな条件で出したか</div>
          {Object.keys(acq).length === 0 ? (
            <div className="text-xs text-slate-500">未記録</div>
          ) : (
            <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1 text-xs">
              {[["system", "システム"], ["report_name", "帳票"], ["euc_condition", "抽出条件"], ["owner", "担当"], ["note", "備考"]].map(([k, label]) =>
                acq[k!] ? (<><dt key={`${k}-k`} className="text-slate-500">{label}</dt><dd key={`${k}-v`} className="text-slate-200 whitespace-pre-wrap">{acq[k!]}</dd></>) : null,
              )}
            </dl>
          )}
        </div>
      </div>

      <div className="rounded-2xl border overflow-hidden" style={card}>
        <div className="px-4 py-3 text-sm font-medium text-slate-300 border-b" style={{ borderColor: "var(--border)" }}>
          版の履歴 <span className="text-xs text-slate-500 ml-2">基準日の新しい順。無効にした版も履歴には残ります</span>
        </div>
        {loading ? (
          <div className="p-6 text-sm text-slate-500">読み込み中…</div>
        ) : versions.length === 0 ? (
          <div className="p-6 text-sm text-slate-500">まだ版がありません。{isAgg ? "「版を上げる」から基準日と CSV を指定してください。" : ""}</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-400" style={{ background: "var(--bg-input)" }}>
                <th className="px-4 py-2">基準日</th>
                <th className="px-4 py-2">状態</th>
                <th className="px-4 py-2">件数</th>
                <th className="px-4 py-2">ファイル</th>
                <th className="px-4 py-2">上げた日時</th>
                <th className="px-4 py-2">経路</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {versions.map((v) => (
                <tr key={v.id} className="border-t" style={{ borderColor: "var(--border)", opacity: v.status === "rejected" ? 0.6 : 1 }}>
                  <td className="px-4 py-2 text-slate-100">{fmtDate(v.as_of)}</td>
                  <td className="px-4 py-2"><StatusBadge status={v.status} /></td>
                  <td className="px-4 py-2 text-slate-300">{v.row_count ?? "—"}</td>
                  <td className="px-4 py-2 text-slate-300 truncate max-w-[14rem]" title={v.file_name ?? ""}>{v.file_name ?? "—"}</td>
                  <td className="px-4 py-2 text-slate-400 text-xs">{fmtDateTime(v.uploaded_at)}</td>
                  <td className="px-4 py-2 text-slate-400 text-xs">{VIA_LABEL[v.uploaded_via] ?? v.uploaded_via}</td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    <button className="text-xs text-indigo-400 hover:text-indigo-300 mr-3" onClick={() => setVersionId(v.id)}>詳細</button>
                    {v.status !== "rejected" && <button className="text-xs text-slate-500 hover:text-red-400" onClick={() => void reject(v)}>無効にする</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showUpload && (
        <UploadVersionModal base={base} dataset={dataset} onClose={() => setShowUpload(false)} onDone={async () => { setShowUpload(false); await load(); await onChanged(); }} />
      )}
      {showAcq && (
        <AcquisitionModal base={base} dataset={dataset} onClose={() => setShowAcq(false)} onSaved={async () => { setShowAcq(false); await load(); await onChanged(); }} />
      )}
      {versionId && (
        <VersionDetailModal base={base} datasetId={dataset.id} versionId={versionId} columns={columns} onClose={() => setVersionId(null)} />
      )}
    </div>
  );
}

// ── モーダルの枠 ──────────────────────────────────────────
function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className={`rounded-2xl border w-full ${wide ? "max-w-4xl" : "max-w-2xl"} max-h-[90vh] overflow-y-auto`} style={card} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b" style={{ borderColor: "var(--border)" }}>
          <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
          <button className="text-slate-500 hover:text-slate-300 text-lg leading-none" onClick={onClose}>×</button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

// ── 箱を作る ──────────────────────────────────────────────
function CreateBoxModal({
  base, templates, dictionary, domain, onClose, onCreated, onOpenDictionary,
}: {
  base: string;
  templates: TemplateRow[];
  dictionary: AttributeDefinition[];
  domain: DomainInfo | null;
  onClose: () => void;
  onCreated: (d: DatasetRow) => Promise<void>;
  onOpenDictionary: () => void;
}) {
  const [kind, setKind] = useState<DatasetKind>("aggregate");
  const [templateId, setTemplateId] = useState<string>("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [granularity, setGranularity] = useState<"day" | "month" | "fiscal_year">("fiscal_year");
  const [columns, setColumns] = useState<ColumnSpec[]>([{ name: "", role: "dimension", type: "text" }]);
  const [attrKeys, setAttrKeys] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const kindTemplates = useMemo(() => templates.filter((t) => t.kind === kind), [templates, kind]);

  const applyTemplate = (id: string) => {
    setTemplateId(id);
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    setName(t.display_name);
    setDescription(t.description);
    setGranularity((t.time_granularity as "day" | "month" | "fiscal_year") || "fiscal_year");
    if (t.kind === "aggregate" && t.column_schema) setColumns(t.column_schema.map((c) => ({ ...c })));
    if (t.kind === "individual" && t.attr_keys) setAttrKeys([...t.attr_keys]);
  };

  const submit = async () => {
    setSaving(true);
    setError(null);
    const body = {
      kind, name, description, templateId: templateId || null, timeGranularity: granularity,
      ...(kind === "aggregate" ? { columnSchema: columns.filter((c) => c.name.trim()) } : { attrKeys }),
    };
    const res = await fetch(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = (await res.json()) as Api<DatasetRow>;
    setSaving(false);
    if (!res.ok || !json.data) {
      setError(json.error ?? "作成に失敗しました");
      return;
    }
    await onCreated(json.data);
  };

  return (
    <Modal title="箱を作る" onClose={onClose} wide>
      <div className="space-y-4">
        <div>
          <div className="text-xs text-slate-500 mb-1">種別</div>
          <div className="flex gap-2">
            {(["aggregate", "individual"] as DatasetKind[]).map((k) => (
              <button key={k} className={`px-3 py-1.5 rounded-lg text-sm border ${kind === k ? "border-indigo-500 text-slate-100" : "text-slate-400"}`} style={{ borderColor: kind === k ? undefined : "var(--border)" }} onClick={() => { setKind(k); setTemplateId(""); }}>
                {KIND_LABEL[k]}
              </button>
            ))}
          </div>
          <p className="text-xs text-slate-500 mt-1">
            {kind === "aggregate"
              ? "表形式の集計値。CSV を列定義に沿って行として取り込み、指標管理が計算に使います。"
              : "一人ひとりの観測。箱（どの属性が入るか）だけをここで定義し、版は庁内の変換ツールの出力から取り込みます（D5 で提供）。"}
          </p>
        </div>

        <div>
          <div className="text-xs text-slate-500 mb-1">テンプレート（選ぶと名称と列定義の初期値が入ります）</div>
          <select className={inputClass} style={inputStyle} value={templateId} onChange={(e) => applyTemplate(e.target.value)}>
            <option value="">テンプレートを使わない</option>
            {kindTemplates.map((t) => <option key={t.id} value={t.id}>{t.display_name}</option>)}
          </select>
        </div>

        <div className="grid md:grid-cols-2 gap-3">
          <div>
            <div className="text-xs text-slate-500 mb-1">名称 *</div>
            <input className={inputClass} style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="例: 事業状況報告（年度別）" />
          </div>
          <div>
            <div className="text-xs text-slate-500 mb-1">時点の粒度</div>
            <select className={inputClass} style={inputStyle} value={granularity} onChange={(e) => setGranularity(e.target.value as "day" | "month" | "fiscal_year")}>
              <option value="fiscal_year">年度</option>
              <option value="month">月</option>
              <option value="day">日</option>
            </select>
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500 mb-1">説明</div>
          <textarea className={inputClass} style={inputStyle} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>

        {kind === "aggregate" ? (
          <div>
            <div className="text-xs text-slate-500 mb-1">
              列定義 * — 各列に役割を付けます。<span className="text-slate-300">区分</span>＝地域名・設問など集計の切り口、
              <span className="text-slate-300">時点</span>＝年度・年月（1列まで。無ければ版の基準日を使います）、
              <span className="text-slate-300">数値</span>＝集計値（1列以上）
            </div>
            <div className="space-y-2">
              {columns.map((c, i) => (
                <div key={i} className="grid grid-cols-[1fr_7rem_7rem_4rem_2rem] gap-2 items-center">
                  <input className={inputClass} style={inputStyle} value={c.name} placeholder="CSV のヘッダ名" onChange={(e) => setColumns(columns.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                  <select className={inputClass} style={inputStyle} value={c.role} onChange={(e) => setColumns(columns.map((x, j) => (j === i ? { ...x, role: e.target.value as ColumnSpec["role"], type: e.target.value === "measure" ? "numeric" : e.target.value === "time" ? "fiscal_year" : "text" } : x)))}>
                    {(Object.keys(ROLE_LABEL) as ColumnSpec["role"][]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                  </select>
                  <select className={inputClass} style={inputStyle} value={c.type} onChange={(e) => setColumns(columns.map((x, j) => (j === i ? { ...x, type: e.target.value as ColumnSpec["type"] } : x)))}>
                    {(c.role === "measure" ? ["int", "numeric"] : c.role === "time" ? ["fiscal_year", "year", "month", "date"] : ["text"]).map((t) => <option key={t} value={t}>{TYPE_LABEL[t as ColumnSpec["type"]]}</option>)}
                  </select>
                  <label className="text-xs text-slate-400 flex items-center gap-1">
                    <input type="checkbox" checked={c.required !== false} onChange={(e) => setColumns(columns.map((x, j) => { if (j !== i) return x; const rest: ColumnSpec = { name: x.name, role: x.role, type: x.type, ...(x.codes ? { codes: x.codes } : {}) }; return e.target.checked ? rest : { ...rest, required: false }; }))} />必須
                  </label>
                  <button className="text-slate-500 hover:text-red-400" onClick={() => setColumns(columns.filter((_, j) => j !== i))}>×</button>
                </div>
              ))}
            </div>
            <button className="mt-2 text-xs text-indigo-400" onClick={() => setColumns([...columns, { name: "", role: "measure", type: "numeric" }])}>＋ 列を足す</button>
          </div>
        ) : (
          <div>
            <div className="text-xs text-slate-500 mb-1">
              この箱に入る属性 *（属性辞書から選ぶ。自由記述の項目はありません）
              {domain ? <>　この計画の分野: <span className="text-slate-300">{domain.label}</span>{!domain.reviewed && "（初期セット）"}</> : "　この計画には分野が設定されていないため、共通の属性と自団体で登録した属性が出ます"}
            </div>
            <div className="grid md:grid-cols-2 gap-1.5 max-h-64 overflow-y-auto pr-1">
              {dictionary.filter((d) => d.cloudAllowed).map((d) => {
                const usable = isUsable(d);
                return (
                  <label key={d.key} className={`flex items-start gap-2 text-xs rounded-lg border p-2 ${usable ? "text-slate-300" : "text-slate-500"}`} style={{ borderColor: "var(--border)", opacity: usable ? 1 : 0.6 }} title={d.description}>
                    <input type="checkbox" className="mt-0.5" disabled={!usable} checked={attrKeys.includes(d.key)} onChange={(e) => setAttrKeys(e.target.checked ? [...attrKeys, d.key] : attrKeys.filter((k) => k !== d.key))} />
                    <span>
                      <span className={usable ? "text-slate-100" : ""}>{d.label}</span>{" "}
                      <span className="text-slate-500">{d.key}</span>{" "}
                      <span className="px-1 rounded" style={{ background: "var(--bg-input)" }}>{ORIGIN_LABEL[d.origin ?? "core"]}</span>
                      <br />
                      <span className="text-slate-500">{usable ? d.description : "値の区分が未登録です。属性辞書で自団体の区分を登録すると選べます"}</span>
                    </span>
                  </label>
                );
              })}
            </div>
            <button className="mt-2 text-xs text-indigo-400" onClick={onOpenDictionary}>属性辞書を開く（自団体の属性を足す）→</button>
          </div>
        )}

        {error && <div className="text-sm text-red-400">{error}</div>}
        <div className="flex justify-end gap-2">
          <button className={btnGhost} style={{ borderColor: "var(--border)" }} onClick={onClose}>キャンセル</button>
          <button className={btnPrimary} disabled={saving} onClick={() => void submit()}>{saving ? "作成中…" : "箱を作る"}</button>
        </div>
      </div>
    </Modal>
  );
}

// ── 版を上げる ────────────────────────────────────────────
function UploadVersionModal({ base, dataset, onClose, onDone }: { base: string; dataset: DatasetRow; onClose: () => void; onDone: () => Promise<void> }) {
  const [asOf, setAsOf] = useState(today());
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ version: DatasetVersionRow; accepted: number; encoding: string } | null>(null);

  const submit = async () => {
    if (!file) { setError("CSV ファイルを選んでください"); return; }
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.append("as_of", asOf);
    fd.append("file", file);
    if (note) fd.append("note", note);
    const res = await fetch(`${base}/${dataset.id}/versions`, { method: "POST", body: fd });
    const json = (await res.json()) as Api<{ version: DatasetVersionRow; accepted: number; encoding: string }>;
    setBusy(false);
    if (!res.ok || !json.data) { setError(json.error ?? "取り込みに失敗しました"); return; }
    setResult(json.data);
  };

  const columns = dataset.schema as ColumnSpec[];
  return (
    <Modal title={`版を上げる — ${dataset.name}`} onClose={onClose}>
      {!result ? (
        <div className="space-y-4">
          <div className="text-xs text-slate-400 leading-relaxed">
            <strong className="text-slate-200">基準日</strong>は「このデータがいつ時点のものか」です（年度なら年度末など）。上げた日時ではありません。
            CSV のヘッダは列定義（{columns.map((c) => c.name).join("・")}）と一致させてください。文字コードは UTF-8 / Shift_JIS のどちらでも読めます。
            1行でも検証に失敗した場合、その版は「無効」として記録され、行は取り込まれません（位置と理由を表示します）。
          </div>
          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <div className="text-xs text-slate-500 mb-1">基準日 *</div>
              <input type="date" className={inputClass} style={inputStyle} value={asOf} onChange={(e) => setAsOf(e.target.value)} />
            </div>
            <div>
              <div className="text-xs text-slate-500 mb-1">CSV ファイル *（5 MB・50,000 行まで）</div>
              <input type="file" accept=".csv,text/csv" className="text-sm text-slate-300" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500 mb-1">この版の補足（任意）</div>
            <input className={inputClass} style={inputStyle} value={note} onChange={(e) => setNote(e.target.value)} placeholder="例: 速報値。確定後に上げ直す" />
          </div>
          {error && <div className="text-sm text-red-400">{error}</div>}
          <div className="flex justify-end gap-2">
            <button className={btnGhost} style={{ borderColor: "var(--border)" }} onClick={onClose}>キャンセル</button>
            <button className={btnPrimary} disabled={busy} onClick={() => void submit()}>{busy ? "取り込み中…" : "取り込む"}</button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {result.version.status === "validated" ? (
            <div className="text-sm text-emerald-400">取り込みました。{result.accepted} 行を版（基準日 {fmtDate(result.version.as_of)}）として保存しました（文字コード: {result.encoding}）。</div>
          ) : (
            <div className="text-sm text-red-400">検証に失敗したため、この版は「無効」として記録しました。ファイルを直して上げ直してください。</div>
          )}
          <RejectReasons reasons={result.version.reject_reasons} />
          <div className="flex justify-end"><button className={btnPrimary} onClick={() => void onDone()}>閉じる</button></div>
        </div>
      )}
    </Modal>
  );
}

function RejectReasons({ reasons }: { reasons: unknown }) {
  if (!reasons || typeof reasons !== "object") return null;
  const r = reasons as {
    missing_columns?: string[]; my_number_like?: number; row_errors?: number;
    row_error_samples?: Array<{ row: number; column: string; reason: string }>; malformed_rows?: number;
  };
  const items: React.ReactNode[] = [];
  if (r.missing_columns?.length) items.push(<li key="mc">列定義にある列が CSV にありません: <span className="text-slate-100">{r.missing_columns.join("・")}</span></li>);
  if (r.my_number_like) items.push(<li key="mn">個人番号の形式に当てはまる値が {r.my_number_like} 件ありました。<strong>この列は持ち込めません。</strong>列を外して上げ直してください（ファイルは保存していません）</li>);
  if (r.row_errors) items.push(<li key="re">行の検証エラー {r.row_errors} 件（先頭 {Math.min(20, r.row_error_samples?.length ?? 0)} 件）: {r.row_error_samples?.map((e) => `${e.row}行目「${e.column}」${REASON_LABEL[e.reason] ?? e.reason}`).join(" / ")}</li>);
  if (r.malformed_rows) items.push(<li key="mf">列数がヘッダと合わない行が {r.malformed_rows} 行ありました（取り込みから除外）</li>);
  if (items.length === 0) return null;
  return <ul className="text-xs text-slate-300 space-y-1 list-disc pl-5">{items}</ul>;
}

// ── 取得方法 ──────────────────────────────────────────────
function AcquisitionModal({ base, dataset, onClose, onSaved }: { base: string; dataset: DatasetRow; onClose: () => void; onSaved: () => Promise<void> }) {
  const init = (dataset.acquisition ?? {}) as Record<string, string>;
  const [form, setForm] = useState({ system: init.system ?? "", report_name: init.report_name ?? "", euc_condition: init.euc_condition ?? "", owner: init.owner ?? "", note: init.note ?? "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    const res = await fetch(`${base}/${dataset.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ acquisition: form }) });
    const json = (await res.json()) as Api<DatasetRow>;
    setBusy(false);
    if (!res.ok) { setError(json.error ?? "保存に失敗しました"); return; }
    await onSaved();
  };
  return (
    <Modal title="取得方法を記録する" onClose={onClose}>
      <div className="space-y-3">
        <p className="text-xs text-slate-400">次に同じデータを出す人が迷わないための記録です。どのシステムのどの帳票を、どんな条件で出したかを残します。</p>
        {([["system", "システム", "例: ○○業務システム（標準準拠）"], ["report_name", "帳票・EUC の名称", "例: 事業状況報告 月報"], ["euc_condition", "抽出条件", "例: 対象年度＝当年度、対象者全員"], ["owner", "担当", "例: ○○係 ○○"], ["note", "備考", ""]] as const).map(([k, label, ph]) => (
          <div key={k}>
            <div className="text-xs text-slate-500 mb-1">{label}</div>
            {k === "euc_condition" || k === "note" ? (
              <textarea className={inputClass} style={inputStyle} rows={2} value={form[k]} placeholder={ph} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
            ) : (
              <input className={inputClass} style={inputStyle} value={form[k]} placeholder={ph} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
            )}
          </div>
        ))}
        {error && <div className="text-sm text-red-400">{error}</div>}
        <div className="flex justify-end gap-2">
          <button className={btnGhost} style={{ borderColor: "var(--border)" }} onClick={onClose}>キャンセル</button>
          <button className={btnPrimary} disabled={busy} onClick={() => void save()}>{busy ? "保存中…" : "保存"}</button>
        </div>
      </div>
    </Modal>
  );
}

// ── 版の詳細 ──────────────────────────────────────────────
function VersionDetailModal({ base, datasetId, versionId, columns, onClose }: { base: string; datasetId: string; versionId: string; columns: ColumnSpec[]; onClose: () => void }) {
  const [data, setData] = useState<{
    version: DatasetVersionRow;
    rows: Array<{ row_no: number; dims: Record<string, string>; period: string; measures: Record<string, number> }>;
    activity: Array<{ actor: string | null; via: string; action: string; summary: unknown; at: string }>;
    indicator_values: unknown[];
  } | null>(null);
  useEffect(() => {
    void (async () => {
      const res = await fetch(`${base}/${datasetId}/versions/${versionId}`);
      const json = (await res.json()) as Api<NonNullable<typeof data>>;
      setData(json.data);
    })();
  }, [base, datasetId, versionId]);

  const dimCols = columns.filter((c) => c.role === "dimension").map((c) => c.name);
  const measureCols = columns.filter((c) => c.role === "measure").map((c) => c.name);
  const ACTION_LABEL: Record<string, string> = { ingest: "取り込み", reject: "無効化／拒否", download: "ダウンロード", create: "作成", update: "更新" };

  return (
    <Modal title="版の詳細" onClose={onClose} wide>
      {!data ? (
        <div className="text-sm text-slate-500">読み込み中…</div>
      ) : (
        <div className="space-y-4 text-sm">
          <dl className="grid grid-cols-[8rem_1fr] gap-y-1 text-xs">
            <dt className="text-slate-500">基準日</dt><dd className="text-slate-100">{fmtDate(data.version.as_of)}</dd>
            <dt className="text-slate-500">状態</dt><dd><StatusBadge status={data.version.status} /></dd>
            <dt className="text-slate-500">件数</dt><dd className="text-slate-200">{data.version.row_count ?? "—"}</dd>
            <dt className="text-slate-500">ファイル</dt><dd className="text-slate-200">{data.version.file_name ?? "—"}（{data.version.file_size_bytes ?? 0} バイト）</dd>
            <dt className="text-slate-500">上げた日時</dt><dd className="text-slate-200">{fmtDateTime(data.version.uploaded_at)}</dd>
            <dt className="text-slate-500">経路</dt><dd className="text-slate-200">{VIA_LABEL[data.version.uploaded_via] ?? data.version.uploaded_via}</dd>
            {data.version.note && (<><dt className="text-slate-500">補足</dt><dd className="text-slate-200">{data.version.note}</dd></>)}
            <dt className="text-slate-500">この版を使う指標値</dt><dd className="text-slate-500">{data.indicator_values.length === 0 ? "なし（指標管理は次の段階で提供）" : data.indicator_values.length}</dd>
          </dl>
          <RejectReasons reasons={data.version.reject_reasons} />
          {data.rows.length > 0 && (
            <div>
              <div className="text-xs text-slate-500 mb-1">取り込んだ行（先頭 {data.rows.length} 行）</div>
              <div className="overflow-x-auto rounded-lg border" style={{ borderColor: "var(--border)" }}>
                <table className="text-xs w-full">
                  <thead><tr style={{ background: "var(--bg-input)" }}><th className="px-2 py-1 text-left text-slate-400">#</th>{dimCols.map((c) => <th key={c} className="px-2 py-1 text-left text-slate-400">{c}</th>)}<th className="px-2 py-1 text-left text-slate-400">時点</th>{measureCols.map((c) => <th key={c} className="px-2 py-1 text-right text-slate-400">{c}</th>)}</tr></thead>
                  <tbody>
                    {data.rows.map((r) => (
                      <tr key={r.row_no} className="border-t" style={{ borderColor: "var(--border)" }}>
                        <td className="px-2 py-1 text-slate-500">{r.row_no}</td>
                        {dimCols.map((c) => <td key={c} className="px-2 py-1 text-slate-200">{r.dims[c] ?? ""}</td>)}
                        <td className="px-2 py-1 text-slate-300">{r.period}</td>
                        {measureCols.map((c) => <td key={c} className="px-2 py-1 text-right text-slate-200">{r.measures[c] ?? ""}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <div>
            <div className="text-xs text-slate-500 mb-1">操作履歴（誰が・どの経路で。AI の操作も担当者名で同じ形で残ります）</div>
            <ul className="text-xs text-slate-300 space-y-0.5">
              {data.activity.map((a, i) => <li key={i}>{fmtDateTime(a.at)} — {ACTION_LABEL[a.action] ?? a.action} <span className="text-slate-500">（{VIA_LABEL[a.via] ?? a.via}）</span></li>)}
            </ul>
          </div>
          <div className="flex justify-end gap-2">
            {data.version.storage_path && (
              <a className={btnGhost} style={{ borderColor: "var(--border)" }} href={`${base}/${datasetId}/versions/${versionId}/download`}>この版をダウンロード</a>
            )}
            <button className={btnPrimary} onClick={onClose}>閉じる</button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ── 属性辞書 ──────────────────────────────────────────────
// 3層（共通／分野／自団体）をそのまま見せる。分野パックが無い計画でも、
// 共通の属性＋自団体で登録した属性で個票を扱えるようにするための画面。
function DictionaryModal({
  base, dictionary, domain, onClose, onChanged,
}: {
  base: string;
  dictionary: AttributeDefinition[];
  domain: DomainInfo | null;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const groups: Array<[string, AttributeDefinition[]]> = [
    ["core", dictionary.filter((d) => (d.origin ?? "core") === "core")],
    ["domain", dictionary.filter((d) => d.origin === "domain")],
    ["tenant", dictionary.filter((d) => d.origin === "tenant")],
  ];

  return (
    <Modal title="属性辞書" onClose={onClose} wide>
      <div className="space-y-4 text-sm">
        <p className="text-xs text-slate-400 leading-relaxed">
          個票データで扱える「何の情報か」の語彙です。ここに無い情報は取り込めません（自由記述の項目はありません）。
          辞書は3層でできています。<span className="text-slate-200">共通</span>はどの分野の計画でも使える属性、
          <span className="text-slate-200">分野</span>はこの計画の分野（{domain ? domain.label : "未設定"}）でだけ出る属性、
          <span className="text-slate-200">自団体</span>はこの自治体で登録した属性です。
          地区の区分のように値の語彙が自治体ごとに違うものは、自団体で登録して初めて使えます。
        </p>
        {groups.map(([origin, items]) => (
          <div key={origin}>
            <div className="text-xs text-slate-500 mb-1">
              {ORIGIN_LABEL[origin]}（{items.length}）
              {origin === "domain" && domain && !domain.reviewed && <span className="ml-2 text-amber-400">初期セット・要精査</span>}
            </div>
            {items.length === 0 ? (
              <div className="text-xs text-slate-600">なし</div>
            ) : (
              <div className="rounded-lg border overflow-hidden" style={{ borderColor: "var(--border)" }}>
                <table className="w-full text-xs">
                  <thead><tr style={{ background: "var(--bg-input)" }}>
                    <th className="px-2 py-1 text-left text-slate-400">属性</th>
                    <th className="px-2 py-1 text-left text-slate-400">型</th>
                    <th className="px-2 py-1 text-left text-slate-400">役割</th>
                    <th className="px-2 py-1 text-left text-slate-400">時点</th>
                    <th className="px-2 py-1 text-left text-slate-400">値</th>
                  </tr></thead>
                  <tbody>
                    {items.map((d) => (
                      <tr key={d.key} className="border-t" style={{ borderColor: "var(--border)" }}>
                        <td className="px-2 py-1">
                          <span className="text-slate-100">{d.label}</span> <span className="text-slate-500">{d.key}</span>
                          {!d.cloudAllowed && <span className="ml-1 text-amber-400">庁内限定</span>}
                          <div className="text-slate-500">{d.description}</div>
                        </td>
                        <td className="px-2 py-1 text-slate-300">{VALUE_TYPE_LABEL[d.valueType] ?? d.valueType}</td>
                        <td className="px-2 py-1 text-slate-300" title={ROLE_DESC[d.role]?.hint}>{ROLE_DESC[d.role]?.label ?? d.role}</td>
                        <td className="px-2 py-1 text-slate-300">{GRAN_LABEL[d.timeGranularity] ?? d.timeGranularity}</td>
                        <td className="px-2 py-1 text-slate-400">
                          {Object.keys(d.codes ?? {}).length > 0
                            ? Object.values(d.codes ?? {}).slice(0, 6).join("／") + (Object.keys(d.codes ?? {}).length > 6 ? " …" : "")
                            : d.localCodes ? <span className="text-amber-400">自団体で登録が必要</span> : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}
        <div className="flex justify-end gap-2">
          <button className={btnGhost} style={{ borderColor: "var(--border)" }} onClick={onClose}>閉じる</button>
          <button className={btnPrimary} onClick={() => setAdding(true)}>＋ 自団体の属性を登録</button>
        </div>
      </div>
      {adding && (
        <AddAttributeModal base={base} dictionary={dictionary} onClose={() => setAdding(false)} onSaved={async () => { setAdding(false); await onChanged(); }} />
      )}
    </Modal>
  );
}

function AddAttributeModal({
  base, dictionary, onClose, onSaved,
}: {
  base: string;
  dictionary: AttributeDefinition[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const localNeeded = dictionary.filter((d) => d.localCodes && Object.keys(d.codes ?? {}).length === 0);
  const [key, setKey] = useState(localNeeded[0]?.key ?? "");
  const [label, setLabel] = useState(localNeeded[0]?.label ?? "");
  const [description, setDescription] = useState("");
  const [valueType, setValueType] = useState<AttributeDefinition["valueType"]>("code");
  const [role, setRole] = useState<AttributeDefinition["role"]>("quasi_identifier");
  const [gran, setGran] = useState<AttributeDefinition["timeGranularity"]>("fiscal_year");
  const [codesText, setCodesText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const existing = dictionary.find((d) => d.key === key.trim());
  const needsCodes = valueType === "code" || valueType === "band";

  const applyExisting = (k: string) => {
    const d = dictionary.find((x) => x.key === k);
    setKey(k);
    if (d) {
      setLabel(d.label);
      setValueType(d.valueType);
      setRole(d.role);
      setGran(d.timeGranularity);
    }
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    const codes: Record<string, string> = {};
    for (const line of codesText.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      const [c, ...rest] = t.split(/[,\t=]/);
      if (!c) continue;
      codes[c.trim()] = (rest.join(",").trim() || c.trim());
    }
    const res = await fetch(`${base}/dictionary`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: key.trim(), label, description, valueType, role, timeGranularity: gran, ...(needsCodes ? { codes } : {}) }),
    });
    const json = (await res.json()) as Api<AttributeDefinition>;
    setBusy(false);
    if (!res.ok || !json.data) { setError(json.error ?? "登録に失敗しました"); return; }
    await onSaved();
  };

  return (
    <Modal title="自団体の属性を登録" onClose={onClose}>
      <div className="space-y-3">
        <p className="text-xs text-slate-400 leading-relaxed">
          共通・分野の辞書に無い情報を扱うとき、または地区のように値の区分が自治体ごとに違うときに登録します。
          既にあるキーと同じキーにすると、<span className="text-slate-200">値の区分だけを自団体のものに置き換え</span>ます。
        </p>
        {localNeeded.length > 0 && (
          <div className="rounded-lg border p-2 text-xs" style={{ borderColor: "var(--border)", background: "var(--bg-input)" }}>
            <div className="text-amber-400 mb-1">値の区分の登録を待っている属性があります</div>
            {localNeeded.map((d) => (
              <button key={d.key} className="text-indigo-400 mr-3" onClick={() => applyExisting(d.key)}>{d.label}（{d.key}）を登録</button>
            ))}
          </div>
        )}
        <div className="grid md:grid-cols-2 gap-3">
          <div>
            <div className="text-xs text-slate-500 mb-1">キー *（分類.名前）</div>
            <input className={inputClass} style={inputStyle} value={key} onChange={(e) => setKey(e.target.value)} placeholder="例: demo.area / local.support_group" />
            {existing && <div className="text-xs text-amber-400 mt-1">既存の「{existing.label}」を自団体の定義で上書きします</div>}
          </div>
          <div>
            <div className="text-xs text-slate-500 mb-1">表示名 *</div>
            <input className={inputClass} style={inputStyle} value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500 mb-1">説明</div>
          <input className={inputClass} style={inputStyle} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="grid md:grid-cols-3 gap-3">
          <div>
            <div className="text-xs text-slate-500 mb-1">型</div>
            <select className={inputClass} style={inputStyle} value={valueType} onChange={(e) => setValueType(e.target.value as AttributeDefinition["valueType"])}>
              {Object.entries(VALUE_TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div>
            <div className="text-xs text-slate-500 mb-1">役割</div>
            <select className={inputClass} style={inputStyle} value={role} onChange={(e) => setRole(e.target.value as AttributeDefinition["role"])}>
              {Object.entries(ROLE_DESC).map(([v, d]) => <option key={v} value={v}>{d.label}</option>)}
            </select>
            <div className="text-xs text-slate-500 mt-1">{ROLE_DESC[role]?.hint}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500 mb-1">時点の粒度</div>
            <select className={inputClass} style={inputStyle} value={gran} onChange={(e) => setGran(e.target.value as AttributeDefinition["timeGranularity"])}>
              {Object.entries(GRAN_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
        </div>
        {needsCodes && (
          <div>
            <div className="text-xs text-slate-500 mb-1">取りうる値 *（1行に「コード,表示名」。コードは英数字）</div>
            <textarea className={inputClass} style={inputStyle} rows={5} value={codesText} onChange={(e) => setCodesText(e.target.value)}
              placeholder={"area01,中央地区\narea02,東部地区\narea03,西部地区"} />
          </div>
        )}
        {error && <div className="text-sm text-red-400">{error}</div>}
        <div className="flex justify-end gap-2">
          <button className={btnGhost} style={{ borderColor: "var(--border)" }} onClick={onClose}>キャンセル</button>
          <button className={btnPrimary} disabled={busy} onClick={() => void save()}>{busy ? "登録中…" : "登録"}</button>
        </div>
      </div>
    </Modal>
  );
}

// ── 庁内キーの語彙 ────────────────────────────────────────
// どの業務システムのどの番号を仮名化の入力にするかは分野・自治体で違うので、
// Coe は正規化の「型」だけを持ち、種別は自治体が登録する。
function KeyTypesModal({
  base, keyTypes, styles, onClose, onChanged,
}: {
  base: string;
  keyTypes: KeyTypeDefinition[];
  styles: StyleInfo[];
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  const [style, setStyle] = useState<NormalizationStyle>("digits");
  const [zeroPad, setZeroPad] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const styleInfo = styles.find((s) => s.style === style);

  const save = async () => {
    setBusy(true);
    setError(null);
    const normalization: KeyNormalization = { style, ...(zeroPad ? { zeroPad: Number(zeroPad) } : {}) };
    const res = await fetch(`${base}/key-types`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, label, description, normalization }),
    });
    const json = (await res.json()) as Api<KeyTypeDefinition>;
    setBusy(false);
    if (!res.ok || !json.data) { setError(json.error ?? "登録に失敗しました"); return; }
    setAdding(false);
    setCode(""); setLabel(""); setDescription(""); setZeroPad("");
    await onChanged();
  };

  return (
    <Modal title="庁内キーの語彙" onClose={onClose} wide>
      <div className="space-y-4 text-sm">
        <p className="text-xs text-slate-400 leading-relaxed">
          個票データの仮名 ID を作るときの入力になる「庁内の番号」の一覧です。どの業務システムのどの番号を使うかは
          自治体と分野によって違うので、Coe が決め打ちせず、ここに登録します。
          <span className="text-slate-200">宛名番号</span>のように業務をまたいで同じ人を指す番号を主キーにすると、箱をまたいだ突合が確実になります。
          出力できない帳票は、その業務の番号を登録して橋渡しします。
          <span className="text-amber-400">個人番号（マイナンバー）は登録できません</span>（値としても機械的に拒否します）。
          コードは仮名 ID の計算に入るため、<span className="text-slate-200">登録後は変えられません</span>。
        </p>
        <div className="rounded-lg border overflow-hidden" style={{ borderColor: "var(--border)" }}>
          <table className="w-full text-xs">
            <thead><tr style={{ background: "var(--bg-input)" }}>
              <th className="px-2 py-1 text-left text-slate-400">コード</th>
              <th className="px-2 py-1 text-left text-slate-400">名称</th>
              <th className="px-2 py-1 text-left text-slate-400">正規化</th>
              <th className="px-2 py-1 text-left text-slate-400">出どころ</th>
            </tr></thead>
            <tbody>
              {keyTypes.map((k) => (
                <tr key={k.code} className="border-t" style={{ borderColor: "var(--border)" }}>
                  <td className="px-2 py-1 text-slate-300">{k.code}{k.isPrimary && <span className="ml-1 text-emerald-400">主</span>}</td>
                  <td className="px-2 py-1"><span className="text-slate-100">{k.label}</span><div className="text-slate-500">{k.description}</div></td>
                  <td className="px-2 py-1 text-slate-300">
                    {styles.find((s) => s.style === k.normalization.style)?.label ?? k.normalization.style}
                    {k.normalization.zeroPad ? `・${k.normalization.zeroPad}桁` : ""}
                  </td>
                  <td className="px-2 py-1 text-slate-400">{k.municipalityId ? "自団体" : "共通"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {adding ? (
          <div className="rounded-lg border p-3 space-y-3" style={{ borderColor: "var(--border)" }}>
            <div className="grid md:grid-cols-2 gap-3">
              <div>
                <div className="text-xs text-slate-500 mb-1">コード *（英小文字。あとで変えられません）</div>
                <input className={inputClass} style={inputStyle} value={code} onChange={(e) => setCode(e.target.value)} placeholder="例: shikaku01" />
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-1">名称 *</div>
                <input className={inputClass} style={inputStyle} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="例: ○○業務システムの整理番号" />
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500 mb-1">説明（どの業務システムのどの番号か）</div>
              <input className={inputClass} style={inputStyle} value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div className="grid md:grid-cols-2 gap-3">
              <div>
                <div className="text-xs text-slate-500 mb-1">正規化の型</div>
                <select className={inputClass} style={inputStyle} value={style} onChange={(e) => setStyle(e.target.value as NormalizationStyle)}>
                  {styles.map((s) => <option key={s.style} value={s.style}>{s.label}</option>)}
                </select>
                <div className="text-xs text-slate-500 mt-1">{styleInfo?.description}（{styleInfo?.example}）</div>
              </div>
              {styleInfo?.allowsZeroPad && (
                <div>
                  <div className="text-xs text-slate-500 mb-1">桁数をそろえる（任意）</div>
                  <input className={inputClass} style={inputStyle} value={zeroPad} onChange={(e) => setZeroPad(e.target.value.replace(/[^0-9]/g, ""))} placeholder="例: 10" />
                  <div className="text-xs text-slate-500 mt-1">帳票によって先頭ゼロの有無が違う番号は、ここで桁をそろえると同じ人として扱えます</div>
                </div>
              )}
            </div>
            {error && <div className="text-sm text-red-400">{error}</div>}
            <div className="flex justify-end gap-2">
              <button className={btnGhost} style={{ borderColor: "var(--border)" }} onClick={() => setAdding(false)}>やめる</button>
              <button className={btnPrimary} disabled={busy} onClick={() => void save()}>{busy ? "登録中…" : "登録"}</button>
            </div>
          </div>
        ) : (
          <div className="flex justify-end gap-2">
            <button className={btnGhost} style={{ borderColor: "var(--border)" }} onClick={onClose}>閉じる</button>
            <button className={btnPrimary} onClick={() => setAdding(true)}>＋ キー種別を登録</button>
          </div>
        )}
      </div>
    </Modal>
  );
}
