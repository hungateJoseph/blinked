import PeopleFinder from "@/components/PeopleFinder";
import { requireUser } from "@/lib/auth";
import { countFaces, indexedPhotoIds } from "@/lib/faces";
import { listPhotos, photoToView } from "@/lib/photoStore";

/** Find every photo containing a particular person. */
export default async function PeoplePage({
  searchParams,
}: {
  // ?face=<id> arrives when someone clicks a person on a photo's own page.
  searchParams: Promise<{ face?: string }>;
}) {
  const user = await requireUser();
  const { face } = await searchParams;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl">People</h1>
        <p className="mt-1 max-w-3xl text-sm text-stone-600">
          Pick a guest out of your own photos and get back every photo they appear in — the same
          search an agent runs when a couple asks for “all the ones with Grandma”. No need to track
          down a picture of each guest first.
        </p>
      </div>

      <div className="card border-amber-200 bg-amber-50 text-sm text-amber-900">
        <p className="font-semibold">Before you use this on real weddings</p>
        <p className="mt-1">
          Face measurements are biometric data about your guests. Under GDPR they need those
          guests&apos; explicit consent, and Illinois, Texas and Washington have their own biometric
          laws with per-person penalties. Photographers who offer this usually cover it in their
          client contract. Everything here stays on your own machine and server — nothing is sent to
          any third party — but that does not by itself satisfy those rules.
        </p>
      </div>

      <PeopleFinder
        photos={listPhotos(user.id).map(photoToView)}
        initialIndexed={indexedPhotoIds(user.id)}
        initialCounts={countFaces(user.id)}
        initialFaceId={face}
      />
    </div>
  );
}
