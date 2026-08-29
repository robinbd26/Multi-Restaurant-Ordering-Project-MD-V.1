import { ManagementReportView } from "@/components/management/report-view";
import { requireRole } from "@/lib/auth/session";
import type { RawSearchParams } from "@/lib/http/list-params";

export default async function Page({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  await requireRole("management", "super_admin");
  return <ManagementReportView type="branches" searchParams={await searchParams} />;
}
