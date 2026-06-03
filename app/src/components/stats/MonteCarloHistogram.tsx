"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { MonteCarloResult } from "@/lib/stats/monte-carlo";

interface MonteCarloHistogramProps {
  result: MonteCarloResult;
}

export default function MonteCarloHistogram({ result }: MonteCarloHistogramProps) {
  return (
    <div>
      <p className="text-xs text-slate-400 mb-2">
        平均: {result.mean.toFixed(2)}, 標準偏差: {result.stddev.toFixed(2)}, 5%ile: {result.p5.toFixed(2)}, 95%ile: {result.p95.toFixed(2)}
      </p>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart
          data={result.histogram}
          margin={{ top: 10, right: 20, left: 10, bottom: 30 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis
            dataKey="bin"
            tick={{ fill: "#94a3b8", fontSize: 10 }}
            stroke="var(--border)"
            angle={-45}
            textAnchor="end"
            interval={0}
            tickFormatter={(v: string) => v.slice(0, 9)}
          />
          <YAxis
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
          />
          <Bar dataKey="count" fill="#6366f1" opacity={0.8} name="度数" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
