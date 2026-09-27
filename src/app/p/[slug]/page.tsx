import PublicAvailability from "@/components/PublicAvailability";
import { getPublicAvailability } from "@/lib/scheduleStore";

/**
 * Public availability page — no sign-in needed. Potential clients see which
 * parts of which days are open, any offers, and can send an enquiry. Reasons
 * for blocked times are never shown.
 */
export default async function PublicAvailabilityPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const availability = getPublicAvailability(slug);

  if (!availability) {
    return (
      <div className="mx-auto max-w-lg text-center">
        <h1 className="text-2xl font-bold">No availability published yet</h1>
        <p className="mt-2 text-stone-600">
          This photographer has not published a schedule, or the link is not right.
        </p>
      </div>
    );
  }

  return <PublicAvailability availability={availability} />;
}
