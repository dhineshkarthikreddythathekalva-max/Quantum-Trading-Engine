import { Router, type IRouter } from "express";
import { GetQuotexMarketQueryParams, GetQuotexMarketResponse } from "@workspace/api-zod";
import { quotexFeed } from "../lib/quotexFeed";
import { bridgeGetAssets, bridgeGetPayouts } from "../lib/quotexBridge";

const router: IRouter = Router();

// Instrument names Quotex reports as available (via the Python bridge).
// Clients use this to populate pair selectors / scanners with real assets.
router.get("/quotex/assets", async (_req, res): Promise<void> => {
  const assets = await bridgeGetAssets();
  res.json({
    status: assets ? "ok" : "unavailable",
    source: assets ? "quotex" : "none",
    assets: assets ?? [],
  });
});

router.get("/quotex/payouts", async (_req, res): Promise<void> => {
  const payouts = await bridgeGetPayouts();
  res.json({
    status: payouts ? "ok" : "unavailable",
    source: payouts ? "quotex" : "none",
    payouts: payouts ?? {},
  });
});

router.get("/quotex/market", async (req, res): Promise<void> => {
  const parsed = GetQuotexMarketQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const result = await quotexFeed.getMarket(parsed.data.asset, parsed.data.period);
  res.status(result.status === "live" ? 200 : 503).json(GetQuotexMarketResponse.parse(result));
});

export default router;