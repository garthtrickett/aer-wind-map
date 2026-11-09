import { NetCDFReader } from "netcdfjs";
import type { EcwamMonth, EcwamHour, SwellReading } from "../../src/wave-history-types.ts";

type Attribute = { name: string; value: number | string };
const fields = ["swh1", "mwp1", "mwd1", "swh2", "mwp2", "mwd2"] as const;
/** Decode packed NetCDF3 values explicitly: netcdfjs intentionally leaves CF packing to callers. */
export function decodeEcwam(data: Uint8Array, year: number, month: number, latitude: number, longitude: number): EcwamMonth {
  const file = new NetCDFReader(data);
  const read = (name: string): number[] => {
    const variable = file.variables.find((item) => item.name === name);
    if (!variable) throw new Error(`ECMWF file has no ${name}`);
    const attributes = variable.attributes as Attribute[];
    const attribute = (key: string) => attributes.find((item) => item.name === key)?.value;
    const scale = Number(attribute("scale_factor") ?? 1), offset = Number(attribute("add_offset") ?? 0);
    const fill = attribute("_FillValue"), missing = attribute("missing_value");
    const size = variable.dimensions.reduce((n, id) => n * (file.dimensions[id].size || file.recordDimension.length), 1);
    const raw = file.getDataVariable(name).flat() as number[];
    return raw.slice(0, size).map((value) => value === fill || value === missing ? NaN : value * scale + offset);
  };
  const latitudes = read("latitude"), longitudes = read("longitude"), times = read("time");
  const nearest = (values: number[], target: number, circular = false) => values.reduce((best, value, index) => {
    const distance = (v: number) => circular ? Math.abs(((v - target + 540) % 360) - 180) : Math.abs(v - target);
    return distance(value) < distance(values[best]) ? index : best;
  }, 0);
  const lat = nearest(latitudes, latitude), lon = nearest(longitudes, longitude, true);
  if (Math.abs(latitudes[lat] - latitude) > 0.126 || Math.abs(((longitudes[lon] - longitude + 540) % 360) - 180) > 0.126)
    throw new Error("ECMWF result does not cover the requested grid cell");
  const timeVariable = file.variables.find((item) => item.name === "time")!;
  const units = (timeVariable.attributes as Attribute[]).find((item) => item.name === "units")?.value;
  if (typeof units !== "string" || !units.startsWith("hours since ")) throw new Error("Unsupported ECMWF time units");
  const epoch = Date.parse(units.slice(12).replace(" ", "T") + (units.endsWith("Z") ? "" : "Z")) / 1000;
  if (!Number.isFinite(epoch)) throw new Error("Invalid ECMWF time origin");
  for (const name of fields) {
    const attributes = file.variables.find((item) => item.name === name)?.attributes as Attribute[] | undefined;
    const units = attributes?.find((item) => item.name === "units")?.value;
    const expected = name.startsWith("swh") ? "m" : name.startsWith("mwp") ? "s" : "degrees";
    if (units !== expected) throw new Error(`Unexpected ECMWF ${name} units`);
  }
  const values = fields.map(read), plane = latitudes.length * longitudes.length;
  // Reject unexpected dimension order rather than silently reading the wrong location.
  for (const name of fields) {
    const dimensions = file.variables.find((item) => item.name === name)!.dimensions.map((id) => file.dimensions[id].name);
    if (dimensions.join(",") !== "time,latitude,longitude") throw new Error("Unsupported ECMWF dimension order");
  }
  const reading = (index: number, base: number): SwellReading => {
    const numbers = values.slice(base, base + 3).map((array) => array[index]);
    if (!numbers.every(Number.isFinite)) return { height: null, period: null, direction: null };
    const [height, period, direction] = numbers;
    if (height < -1e-8 || height > 40 || period < -1e-8 || period > 120 || direction < -1e-8 || direction > 360 + 1e-8)
      throw new Error("ECMWF swell values are outside physical bounds");
    return { height: Math.max(0, height), period: Math.max(0, period), direction: ((direction % 360) + 360) % 360 };
  };
  const hours: EcwamHour[] = times.map((time, index) => {
    const cell = index * plane + lat * longitudes.length + lon;
    return { time: Math.round(epoch + time * 3600), primary: reading(cell, 0), secondary: reading(cell, 3) };
  });
  const start = Date.UTC(year, month - 1) / 1000, end = Date.UTC(year, month) / 1000;
  if (hours.length !== (end - start) / 3600 || hours.some((hour, index) => hour.time !== start + index * 3600))
    throw new Error("ECMWF file is not a complete hourly UTC month");
  if (!hours.some((hour) => hour.primary.height !== null)) throw new Error("No ocean wave data at this cell; move the marker farther offshore");
  return { version: 1, year, month, experiment: year <= 2023 ? "ijxo" : "iocj", latitude: latitudes[lat],
    longitude: ((longitudes[lon] + 540) % 360) - 180, hours };
}
