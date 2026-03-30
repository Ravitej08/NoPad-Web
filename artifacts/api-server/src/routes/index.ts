import { Router, type IRouter } from "express";
import healthRouter from "./health";
import roomsRouter from "./rooms";
import filesRouter from "./files";
import blocksRouter from "./blocks";

const router: IRouter = Router();

router.use(healthRouter);
router.use(roomsRouter);
router.use(filesRouter);
router.use(blocksRouter);

export default router;
