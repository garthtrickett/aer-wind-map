import { createReadStream, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";

await pipeline(
  createReadStream("dist/decoder/eccodes.wasm"),
  createGzip({ level: 9 }),
  createWriteStream("dist/decoder/eccodes.wasm.gz"),
);
