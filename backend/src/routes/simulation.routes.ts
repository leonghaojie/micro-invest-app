/**
 * /simulation/* — FR05, FR06, FR07 (run), FR13 (history). Requires auth.
 */
import { Router } from "express";
import { getHistory, runSimulation } from "../controllers/simulation.controller";

export const simulationRouter = Router();

simulationRouter.post("/run", runSimulation);
simulationRouter.get("/history", getHistory);
