// Box-Muller変換でガウス乱数
function gaussianRandom(mean, stddev) {
  if (stddev === 0) return mean;
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return mean + stddev * Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

function calcCostRatio(p) {
  const a = Math.abs(p.insured_n) * (Math.abs(p.delta_cert_rate) / 100) * Math.abs(p.unit_benefit);
  const b = Math.abs(p.recipient_count) * (Math.abs(p.delta_recep_rate) / 100) * Math.abs(p.unit_benefit);
  const c = Math.abs(p.recipient_count) * Math.abs(p.delta_unit_benefit);
  const total = a + b + c;
  if (total === 0) return Infinity;
  return p.total_investment / total;
}

self.onmessage = function(e) {
  const params = e.data;
  const n = params.iterations || 10000;
  const results = [];

  for (let i = 0; i < n; i++) {
    const p = {
      insured_n: gaussianRandom(params.insured_n.mean, params.insured_n.stddev),
      delta_cert_rate: gaussianRandom(params.delta_cert_rate.mean, params.delta_cert_rate.stddev),
      unit_benefit: gaussianRandom(params.unit_benefit.mean, params.unit_benefit.stddev),
      delta_recep_rate: gaussianRandom(params.delta_recep_rate.mean, params.delta_recep_rate.stddev),
      recipient_count: gaussianRandom(params.recipient_count.mean, params.recipient_count.stddev),
      delta_unit_benefit: gaussianRandom(params.delta_unit_benefit.mean, params.delta_unit_benefit.stddev),
      total_investment: params.total_investment,
    };
    const ratio = calcCostRatio(p);
    if (isFinite(ratio) && ratio > 0) results.push(ratio);
  }

  results.sort((a, b) => a - b);
  const mean = results.reduce((s, v) => s + v, 0) / results.length;
  const variance = results.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / results.length;
  const stddev = Math.sqrt(variance);
  const p5 = results[Math.floor(results.length * 0.05)] || 0;
  const p95 = results[Math.floor(results.length * 0.95)] || 0;

  // 20ビンのヒストグラム
  const min = results[0] || 0;
  const max = results[results.length - 1] || 1;
  const binSize = (max - min) / 20 || 1;
  const bins = Array.from({ length: 20 }, (_, i) => ({
    bin: (min + i * binSize).toFixed(2) + '〜' + (min + (i + 1) * binSize).toFixed(2),
    count: 0,
  }));
  results.forEach(v => {
    const idx = Math.min(19, Math.floor((v - min) / binSize));
    bins[idx].count++;
  });

  self.postMessage({ cost_ratios: results, mean, stddev, p5, p95, histogram: bins });
};
