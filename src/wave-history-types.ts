/** CY50R1 ECWAM research hindcasts, not archived operational forecasts. */
export type WaveHistorySource = "mfwam" | "ecwam";
export type SwellPartition = "primary" | "secondary";
export type SwellReading = Readonly<{ height: number | null; period: number | null; direction: number | null }>;
export type EcwamHour = Readonly<{ time: number; primary: SwellReading; secondary: SwellReading }>;
export type EcwamMonth = Readonly<{
  version: 1; year: number; month: number; experiment: "ijxo" | "iocj";
  latitude: number; longitude: number; hours: readonly EcwamHour[];
}>;
export type ArchiveProgress = Readonly<{
  configured: boolean; total: number; ready: number; pending: number; failed: number; missing: number;
  active: string | null; error: string | null;
  activeCount?: number;
}>;
export type ArchiveReply = Readonly<{ progress: ArchiveProgress; months?: readonly EcwamMonth[] }>;
