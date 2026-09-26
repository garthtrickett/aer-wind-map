import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

const require = createRequire(import.meta.url);
const packageRoot = dirname(require.resolve("@meri-imperiumi/eccodes-wasm"));
const output = resolve("public/decoder");
mkdirSync(output, { recursive: true });

for (const file of ["eccodes.js", "eccodes.wasm", "index.js"]) {
  copyFileSync(resolve(packageRoot, "build/eccodes", file), resolve(output, file));
}
