import { inflateRawSync } from "node:zlib";

// Read one named member in memory; never extract provider paths to disk.
// Both feeds use ordinary ZIP files (CWA stored, NOWPHAS deflated).
export const waveArchiveEntry = (bytes: Uint8Array, matches: (name: string) => boolean): Readonly<{ name: string; bytes: Uint8Array }> | null => {
  if (bytes.byteLength > 20 * 1024 * 1024) throw new Error("Wave archive exceeds size limit");
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let footer = data.length - 22;
  for (; footer >= Math.max(0, data.length - 65557); footer--) {
    if (data.readUInt32LE(footer) === 0x06054b50) break;
  }
  if (footer < 0 || footer < data.length - 65557) throw new Error("Invalid ZIP footer");
  const count = data.readUInt16LE(footer + 10), directory = data.readUInt32LE(footer + 16);
  if (count > 512 || data.readUInt16LE(footer + 4) !== 0 || data.readUInt16LE(footer + 6) !== 0) throw new Error("Unsupported ZIP layout");
  let offset = directory;
  for (let index = 0; index < count; index++) {
    if (offset + 46 > footer || data.readUInt32LE(offset) !== 0x02014b50) throw new Error("Invalid ZIP directory");
    const flags = data.readUInt16LE(offset + 8), method = data.readUInt16LE(offset + 10);
    const compressedSize = data.readUInt32LE(offset + 20), size = data.readUInt32LE(offset + 24);
    const nameSize = data.readUInt16LE(offset + 28), extraSize = data.readUInt16LE(offset + 30), commentSize = data.readUInt16LE(offset + 32);
    const localOffset = data.readUInt32LE(offset + 42);
    const next = offset + 46 + nameSize + extraSize + commentSize;
    if (next > footer) throw new Error("Invalid ZIP member");
    const name = data.subarray(offset + 46, offset + 46 + nameSize).toString("utf8");
    offset = next;
    if (!matches(name)) continue;
    if ((flags & 1) || ![0, 8].includes(method) || size > 32 * 1024 * 1024 || localOffset + 30 > data.length ||
      data.readUInt32LE(localOffset) !== 0x04034b50) throw new Error("Unsupported ZIP member");
    const start = localOffset + 30 + data.readUInt16LE(localOffset + 26) + data.readUInt16LE(localOffset + 28);
    if (start + compressedSize > directory) throw new Error("Truncated ZIP member");
    const compressed = data.subarray(start, start + compressedSize);
    const result = method === 0 ? compressed : inflateRawSync(compressed, { maxOutputLength: 32 * 1024 * 1024 });
    if (result.byteLength !== size) throw new Error("Incomplete ZIP member");
    return { name, bytes: result };
  }
  return null;
};
