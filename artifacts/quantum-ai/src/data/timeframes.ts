export type Timeframe = "30s" | "1m" | "5m" | "30m";

export const TIMEFRAMES: { id: Timeframe; label: string; long: string }[] = [
  { id: "30s", label: "30s", long: "30 Seconds" },
  { id: "1m",  label: "1m",  long: "1 Minute"  },
  { id: "5m",  label: "5m",  long: "5 Minutes" },
  { id: "30m", label: "30m", long: "30 Minutes" },
];
