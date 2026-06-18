import { createServer, IncomingMessage, ServerResponse } from "http";
import {
  readdirSync,
  readFileSync,
  existsSync,
  mkdirSync,
  writeFileSync,
  watch,
} from "fs";
import { join } from "path";
import { spawn } from "child_process";
import {
  DATA_DIR,
  PROJECT_ROOT,
  CLAUDE_DIR,
  RUNS_DIR,
  TSX,
} from "./common/paths";

// Shared path constants (ORCH_DIR, PROJECT_ROOT, CLAUDE_DIR, TSX, DATA_DIR,
// RUNS_DIR, RESPONSES_DIR) are imported from ./common/paths. File-specific ones:
const INTERACTIONS_DIR = join(DATA_DIR, "interactions");
const RESPONSES_DIR = join(DATA_DIR, "responses");
const PIPELINE_SCRIPT = join(__dirname, "pipeline.ts");
const PORT = parseInt(process.env.PIPELINE_DASHBOARD_PORT ?? "4242", 10);

if (!existsSync(CLAUDE_DIR)) {
  console.error(
    `[orchestrator] FATAL: .claude directory not found at ${CLAUDE_DIR}`,
  );
  console.error(
    "The prototype-orchestrator/ folder must sit next to .claude/ in the repo root.",
  );
  process.exit(1);
}

mkdirSync(RUNS_DIR, { recursive: true });
mkdirSync(INTERACTIONS_DIR, { recursive: true });
mkdirSync(RESPONSES_DIR, { recursive: true });

// ─── SSE clients ──────────────────────────────────────────────────────────────

const sseClients = new Set<ServerResponse>();

function broadcastRuns() {
  if (sseClients.size === 0) return;
  const payload = `data: ${JSON.stringify(getRuns())}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch {
      sseClients.delete(client);
    }
  }
}

watch(RUNS_DIR, { persistent: false }, () => setTimeout(broadcastRuns, 100));
watch(INTERACTIONS_DIR, { persistent: false }, () =>
  setTimeout(broadcastRuns, 100),
);

// ─── Data helpers ─────────────────────────────────────────────────────────────

function loadInteractions(threadId: string): any | null {
  const p = join(INTERACTIONS_DIR, `${threadId}.json`);
  try {
    return existsSync(p) ? JSON.parse(readFileSync(p, "utf-8")) : null;
  } catch {
    return null;
  }
}

function getRuns() {
  if (!existsSync(RUNS_DIR)) return [];
  return readdirSync(RUNS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        const run = JSON.parse(readFileSync(join(RUNS_DIR, f), "utf-8"));
        const interactions = loadInteractions(run.threadId);
        if (interactions) run.humanInteractions = interactions;
        return run;
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a: any, b: any) => b.createdAt.localeCompare(a.createdAt));
}

// ─── Server ───────────────────────────────────────────────────────────────────

createServer((req: IncomingMessage, res: ServerResponse) => {
  // SSE
  if (req.url === "/api/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(`data: ${JSON.stringify(getRuns())}\n\n`);
    sseClients.add(res);
    const ping = setInterval(() => {
      try {
        res.write(":ping\n\n");
      } catch {
        /* closed */
      }
    }, 25000);
    req.on("close", () => {
      clearInterval(ping);
      sseClients.delete(res);
    });
    return;
  }

  // Run list
  if (req.url === "/api/runs") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(getRuns()));
    return;
  }

  // Single run
  if (req.url?.startsWith("/api/runs/") && req.method === "GET") {
    const threadId = req.url.slice("/api/runs/".length);
    const path = join(RUNS_DIR, `${threadId}.json`);
    if (!existsSync(path)) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const run = JSON.parse(readFileSync(path, "utf-8"));
    const interactions = loadInteractions(threadId);
    if (interactions) run.humanInteractions = interactions;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(run));
    return;
  }

  // Start pipeline
  if (req.method === "POST" && req.url === "/api/pipeline/start") {
    let body = "";
    req.on("data", (c: Buffer) => (body += c));
    req.on("end", () => {
      try {
        const { flowName, scope } = JSON.parse(body);
        const args = [TSX, PIPELINE_SCRIPT, "start", flowName];
        if (scope && scope !== "auto") args.push("--scope", scope);
        const child = spawn("node", args, {
          cwd: PROJECT_ROOT,
          detached: true,
          stdio: "ignore",
          env: { ...process.env },
        });
        child.unref();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch (e: any) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // Respond to interrupt
  if (req.method === "POST" && req.url?.startsWith("/api/pipeline/respond/")) {
    const threadId = req.url.slice("/api/pipeline/respond/".length);
    let body = "";
    req.on("data", (c: Buffer) => (body += c));
    req.on("end", () => {
      try {
        const { interruptKey, response } = JSON.parse(body);
        const responsePath = join(
          RESPONSES_DIR,
          `${threadId}-${interruptKey}.json`,
        );
        writeFileSync(
          responsePath,
          JSON.stringify({ response, timestamp: new Date().toISOString() }),
        );
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch (e: any) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // Rerun failed step
  if (req.method === "POST" && req.url?.startsWith("/api/pipeline/rerun/")) {
    const threadId = req.url.slice("/api/pipeline/rerun/".length);
    const path = join(RUNS_DIR, `${threadId}.json`);
    if (!existsSync(path)) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const child = spawn("node", [TSX, PIPELINE_SCRIPT, "rerun", threadId], {
      cwd: PROJECT_ROOT,
      detached: true,
      stdio: "ignore",
      env: { ...process.env },
    });
    child.unref();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // Dashboard HTML
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(HTML);
}).listen(PORT, () => {
  console.log(`Pipeline dashboard: http://localhost:${PORT}`);
});

const HTML = readFileSync(join(__dirname, "dashboard.html"), "utf-8");
