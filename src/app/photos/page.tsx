import Link from "next/link";
import GoogleDriveImport from "@/components/GoogleDriveImport";
import PhotoUploader from "@/components/PhotoUploader";
import { requireUser } from "@/lib/auth";
import { listPhotos, photoToView } from "@/lib/photoStore";

/** Photo Management: upload photos (one at a time) and open them for cleanup. */
export default async function PhotosPage() {
  const user = await requireUser();
  const photos = listPhotos(user.id).map(photoToView);

  // Drive import needs both a client id and a Picker API key. Offered to
  // everyone, not only people who signed in with Google: authorising Drive is
  // a separate step either way, so an email-signed-in photographer with a
  // Google account can use it too.
  const driveClientId = process.env.GOOGLE_CLIENT_ID;
  const driveApiKey = process.env.GOOGLE_API_KEY;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl">Photo library</h1>
        <p className="mt-1 max-w-2xl text-sm text-stone-600">
          What your assistant can see and touch up. Upload from your computer or Google Drive, run
          the cleanup pass to spot blur, cut-off faces and other irregularities, then open a photo
          to apply the fixes or to find every other photo someone in it appears in.
        </p>
      </div>

      <PhotoUploader />

      {driveClientId && driveApiKey && (
        <GoogleDriveImport clientId={driveClientId} apiKey={driveApiKey} />
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Your photos</h2>
        {photos.length === 0 ? (
          <p className="text-sm text-stone-500">Nothing uploaded yet.</p>
        ) : (
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
            {photos.map((photo) => (
              <li key={photo.id}>
                <Link href={`/photos/${photo.id}`} className="block space-y-1">
                  {/* Plain <img>: the file is served by our own API route, not a public URL. */}
                  <img
                    src={photo.fileUrl}
                    alt={photo.originalName}
                    className="aspect-square w-full rounded-lg object-cover shadow-sm"
                  />
                  <span className="block truncate text-xs text-stone-600">{photo.originalName}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
