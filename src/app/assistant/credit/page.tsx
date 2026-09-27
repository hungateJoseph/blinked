import Link from "next/link";
import CreditPanel from "@/components/CreditPanel";
import { requireUser } from "@/lib/auth";
import { TOPUP_AMOUNTS_CENTS, billingStatus, listLedger } from "@/lib/billing";

/** Credit for the workflow analysis: balance, top-ups, history. */
export default async function CreditPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const user = await requireUser();
  const { status } = await searchParams;
  const billing = billingStatus(user.id);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Analysis credit</h1>
          <p className="mt-1 text-sm text-stone-600">
            Prepaid credit spent on the cost of running workflow analyses — not on the goods or
            services they price, which are arranged with the team separately.
          </p>
        </div>
        <Link href="/assistant" className="btn-secondary">
          Back to the assistant
        </Link>
      </div>

      {status === "success" && (
        <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">
          Thanks — your payment went through. The credit appears below as soon as Stripe confirms
          it, usually within a few seconds; refresh if it is not there yet.
        </p>
      )}
      {status === "cancelled" && (
        <p className="rounded-lg bg-stone-100 p-3 text-sm text-stone-700">No payment was made.</p>
      )}

      <CreditPanel
        enabled={billing.enabled}
        balanceCents={billing.balanceCents}
        ledger={listLedger(user.id)}
        amounts={TOPUP_AMOUNTS_CENTS}
      />
    </div>
  );
}
