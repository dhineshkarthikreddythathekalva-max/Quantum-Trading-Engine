export type Timeframe = "30s" | "1m" | "2m" | "3m" | "5m" | "15m" | "30m";

export const TIMEFRAMES: { id: Timeframe; label: string; long: string; ms: number }[] = [
  { id: "30s", label: "30s",  long: "30 Seconds",  ms: 30000   },
  { id: "1m",  label: "1m",   long: "1 Minute",    ms: 60000   },
  { id: "2m",  label: "2m",   long: "2 Minutes",   ms: 120000  },
  { id: "3m",  label: "3m",   long: "3 Minutes",   ms: 180000  },
  { id: "5m",  label: "5m",   long: "5 Minutes",   ms: 300000  },
  { id: "15m", label: "15m",  long: "15 Minutes",  ms: 900000  },
  { id: "30m", label: "30m",  long: "30 Minutes",  ms: 1800000 },
];
