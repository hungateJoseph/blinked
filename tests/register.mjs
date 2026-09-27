// `node --import ./tests/register.mjs --test tests/` — installs the resolver in hooks.mjs.
import { register } from "node:module";

register("./hooks.mjs", import.meta.url);
