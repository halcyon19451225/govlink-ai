"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Legend,
} from "recharts";
import type { SensitivityResult } from "@/lib/stats/sensitivity-analysis";

interface TornadoChartProps {
  items: SensitivityResult["items"];
  baseline: number;
}

export default function TornadoChart({ items, baseline }: TornadoChartProps) {
  return (
    <ResponsiveContainer width="100%" height={items.length * 40 + 60}>
      <BarChart
        layout="vertical"
        data={items}
        margin={{ top: 10, right: 30, left: 10, bottom: 10 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
        <XAxis
          type="number"
          tick={{ fill: "#94a3b8", fontSize: 11 }}
          stroke="var(--border)"
          tickFormatter={(v: number) => v.toFixed(2)}
        />
        <YAxis
          type="category"
          dataKey="label"
          width={160}
          tick={{ fill: "#94a3b8", fontSize: 11 }}
          stroke="var(--border)"
        />
        <Tooltip
          contentStyle={{
            background: "var(--bg-secondary)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            color: "#e2e8f0",
            fontSize: 12,
          }}
          formatter={(value, name) => [typeof value === "number" ? value.toFixed(4) : String(value), String(name ?? "")]}
        />
        <Legend
          wrapperStyle={{ fontSize: 12, color: "#94a3b8" }}
          formatter={(value: string) => (value === "low10pct" ? "-10%" : "+10%")}
        />
        <ReferenceLine
          x={baseline}
          stroke="#f59e0b"
          strokeDasharray="4 4"
          label={{ value: "基準", fill: "#f59e0b", fontSize: 11 }}
        />
        <Bar dataKey="low10pct" name="low10pct" fill="#ef4444" opacity={0.8} />
        <Bar dataKey="high10pct" name="high10pct" fill="#10b981" opacity={0.8} />
      </BarChart>
    </ResponsiveContainer>
  );
}
