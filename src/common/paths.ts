/**
 * paths.ts — Shared path constants for the orchestrator.
 *
 * Extracted from pipeline.ts and dashboard.ts (see Comparison.md). These
 * constants resolved to the same locations in both files; they are centralized
 * here and standardized on `resolve(...)` so every consumer gets an absolute,
 * normalized path.
 *
 * IMPORTANT: This module loads prototype-orchestrator/.env at import time, before
 * computing DATA_DIR (which reads process.env.PIPELINE_DATA_DIR). Import this
 * module before any other module that reads process.env at load time.
 */

import { join, resolve } from "path";
import dotenv from "dotenv";

// src/common/paths.ts → orchestrator root is two levels up from this file.
export const ORCH_DIR = resolve(__dirname, "..", "..");

dotenv.config({ path: join(ORCH_DIR, ".env") }); // load .env before computing DATA_DIR

export const PROJECT_ROOT = resolve(ORCH_DIR, ".."); // prototype-orchestrator/ sits at the repo root
export const CLAUDE_DIR = join(PROJECT_ROOT, ".claude");
// Execute tsx from the orchestrator's node_modules so we don't depend on a global install.
// Use cli.mjs instead of bin/tsx so it is compatible with different OS versions.
export const TSX = join(ORCH_DIR, "node_modules", "tsx", "dist", "cli.mjs");
// If pipeline data dir is provided
export const DATA_DIR = process.env.PIPELINE_DATA_DIR
  ? resolve(PROJECT_ROOT, process.env.PIPELINE_DATA_DIR)
  : ORCH_DIR;
export const RUNS_DIR = join(DATA_DIR, "runs");
export const RESPONSES_DIR = join(DATA_DIR, "responses");
