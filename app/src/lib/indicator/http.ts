/** API ルート共通: IndicatorError を { data, error } 形式に写す */
import { NextResponse } from "next/server";
import { IndicatorError } from "./service";

export function indicatorErrorResponse(err: unknown): NextResponse {
  if (err instanceof IndicatorError) {
    return NextResponse.json({ data: null, error: err.message }, { status: err.status });
  }
  console.error("[indicators] unexpected error", err);
  return NextResponse.json({ data: null, error: "処理に失敗しました" }, { status: 500 });
}
