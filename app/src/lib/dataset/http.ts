/** API ルート共通: DatasetError を { data, error } 形式に写す */
import { NextResponse } from "next/server";
import { DatasetError } from "./service";

export function datasetErrorResponse(err: unknown): NextResponse {
  if (err instanceof DatasetError) {
    return NextResponse.json({ data: null, error: err.message }, { status: err.status });
  }
  console.error("[datasets] unexpected error", err);
  return NextResponse.json({ data: null, error: "処理に失敗しました" }, { status: 500 });
}
