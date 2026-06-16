import "server-only";
import { query } from "./db";

export interface ProgressUpdate {
  step?: string;
  progress?: number;
  processedChunks?: number;
  totalChunks?: number;
  status?: "pending" | "processing" | "compiled" | "error";
  errorMessage?: string | null;
}

export async function appendLog(
  documentId: string,
  step: string,
  message: string,
): Promise<void> {
  const entry = JSON.stringify({ step, message, at: new Date().toISOString() });
  await query(
    `UPDATE knowledge_documents
     SET processing_log = processing_log || $1::jsonb,
         updated_at = NOW()
     WHERE id = $2`,
    [entry, documentId],
  );
}

export async function setProgress(
  documentId: string,
  update: ProgressUpdate,
  logMessage?: string,
): Promise<void> {
  const sets: string[] = ["updated_at = NOW()"];
  const vals: unknown[] = [];
  let i = 1;

  if (update.step !== undefined) { sets.push(`processing_step = $${i++}`); vals.push(update.step); }
  if (update.progress !== undefined) { sets.push(`processing_progress = $${i++}`); vals.push(update.progress); }
  if (update.processedChunks !== undefined) { sets.push(`processed_chunks = $${i++}`); vals.push(update.processedChunks); }
  if (update.totalChunks !== undefined) { sets.push(`total_chunks = $${i++}`); vals.push(update.totalChunks); }
  if (update.status !== undefined) { sets.push(`status = $${i++}`); vals.push(update.status); }
  if (update.errorMessage !== undefined) { sets.push(`error_message = $${i++}`); vals.push(update.errorMessage); }

  if (logMessage && update.step) {
    const entry = JSON.stringify({ step: update.step, message: logMessage, at: new Date().toISOString() });
    sets.push(`processing_log = processing_log || $${i++}::jsonb`);
    vals.push(entry);
  }

  vals.push(documentId);
  await query(
    `UPDATE knowledge_documents SET ${sets.join(", ")} WHERE id = $${i}`,
    vals,
  );
}
