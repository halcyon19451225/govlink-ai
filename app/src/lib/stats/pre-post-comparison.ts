export interface PrePostData {
  pre: number;
  post: number;
  label: string;
}

export interface PrePostResult {
  items: Array<{
    label: string;
    pre: number;
    post: number;
    change: number;
    changePct: number;
  }>;
  overallChange: number;
  overallChangePct: number;
  interpretation: string;
  calculationSteps: { formula: string; details: string };
}

export function calcPrePost(data: PrePostData[]): PrePostResult {
  const items = data.map((d) => {
    const change = d.post - d.pre;
    const changePct = Math.abs(d.pre) > 0 ? ((d.post - d.pre) / Math.abs(d.pre)) * 100 : 0;
    return {
      label: d.label,
      pre: d.pre,
      post: d.post,
      change,
      changePct: Math.round(changePct * 100) / 100,
    };
  });

  const totalPre = data.reduce((s, d) => s + d.pre, 0);
  const totalPost = data.reduce((s, d) => s + d.post, 0);
  const overallChange = totalPost - totalPre;
  const overallChangePct =
    Math.abs(totalPre) > 0 ? Math.round(((overallChange / Math.abs(totalPre)) * 100) * 100) / 100 : 0;

  const interpretation = `全体で ${overallChangePct >= 0 ? "+" : ""}${overallChangePct}%の変化`;

  const formulaDetails = items
    .map(
      (it) =>
        `${it.label}: change = ${it.post} - ${it.pre} = ${it.change}, changePct = (${it.change} / |${it.pre}|) × 100 = ${it.changePct}%`,
    )
    .join("\n");

  return {
    items,
    overallChange,
    overallChangePct,
    interpretation,
    calculationSteps: {
      formula: "change = post - pre\nchangePct = (post - pre) / |pre| × 100",
      details: formulaDetails,
    },
  };
}
