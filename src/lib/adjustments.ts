/**
 * Describing a set of adjustments in words.
 *
 * Kept apart from photoStore.ts (which opens the database) and ai.ts (which
 * pulls in the Anthropic SDK) so that browser components can use it without
 * dragging either into the client bundle. The type import below is erased at
 * compile time, so nothing from ai.ts is actually loaded.
 */
import type { Adjustments } from "./ai";

/**
 * Readable lines for the UI, skipping anything left at zero. Returns an empty
 * list when there is nothing to apply.
 */
export function describeAdjustments(a: Adjustments): string[] {
  const lines: string[] = [];
  const signed = (n: number) => (n > 0 ? `+${Math.round(n)}` : `${Math.round(n)}`);

  if (Math.abs(a.exposure) >= 1) lines.push(`Exposure ${signed(a.exposure)}`);
  if (Math.abs(a.highlights) >= 1) lines.push(`Highlights ${signed(a.highlights)}`);
  if (Math.abs(a.shadows) >= 1) lines.push(`Shadows ${signed(a.shadows)}`);
  if (Math.abs(a.contrast) >= 1) lines.push(`Contrast ${signed(a.contrast)}`);
  if (Math.abs(a.saturation) >= 1) lines.push(`Saturation ${signed(a.saturation)}`);
  if (Math.abs(a.temperature) >= 1) {
    lines.push(`${a.temperature > 0 ? "Warmer" : "Cooler"} ${signed(a.temperature)}`);
  }
  if (a.sharpen >= 1) lines.push(`Sharpen ${Math.round(a.sharpen)}`);
  if (a.denoise >= 1) lines.push(`Noise reduction ${Math.round(a.denoise)}`);
  if (Math.abs(a.straighten) >= 0.1) lines.push(`Straighten ${a.straighten.toFixed(1)}°`);
  if (a.crop) {
    lines.push(`Crop to ${Math.round(a.crop.width * 100)}% × ${Math.round(a.crop.height * 100)}%`);
  }

  return lines;
}
