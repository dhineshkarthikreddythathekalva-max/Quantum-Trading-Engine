import { Router, type IRouter } from "express";
import healthRouter from "./health";
import quotexRouter from "./quotex";

const router: IRouter = Router();

router.use(healthRouter);
router.use(quotexRouter);

export default router;
