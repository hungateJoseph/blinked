/**
 * Module resolution for the tests, so Node can run the app's TypeScript
 * directly: `@/lib/x` maps to `src/lib/x`, and an extensionless relative
 * import inside `src` or `tests` finds its `.ts` file. Node strips the types
 * itself (built in from Node 22.18 onwards); nothing is compiled.
 */
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "src");
const tests = path.join(root, "tests");
const EXTENSIONS = [".ts", ".tsx", ".mts", ".js", ".mjs"];

function isFile(p) {
  return existsSync(p) && statSync(p).isFile();
}

function withExtension(target) {
  if (isFile(target)) return target;
  for (const ext of EXTENSIONS) if (isFile(target + ext)) return target + ext;
  for (const ext of EXTENSIONS) {
    const index = path.join(target, `index${ext}`);
    if (isFile(index)) return index;
  }
  return null;
}

export async function resolve(specifier, context, next) {
  const parent = context.parentURL?.startsWith("file:") ? fileURLToPath(context.parentURL) : null;
  const ours = parent !== null && (parent.startsWith(src) || parent.startsWith(tests));

  let target = null;
  if (specifier.startsWith("@/")) target = path.join(src, specifier.slice(2));
  else if (ours && (specifier.startsWith("./") || specifier.startsWith("../"))) {
    target = path.resolve(path.dirname(parent), specifier);
  }

  if (target) {
    const found = withExtension(target);
    if (found) return { url: pathToFileURL(found).href, shortCircuit: true };
  }
  return next(specifier, context);
}
