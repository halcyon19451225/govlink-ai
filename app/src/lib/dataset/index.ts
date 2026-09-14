/**
 * lib/dataset — データセット（器）の純関数群
 *
 * 設計: claude/coe-dataset-model.md（第Ⅰ部）
 * 依存は node:crypto のみ。庁内の変換ツールと Coe の取込口が同じコードを使う
 * （2本持つと必ず乖離する。§8）。
 */
export * from "./types";
export * from "./keyTypes";
export * from "./sid";
export * from "./guard";
export * from "./dictionary";
export * from "./generalize";
export * from "./anonymity";
export * from "./observations";
export * from "./aggregateSchema";
