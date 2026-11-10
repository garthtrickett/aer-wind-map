import { OmDataType, OmFileReader, OmHttpBackend } from "@openmeteo/file-reader";
import { primarySwellDirectionFrom, primarySwellFrameUrl, primarySwellMapGrid, primarySwellVariables } from "./primary-swell.ts";
import type { ForecastRun } from "./wind.ts";
import type { WaveField } from "./wave.ts";

export async function loadPrimarySwellField(run: ForecastRun, step: number, signal: AbortSignal): Promise<WaveField> {
  const backend = new OmHttpBackend({ url: primarySwellFrameUrl(run, step), timeoutMs: 15_000, retries: 2, eTagValidation: false });
  let root: OmFileReader | null = null;
  try {
    root = await OmFileReader.create(backend);
    const arrays: Float32Array[] = [];
    for (const name of primarySwellVariables) {
      signal.throwIfAborted();
      const variable = await root.getChildByName(name);
      if (!variable) throw new Error(`Primary swell field missing: ${name}`);
      try {
        const dimensions = variable.getDimensions();
        if (dimensions.length !== 2 || dimensions[0] !== 2041 || dimensions[1] !== 4320)
          throw new Error("Unexpected primary swell grid geometry");
        const values = await variable.read({ type: OmDataType.FloatArray,
          ranges: [{ start: 0, end: 2041 }, { start: 0, end: 4320 }], signal,
          ioSizeMax: 4n * 1024n * 1024n, ioSizeMerge: 16n * 1024n, prefetchConcurrency: 4 });
        arrays.push(primarySwellMapGrid(values));
      } finally { variable.dispose(); }
    }
    const [waveHeight, wavePeriod, waveDirection] = arrays;
    for (let index = 0; index < waveHeight.length; index++) {
      if (!(waveHeight[index]! >= 0 && waveHeight[index]! <= 40 && wavePeriod[index]! > 0 && wavePeriod[index]! <= 60)) {
        waveHeight[index] = NaN; wavePeriod[index] = NaN; waveDirection[index] = NaN;
      } else waveDirection[index] = primarySwellDirectionFrom(waveDirection[index]!);
    }
    return { kind: "waves", source: "mfwam-primary", run, step, width: 2160, height: 1021,
      firstLatitude: 90 + 1 / 24, firstLongitude: -180 + 1 / 24, increment: 1 / 6,
      waveHeight, wavePeriod, waveDirection };
  } finally { root?.dispose(); await backend.close(); }
}
