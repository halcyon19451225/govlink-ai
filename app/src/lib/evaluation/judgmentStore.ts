/**
 * 図E1の判定・処遇を program_evaluations（migration 060）へ入れるときの検証と導出。
 *
 * 原則: **画面が送ってきた report_no / route / 標準処遇を信用しない**。
 * 保存するのは4問の回答（judgment）と処遇の選択で、報告書No.・ルート・標準処遇は
 * ここで `judge()` から機械的に導く。判定保留は report_no = NULL。
 *
 * comply or explain: 処遇が標準処遇と異なる（treatment_choice='modified'）なら
 * rationale_required = true。理由（rationale）が無いまま承認へ進めない検査は
 * PATCH 側（[evalId]/route.ts）で行う。
 */

import { z } from "zod";
import {
  judge,
  normalizeJudgment,
  partialPath,
  treatmentDiffers,
  type ReflectRoute,
  type ReportNo,
  type StoredFiscalEffect,
  type StoredJudgment,
} from "@/lib/evaluation/judgment";

const q = {
  q1: z.enum(["met", "not_met"]),
  q2: z.enum(["approaching", "not_approaching"]).optional().nullable(),
  q3: z.enum(["attributable", "not_attributable"]).optional().nullable(),
  q4a: z.enum(["reproducible", "unknown", "not_reproducible"]).optional().nullable(),
  q4b: z.enum(["efficient", "inefficient"]).optional().nullable(),
};

export const storedJudgmentSchema = z.object({
  ...q,
  rationale: z.record(z.string(), z.string().max(4000)).optional(),
  evidence: z.any().optional(),
});

export const storedFiscalEffectSchema = z.object({
  pathways: z
    .array(
      z.object({
        pathway_key: z.string().max(40),
        label: z.string().max(100).nullish(),
        annual: z.number().nullish(),
        cumulative: z.number().nullish(),
        basis: z.string().max(500).nullish(),
      }),
    )
    .max(12),
  effect_total: z.number().nullable(),
  cost_total: z.number().nullable(),
  rate: z.number().nullable(),
  mark: z.enum(["J", "K"]).nullable(),
  note: z.string().max(500),
});

/** POST /evaluations の本文に足す判定まわり */
export const judgmentBodySchema = z.object({
  judgment: storedJudgmentSchema.optional().nullable(),
  comparison_grade: z.enum(["A", "B", "C", "D"]).optional().nullable(),
  fiscal_effect: storedFiscalEffectSchema.optional().nullable(),
});

/** 処遇（工程7）。standard=標準処遇どおり／modified=異なる処遇（理由必須）／none=処遇しない */
export const treatmentBodySchema = z.object({
  treatment_choice: z.enum(["standard", "modified", "none"]).optional().nullable(),
  decided_treatment: z.string().max(500).optional().nullable(),
  rationale: z.string().max(4000).optional().nullable(),
});

export type JudgmentBody = z.infer<typeof judgmentBodySchema> & z.infer<typeof treatmentBodySchema>;

export interface DerivedJudgmentColumns {
  judgment: StoredJudgment | null;
  judgment_path: string | null;
  report_no: ReportNo | null;
  route: ReflectRoute | null;
  standard_treatment: string | null;
  decided_treatment: string | null;
  rationale_required: boolean;
  rationale: string | null;
  comparison_grade: "A" | "B" | "C" | "D" | null;
  fiscal_effect: StoredFiscalEffect | null;
}

/**
 * 本文から060の列を導く。矛盾（判定保留なのに標準処遇どおり、異なる処遇なのに内容が無い）は
 * error で返す — 台帳（G1）に「処遇があるのに判定が無い」行を作らないため。
 */
export function deriveJudgmentColumns(body: JudgmentBody): DerivedJudgmentColumns | { error: string } {
  const stored = body.judgment
    ? normalizeJudgment({
        q1: body.judgment.q1,
        ...(body.judgment.q2 ? { q2: body.judgment.q2 } : {}),
        ...(body.judgment.q3 ? { q3: body.judgment.q3 } : {}),
        ...(body.judgment.q4a ? { q4a: body.judgment.q4a } : {}),
        ...(body.judgment.q4b ? { q4b: body.judgment.q4b } : {}),
        ...(body.judgment.rationale ? { rationale: body.judgment.rationale } : {}),
        ...(body.judgment.evidence ? { evidence: body.judgment.evidence } : {}),
      })
    : null;
  const result = stored ? judge(stored) : null;
  const standard = result?.pattern.standardTreatment ?? null;

  const choice = body.treatment_choice ?? null;
  let decided: string | null = null;
  let rationaleRequired = false;
  if (choice === "standard") {
    if (!result) return { error: "判定保留のため標準処遇は定まりません。処遇は「行わない」にしてください" };
    decided = standard;
  } else if (choice === "modified") {
    const text = (body.decided_treatment ?? "").trim();
    if (!text) return { error: "標準処遇と異なる処遇を選ぶときは、決定処遇（事務局案）を記入してください" };
    decided = text;
    rationaleRequired = treatmentDiffers(standard, text);
  }

  return {
    judgment: stored,
    judgment_path: stored ? (result?.path ?? partialPath(stored)) : null,
    report_no: result?.pattern.no ?? null,
    route: result?.pattern.route ?? null,
    standard_treatment: standard,
    decided_treatment: decided,
    rationale_required: rationaleRequired,
    rationale: (body.rationale ?? "").trim() || null,
    comparison_grade: body.comparison_grade ?? null,
    fiscal_effect: body.fiscal_effect
      ? {
          ...body.fiscal_effect,
          pathways: body.fiscal_effect.pathways.map((p) => ({
            pathway_key: p.pathway_key,
            label: p.label ?? null,
            annual: p.annual ?? null,
            cumulative: p.cumulative ?? null,
            basis: p.basis ?? null,
          })),
        }
      : null,
  };
}
