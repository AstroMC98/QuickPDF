/**
 * QuickPDF scan bridge.
 *
 * A browser page cannot reach a scanner: eSCL devices send no CORS headers, and
 * WIA/TWAIN/SANE are OS driver interfaces with no web equivalent. This is the
 * smallest thing that closes that gap — a localhost HTTP service that speaks
 * eSCL to network MFPs and WIA to Windows-installed scanners, and hands pages
 * back to the page as plain images.
 *
 *   node scan-bridge/server.mjs [--port 7878] [--allow-origin https://example.com]
 *
 * Security: it binds to 127.0.0.1 only, and answers cross-origin requests just
 * for an allowlist (localhost dev ports by default). Without that allowlist any
 * website you happened to visit could start a scan and read the result.
 */

import http from "node:http";
import { randomUUID } from "node:crypto";

import { request } from "./http.mjs";
import * as escl from "./escl.mjs";
import * as wia from "./wia.mjs";
import { startDiscovery } from "./discovery.mjs";

const VERSION = "1.0.0";

/* ---------------- arguments ---------------- */

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--")) return argv[i + 1];
  const inline = argv.find((a) => a.startsWith(`--${name}=`));
  return inline ? inline.slice(name.length + 3) : fallback;
};

const PORT = Number(flag("port", 7878));
const EXTRA_ORIGINS = argv
  .filter((a) => a.startsWith("--allow-origin"))
  .map((a) => (a.includes("=") ? a.split("=")[1] : argv[argv.indexOf(a) + 1]))
  .filter(Boolean);

/** Any localhost port is trusted; anything else must be opted into explicitly. */
function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (EXTRA_ORIGINS.includes(origin)) return true;
  try {
    const { hostname, protocol } = new URL(origin);
    return protocol === "http:" && (hostname === "localhost" || hostname === "127.0.0.1");
  } catch {
    return false;
  }
}

/* ---------------- device registry ---------------- */

/** id -> { id, name, transport, base?, wiaId?, discovered? } */
const devices = new Map();

const discovery = startDiscovery({
  onFound: (device) => {
    if (!devices.has(device.id)) {
      console.log(`[bridge] discovered ${device.name} at ${device.base}`);
    }
    devices.set(device.id, device);
  },
  onLost: (id) => {
    const gone = devices.get(id);
    // Only drop auto-discovered entries; a hand-added scanner stays until the
    // bridge restarts, because the user asserted it exists.
    if (gone?.discovered) {
      console.log(`[bridge] lost ${gone.name}`);
      devices.delete(id);
    }
  },
});

async function refreshWiaDevices() {
  for (const d of await wia.listDevices()) {
    const id = `wia:${d.id}`;
    devices.set(id, { id, name: d.name || "Windows scanner", transport: "wia", wiaId: d.id });
  }
}

/**
 * A scanner switched off abruptly sends no mDNS goodbye, so its record can
 * linger until the TTL expires. Rather than let that surface as a raw socket
 * error, translate it and evict the entry so the list self-heals.
 */
function isUnreachable(err) {
  return /ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|ENOTFOUND|ETIMEDOUT|Timed out/i.test(err.message);
}

async function reachable(device, fn) {
  try {
    return await fn();
  } catch (err) {
    if (isUnreachable(err)) {
      if (device.discovered) devices.delete(device.id);
      throw new Error(
        `${device.name} is not responding — it may be switched off or on another network.`,
      );
    }
    throw err;
  }
}

async function describe(device) {
  if (device.transport === "escl") {
    const caps = await reachable(device, () => escl.getCapabilities(device.base));
    return { ...caps, id: device.id, name: caps.makeAndModel || device.name, transport: "escl" };
  }
  try {
    const caps = await wia.getCapabilities(device.wiaId);
    return { ...caps, id: device.id, name: caps.makeAndModel || device.name, transport: "wia" };
  } catch (err) {
    console.warn(`[bridge] could not query ${device.name}: ${err.message}`);
    return { ...wia.defaultCapabilities(), id: device.id, name: device.name, transport: "wia" };
  }
}

/* ---------------- jobs ---------------- */

/**
 * A job streams pages one at a time so a 20-page feeder run does not have to
 * sit in memory, and so the UI can show progress as pages arrive.
 */
const jobs = new Map();

function newEsclJob(jobUrl) {
  const id = randomUUID();
  jobs.set(id, {
    kind: "escl",
    jobUrl,
    done: false,
    async next() {
      if (this.done) return null;
      const page = await escl.nextDocument(this.jobUrl);
      if (!page) this.done = true;
      return page;
    },
    cancel() {
      this.done = true;
      return escl.cancelJob(this.jobUrl);
    },
  });
  return id;
}

function newWiaJob(settings) {
  const id = randomUUID();
  // Kick the scan off immediately but do not await it — /next awaits the
  // promise, so the client gets a job id back straight away.
  const pending = wia.scan(settings);
  pending.catch(() => {});
  jobs.set(id, {
    kind: "wia",
    index: 0,
    pending,
    async next() {
      const pages = await this.pending;
      return this.index < pages.length ? pages[this.index++] : null;
    },
    cancel() {
      this.index = Number.MAX_SAFE_INTEGER;
    },
  });
  return id;
}

/* ---------------- http ---------------- */

function send(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload));
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": body.length });
  res.end(body);
}

async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("Request body was not valid JSON.");
  }
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  const allowed = isAllowedOrigin(origin);

  if (allowed) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  // Chrome's Private Network Access check: a public HTTPS page reaching
  // localhost must be granted this explicitly during preflight.
  if (req.headers["access-control-request-private-network"] === "true" && allowed) {
    res.setHeader("Access-Control-Allow-Private-Network", "true");
  }

  if (req.method === "OPTIONS") {
    res.writeHead(allowed ? 204 : 403).end();
    return;
  }
  if (origin && !allowed) {
    send(res, 403, {
      error: `Origin ${origin} is not allowed. Restart the bridge with --allow-origin ${origin} if you trust it.`,
    });
    return;
  }

  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const path = url.pathname.replace(/\/+$/, "") || "/";

  try {
    if (req.method === "GET" && (path === "/" || path === "/health")) {
      send(res, 200, {
        ok: true,
        service: "quickpdf-scan-bridge",
        version: VERSION,
        platform: process.platform,
        wiaAvailable: wia.isWindows,
      });
      return;
    }

    if (req.method === "GET" && path === "/devices") {
      await refreshWiaDevices();
      discovery.refresh();
      send(res, 200, {
        devices: [...devices.values()].map(({ id, name, transport, discovered }) => ({
          id,
          name,
          transport,
          discovered: !!discovered,
        })),
      });
      return;
    }

    const capsMatch = /^\/devices\/(.+)\/capabilities$/.exec(path);
    if (req.method === "GET" && capsMatch) {
      const device = devices.get(decodeURIComponent(capsMatch[1]));
      if (!device) return send(res, 404, { error: "Unknown scanner." });
      send(res, 200, await describe(device));
      return;
    }

    // Manual fallback for scanners that mDNS cannot see (different subnet,
    // multicast blocked, or discovery disabled on the device).
    if (req.method === "POST" && path === "/devices/probe") {
      const { host } = await readJson(req);
      if (!host) return send(res, 400, { error: "Provide the scanner's host or IP address." });
      const { base, caps } = await escl.probe(String(host).trim());
      const device = {
        id: `escl:${String(host).trim()}`,
        name: caps.makeAndModel,
        transport: "escl",
        base,
        discovered: false,
      };
      devices.set(device.id, device);
      send(res, 200, { device: { id: device.id, name: device.name, transport: "escl", discovered: false } });
      return;
    }

    if (req.method === "POST" && path === "/scan") {
      const body = await readJson(req);
      const device = devices.get(body.deviceId);
      if (!device) return send(res, 404, { error: "Unknown scanner." });

      const source = body.source === "Feeder" ? "Feeder" : "Platen";
      const paper = escl.PAPER_SIZES[body.paperSize] ?? escl.PAPER_SIZES.a4;
      const info = await describe(device);
      const sourceCaps = info.caps[source] ?? info.caps.Platen;

      const settings = {
        source,
        resolution: Number(body.resolution) || 300,
        colorMode: body.colorMode || "RGB24",
        width: Math.min(paper.width ?? sourceCaps.maxWidth, sourceCaps.maxWidth),
        height: Math.min(paper.height ?? sourceCaps.maxHeight, sourceCaps.maxHeight),
        // PNG is lossless; fall back to JPEG when the device will not emit it.
        format: sourceCaps.formats.includes("image/png") ? "image/png" : "image/jpeg",
      };

      console.log(
        `[bridge] scan on ${device.name}: ${source} ${settings.resolution}dpi ${settings.colorMode}`,
      );

      const jobId =
        device.transport === "escl"
          ? newEsclJob(await reachable(device, () => escl.startJob(device.base, settings)))
          : newWiaJob({ ...settings, deviceId: device.wiaId });

      send(res, 200, { jobId, source, settings });
      return;
    }

    const nextMatch = /^\/jobs\/([^/]+)\/next$/.exec(path);
    if (req.method === "GET" && nextMatch) {
      const job = jobs.get(nextMatch[1]);
      if (!job) return send(res, 404, { error: "Unknown scan job." });
      const page = await job.next();
      if (!page) {
        jobs.delete(nextMatch[1]);
        res.writeHead(204).end();
        return;
      }
      res.writeHead(200, { "Content-Type": page.mime, "Content-Length": page.bytes.length });
      res.end(page.bytes);
      return;
    }

    const jobMatch = /^\/jobs\/([^/]+)$/.exec(path);
    if (req.method === "DELETE" && jobMatch) {
      const job = jobs.get(jobMatch[1]);
      if (job) {
        await job.cancel();
        jobs.delete(jobMatch[1]);
      }
      send(res, 200, { cancelled: true });
      return;
    }

    send(res, 404, { error: `No route for ${req.method} ${path}` });
  } catch (err) {
    console.error(`[bridge] ${req.method} ${path} failed:`, err.message);
    send(res, 500, { error: err.message });
  }
});

/**
 * A busy port is the most likely startup failure — usually a bridge already
 * running from another terminal — so say what happened instead of dumping a
 * stack trace, and check whether the occupant is us.
 */
server.on("error", async (err) => {
  if (err.code !== "EADDRINUSE") {
    console.error(`[bridge] failed to start: ${err.message}`);
    process.exit(1);
  }

  let occupant = null;
  try {
    const res = await request(`http://127.0.0.1:${PORT}/health`, { timeout: 2000 });
    occupant = JSON.parse(res.text);
  } catch {
    // Something is listening but it is not answering /health as we would.
  }

  if (occupant?.service === "quickpdf-scan-bridge") {
    console.log(`[bridge] A QuickPDF scan bridge (v${occupant.version}) is already running on port ${PORT}.`);
    console.log("[bridge] Nothing to do — QuickPDF can use that one. Close this terminal.");
  } else {
    console.error(`[bridge] Port ${PORT} is already in use by something else.`);
    console.error(`[bridge] Start on a different port with:  npm run scan-bridge -- --port 7879`);
    console.error("[bridge] (then set NEXT_PUBLIC_SCAN_BRIDGE=http://127.0.0.1:7879 for the app)");
  }
  discovery.stop();
  process.exit(1);
});

server.listen(PORT, "127.0.0.1", async () => {
  console.log(`[bridge] QuickPDF scan bridge ${VERSION} on http://127.0.0.1:${PORT}`);
  console.log(`[bridge] platform ${process.platform}, WIA ${wia.isWindows ? "available" : "unavailable"}`);
  if (EXTRA_ORIGINS.length) console.log(`[bridge] extra allowed origins: ${EXTRA_ORIGINS.join(", ")}`);
  console.log("[bridge] browsing for eSCL scanners over mDNS…");
  await refreshWiaDevices();
  if (devices.size) console.log(`[bridge] ${devices.size} scanner(s) known at startup`);
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    discovery.stop();
    server.close();
    process.exit(0);
  });
}
