"use client";

export default function BackButton() {
  return (
    <button
      onClick={() => history.back()}
      className="text-sm transition-colors duration-200 hover:text-white"
      style={{ color: "#94a3b8" }}
    >
      ← 戻る
    </button>
  );
}
