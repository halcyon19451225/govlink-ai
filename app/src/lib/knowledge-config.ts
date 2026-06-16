export const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20MB
export const ALLOWED_FILE_TYPES = ["pdf", "docx", "txt"] as const;
export const ALLOWED_MIME = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
] as const;
export const MAX_EXTRACTED_CHARS = 200_000;
export const CHUNK_CHAR_SIZE = 12_000;

export function estimateProcessingSeconds(fileSizeBytes: number): number {
  const mb = fileSizeBytes / (1024 * 1024);
  return Math.round(30 + mb * 15);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
