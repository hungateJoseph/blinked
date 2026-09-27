import DiscountRules from "@/components/DiscountRules";
import ScheduleBuilder from "@/components/ScheduleBuilder";
import { isAiConfigured } from "@/lib/ai";
import { requireUser } from "@/lib/auth";
import { addDays, todayIso } from "@/lib/dates";
import {
  bookingToView,
  getLatestSchedule,
  listBookings,
  listDiscounts,
} from "@/lib/scheduleStore";

/**
 * Calendar/Planning. Loads the photographer's data on the server and hands it
 * to the interactive builder.
 */
export default async function SchedulePage() {
  const user = await requireUser();

  // Worked out here, on the server, so the form's initial values are identical
  // during server rendering and hydration (see the note on todayIso).
  const today = todayIso();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl">Schedule</h1>
        <p className="mt-1 max-w-2xl text-sm text-stone-600">
          The dates you are booked and the times you offer. Your assistant checks this before it
          answers a date question, and any booking it proposes lands here. Enter what you have and
          how you like to work, and a draft availability schedule is proposed for you to review
          before it is published.
        </p>
      </div>

      <DiscountRules initial={listDiscounts(user.id)} />

      <ScheduleBuilder
        initialBookings={listBookings(user.id).map(bookingToView)}
        initialDraft={getLatestSchedule(user.id, "draft")}
        initialFinal={getLatestSchedule(user.id, "final")}
        publicSlug={user.public_slug}
        aiConfigured={isAiConfigured()}
        defaultRangeStart={today}
        defaultRangeEnd={addDays(today, 90)}
      />
    </div>
  );
}
