import { notFound } from "next/navigation";
import PhotoCleanup from "@/components/PhotoCleanup";
import PhotoFaces from "@/components/PhotoFaces";
import { listFaces } from "@/lib/faces";
import { isAiConfigured } from "@/lib/ai";
import { requireUser } from "@/lib/auth";
import { getLatestAnalysis, getPhoto, photoToView } from "@/lib/photoStore";

/** One photo with the AI Image Cleanup tool. */
export default async function PhotoPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;

  const photo = getPhoto(user.id, id);
  if (!photo) notFound();

  const view = photoToView(photo);

  return (
    <div className="space-y-6">
      <PhotoCleanup
        photo={view}
        initialAnalysis={getLatestAnalysis(user.id, photo.id)}
        aiConfigured={isAiConfigured()}
      />
      <PhotoFaces
        photo={view}
        initialFaces={listFaces(user.id).filter((f) => f.photoId === photo.id)}
      />
    </div>
  );
}
