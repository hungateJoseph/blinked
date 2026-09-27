import type { FaceBox } from "@/lib/faces";

/**
 * A square thumbnail cropped to one face inside a larger photo.
 *
 * The crop is done with CSS rather than by generating image files: the photo
 * is scaled up so the face box fills the frame and shifted so the face lands
 * in it. That means no extra storage, no processing, and the thumbnail stays
 * correct if the photo is ever replaced.
 */
export default function FaceThumb({
  src,
  box,
  alt,
  className = "",
}: {
  src: string;
  box: FaceBox;
  alt: string;
  /** Extra classes for the square frame. */
  className?: string;
}) {
  // A detection box is tight around the features; a little room around it
  // makes a face far easier for a person to recognise.
  const pad = 0.45;
  const width = Math.min(1, box.width * (1 + pad * 2));
  const height = Math.min(1, box.height * (1 + pad * 2));
  const left = Math.max(0, Math.min(1 - width, box.x - box.width * pad));
  const top = Math.max(0, Math.min(1 - height, box.y - box.height * pad));

  // Guard against a zero-size box, which would divide by zero below.
  const safeW = Math.max(width, 0.01);
  const safeH = Math.max(height, 0.01);

  return (
    <div className={`relative aspect-square overflow-hidden bg-stone-100 ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        className="absolute max-w-none"
        style={{
          width: `${100 / safeW}%`,
          height: `${100 / safeH}%`,
          left: `${(-left / safeW) * 100}%`,
          top: `${(-top / safeH) * 100}%`,
        }}
      />
    </div>
  );
}
