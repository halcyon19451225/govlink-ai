/**
 * iCalendar（RFC 5545）フィードの生成 — S1 D②段1（純粋・テスト可能）
 *
 * ── このファイルが正本 ─────────────────────────────────────
 * ICSのエスケープ・75オクテット折返し・VEVENT組み立てはここに集約する。
 * 配信ルート（/api/public/schedule-feed/[token]）と検査（check:schedule）はここだけを参照する。
 *
 * 設計上の選択:
 *  - 終日イベント（DTSTART;VALUE=DATE）で配信する。行政のタスク期限・チェックポイント期日は
 *    日付単位で管理されており、時刻を创作しない
 *  - UID は行のUUIDから決定的に作る（購読側の更新が差分として反映される）
 *  - 完了タスクも配信し続ける（消すと購読側で予定が消えて混乱する）。
 *    VEVENT に STATUS:COMPLETED は無い（VTODO専用）ため、SUMMARY の「✓」接頭辞
 *    （呼び出し側で付与）と X-COE-DONE:TRUE で完了を表す
 */

export interface IcsEventInput {
  /** UIDの元（例: task-<uuid> / checkpoint-<uuid>） */
  uid: string;
  /** YYYY-MM-DD（終日） */
  date: string;
  summary: string;
  description?: string;
  /** 完了済みなら STATUS:COMPLETED を付ける */
  completed?: boolean;
  /** 分類（カテゴリ表示に使うクライアントがある） */
  category?: string;
}

/** RFC 5545 3.3.11 TEXT のエスケープ（\ ; , 改行） */
export function icsEscape(v: string): string {
  return v
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/**
 * 行の折返し（RFC 5545 3.1: 1行75オクテット以内・継続行は先頭にスペース）。
 * 日本語（UTF-8で3バイト/文字）でもバイト数で数えて安全に折る。
 */
export function foldLine(line: string): string {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(line);
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let cur = "";
  let curBytes = 0;
  let first = true;
  for (const ch of line) {
    const chBytes = encoder.encode(ch).length;
    const limit = first ? 75 : 74; // 継続行は先頭スペースの1オクテット分を差し引く
    if (curBytes + chBytes > limit) {
      out.push(first ? cur : ` ${cur}`);
      first = false;
      cur = ch;
      curBytes = chBytes;
    } else {
      cur += ch;
      curBytes += chBytes;
    }
  }
  if (cur) out.push(first ? cur : ` ${cur}`);
  return out.join("\r\n");
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** YYYY-MM-DD → YYYYMMDD（不正な日付は null） */
export function icsDate(dateStr: string): string | null {
  if (!DATE_RE.test(dateStr)) return null;
  return dateStr.replace(/-/g, "");
}

function nextDay(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * カレンダー全体を組み立てる。
 * dtstamp は呼び出し側で固定して渡す（同一データ→同一出力の決定性を保ち、テスト可能にする）。
 */
export function buildIcsCalendar(
  calendarName: string,
  events: IcsEventInput[],
  dtstamp: string, // 例: 20260826T000000Z
): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Coe//Schedule Feed//JA",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    foldLine(`X-WR-CALNAME:${icsEscape(calendarName)}`),
    "X-WR-TIMEZONE:Asia/Tokyo",
  ];
  for (const ev of events) {
    const start = icsDate(ev.date);
    if (!start) continue; // 不正な日付の行は黙って落とさず呼び出し側で除外済みが前提。防御として飛ばす
    const end = icsDate(nextDay(ev.date));
    lines.push("BEGIN:VEVENT");
    lines.push(foldLine(`UID:${icsEscape(ev.uid)}@coe.schedule`));
    lines.push(`DTSTAMP:${dtstamp}`);
    lines.push(`DTSTART;VALUE=DATE:${start}`);
    lines.push(`DTEND;VALUE=DATE:${end}`);
    lines.push(foldLine(`SUMMARY:${icsEscape(ev.summary)}`));
    if (ev.description) lines.push(foldLine(`DESCRIPTION:${icsEscape(ev.description)}`));
    if (ev.category) lines.push(foldLine(`CATEGORIES:${icsEscape(ev.category)}`));
    if (ev.completed) lines.push("STATUS:CONFIRMED", "X-COE-DONE:TRUE");
    lines.push("TRANSP:TRANSPARENT");
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}
