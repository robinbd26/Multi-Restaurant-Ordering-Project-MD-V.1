import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { ComplaintForm, type ComplaintOrderOption } from "@/components/complaints/complaint-form";
import { getJSON } from "@/lib/api/client";
import { requireUser } from "@/lib/auth/session";
import { friendlyOrderDate } from "@/lib/complaints/routing";
import { prisma } from "@/lib/db";
import { formatClock } from "@/lib/i18n/format";
import { getT } from "@/lib/i18n/server";
import type { Order, Paginated } from "@/types";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: t("complaints.new") };
}

/**
 * Dedicated "file a complaint" page — every authenticated role.
 *
 * Customers get the simplified form: the recipient is fixed (their order's
 * branch manager, decided on the server) and the order picker reads
 * "#1234 · Today, 2:15 PM · ৳799", newest first, on the Dhaka clock. Staff and
 * riders keep the recipient dropdown.
 */
export default async function NewComplaintPage() {
  const { t, fmt, locale } = await getT();
  const me = await requireUser();
  const isCustomer = me.role === "customer";

  let orders: ComplaintOrderOption[] = [];
  if (isCustomer) {
    const now = new Date();
    const rows = await prisma.order.findMany({
      where: { customerId: Number(me.id) },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        createdAt: true,
        totalAmount: true,
        branchId: true,
        branch: { select: { name: true, managerId: true, manager: { select: { status: true, isActive: true } } } },
      },
    });
    const clock = (d: Date) => {
      const local = new Date(d.getTime() + 6 * 60 * 60 * 1000);
      const hhmm = `${String(local.getUTCHours()).padStart(2, "0")}:${String(local.getUTCMinutes()).padStart(2, "0")}`;
      return formatClock(hhmm, locale);
    };
    orders = rows.map((o) => {
      const when = friendlyOrderDate(o.createdAt, now);
      const time = clock(o.createdAt);
      const date =
        when.kind === "today"
          ? t("complaints.orderToday", { time })
          : when.kind === "yesterday"
            ? t("complaints.orderYesterday", { time })
            : when.kind === "daysAgo"
              ? t("complaints.orderDaysAgo", { n: fmt.num(when.days) })
              : t("complaints.orderOnDate", {
                  date: o.createdAt.toLocaleDateString(locale === "bn" ? "bn-BD" : "en-GB", {
                    day: "numeric",
                    month: "short",
                    timeZone: "Asia/Dhaka",
                  }),
                  time,
                });
      const hasManager = Boolean(o.branch.managerId && o.branch.manager?.isActive && o.branch.manager.status === "approved");
      return {
        id: o.id,
        branch: o.branchId,
        label: `#${fmt.num(o.id)} · ${date} · ${fmt.money(o.totalAmount.toString())}`,
        // "Gulshan branch manager", but "Main Branch manager" (not "Main
        // Branch branch manager") when the name already ends in "Branch".
        goesTo: hasManager
          ? /\sbranch$/i.test(o.branch.name.trim())
            ? t("complaints.goesToManagerNamed", { branch: o.branch.name })
            : t("complaints.goesToManager", { branch: o.branch.name })
          : t("complaints.goesToAdminNoManager", { branch: o.branch.name }),
      };
    });
  } else {
    try {
      const data = await getJSON<Paginated<Order>>("/orders/?page_size=50");
      orders = data.results.map((o) => ({
        id: o.id,
        branch: o.branch,
        label: `#${o.id} · ${o.branch_name} · ${t(`orderStatus.${o.status}`)}`,
      }));
    } catch {
      orders = [];
    }
  }

  return (
    <>
      <PageHeader
        title={t("complaints.new")}
        subtitle={isCustomer ? t("complaints.newSubCustomer") : t("complaints.newSub")}
        breadcrumbs={[
          { label: t("nav.complaints") },
          { label: t("complaints.new") },
        ]}
      />
      <Card className="max-w-3xl">
        <CardContent>
          <ComplaintForm orders={orders} customer={isCustomer} />
        </CardContent>
      </Card>
    </>
  );
}
