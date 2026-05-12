"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";

interface Feature { id: string; name: string; url: string; description: string }
interface ProjectResult { id: string; title: string; url: string }
interface SearchData { features: Feature[]; projects: ProjectResult[] }

const SearchIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="15" height="15"
    fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="11" cy="11" r="8"/>
    <path strokeLinecap="round" d="M21 21l-4.35-4.35"/>
  </svg>
);

export default function SearchBox() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [type, setType] = useState<"all" | "feature" | "policy">("all");
  const [results, setResults] = useState<SearchData | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 外クリックで閉じる
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const doSearch = useCallback(async (q: string, t: string) => {
    if (!q.trim()) { setResults(null); setOpen(false); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/search?q=${encodeURIComponent(q)}&type=${t}`);
      const json = (await res.json()) as { data: SearchData | null; error: string | null };
      if (json.data) { setResults(json.data); setOpen(true); }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setQuery(v);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => doSearch(v, type), 280);
  };

  const handleTypeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const t = e.target.value as "all" | "feature" | "policy";
    setType(t);
    if (query.trim()) doSearch(query, t);
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { setOpen(false); setQuery(""); }
  };

  const go = (url: string) => {
    setOpen(false);
    setQuery("");
    router.push(url);
  };

  const hasResults = results && (results.features.length > 0 || results.projects.length > 0);

  return (
    <div ref={containerRef} className="relative flex-1 max-w-xs" onKeyDown={handleKey}>
      {/* 入力エリア */}
      <div
        className="flex items-center rounded-xl border overflow-hidden transition-all duration-200"
        style={{
          background: "rgba(255,255,255,0.05)",
          borderColor: open ? "rgba(6,182,212,0.5)" : "var(--border)",
          backdropFilter: "blur(8px)",
        }}
      >
        <span className="pl-3 shrink-0" style={{ color: "var(--text-secondary)" }}>
          {loading ? (
            <svg className="animate-spin" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"
              width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" strokeOpacity="0.25"/>
              <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round"/>
            </svg>
          ) : <SearchIcon />}
        </span>

        <input
          type="text"
          value={query}
          onChange={handleChange}
          onFocus={() => { if (hasResults) setOpen(true); }}
          placeholder="機能・政策を検索..."
          className="flex-1 px-3 py-2 text-sm bg-transparent outline-none min-w-0"
          style={{ color: "var(--text-primary)" }}
        />

        <select
          value={type}
          onChange={handleTypeChange}
          className="text-xs border-l px-2 py-2 bg-transparent outline-none cursor-pointer shrink-0"
          style={{
            borderColor: "var(--border)",
            color: "var(--text-secondary)",
            background: "transparent",
          }}
        >
          <option value="all">すべて</option>
          <option value="feature">機能</option>
          <option value="policy">政策</option>
        </select>
      </div>

      {/* ドロップダウン */}
      {open && hasResults && (
        <div
          className="glass-dark absolute top-full left-0 right-0 mt-1.5 z-50 overflow-hidden shadow-2xl"
          style={{ maxHeight: "360px", overflowY: "auto" }}
        >
          {results.features.length > 0 && (
            <div>
              <p className="px-3 pt-3 pb-1 text-xs font-semibold uppercase tracking-wider"
                style={{ color: "var(--text-secondary)" }}>
                機能
              </p>
              {results.features.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => go(f.url)}
                  className="w-full flex flex-col items-start px-3 py-2.5 hover:bg-white/5 transition-colors duration-150 text-left"
                >
                  <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                    {f.name}
                  </span>
                  <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                    {f.description}
                  </span>
                </button>
              ))}
            </div>
          )}

          {results.projects.length > 0 && (
            <div className={results.features.length > 0 ? "border-t mt-1" : ""}
              style={{ borderColor: "var(--border)" }}>
              <p className="px-3 pt-3 pb-1 text-xs font-semibold uppercase tracking-wider"
                style={{ color: "var(--text-secondary)" }}>
                政策
              </p>
              {results.projects.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => go(p.url)}
                  className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-white/5 transition-colors duration-150 text-left"
                >
                  <span className="text-base">🏛️</span>
                  <span className="text-sm" style={{ color: "var(--text-primary)" }}>
                    {p.title}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 検索したが結果なし */}
      {open && results && !hasResults && query.trim() && (
        <div
          className="glass-dark absolute top-full left-0 right-0 mt-1.5 z-50 px-4 py-5 text-sm text-center"
          style={{ color: "var(--text-secondary)" }}
        >
          「{query}」に一致する結果がありません
        </div>
      )}
    </div>
  );
}
