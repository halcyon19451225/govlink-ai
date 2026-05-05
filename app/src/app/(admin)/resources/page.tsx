export const dynamic = 'force-dynamic'

import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { query } from "@/lib/db";
import ResourcesClient, { ResourceRow } from "./ResourcesClient";
import BackButton from "@/components/BackButton";

export default async function ResourcesPage() {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  const municipalityId = (session.user as { municipalityId?: string }).municipalityId;

  const resources = municipalityId
    ? await query<ResourceRow>(
        `SELECT id, resource_type, name, purpose, contact, schedule_pattern, notes
         FROM org_resources
         WHERE municipality_id = $1
         ORDER BY resource_type, name`,
        [municipalityId],
      )
    : [];

  return (
    <div>
      <div className="mb-4">
        <BackButton />
      </div>
      <ResourcesClient initialResources={resources} />
    </div>
  );
}
