export const dynamic = 'force-dynamic'

import { notFound } from "next/navigation";
import { getTemplateWithCycles } from "@/lib/templates";
import TemplateEditorClient from "./TemplateEditorClient";

type Props = { params: { id: string } };

export default async function TemplateEditPage({ params }: Props) {
  const template = await getTemplateWithCycles(params.id);
  if (!template) notFound();

  return <TemplateEditorClient template={template} />;
}
