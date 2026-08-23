/**
 * Client for the local scan bridge (see `scan-bridge/`).
 *
 * Browsers have no scanner API — eSCL devices send no CORS headers and
 * WIA/TWAIN/SANE are OS driver interfaces — so acquisition goes through a small
 * helper on localhost. Everything here degrades to "no bridge" cleanly, because
 * the app must stay fully usable as a plain upload tool without it.
 */

export const BRIDGE_URL =
  process.env.NEXT_PUBLIC_SCAN_BRIDGE?.replace(/\/+$/, "") ?? "http://127.0.0.1:7878";

export interface BridgeHealth {
  ok: boolean;
  version: string;
  platform: string;
  wiaAvailable: boolean;
}

export interface ScannerDevice {
  id: string;
  name: string;
  transport: "escl" | "wia";
  discovered: boolean;
}

export interface SourceCaps {
  maxWidth: number;
  maxHeight: number;
  colorModes: string[];
  resolutions: number[];
  formats: string[];
}

export interface ScannerInfo {
  id: string;
  name: string;
  transport: "escl" | "wia";
  makeAndModel: string;
  serial: string | null;
  duplex: boolean;
  sources: string[];
  caps: Record<string, SourceCaps>;
}

export interface ScanRequest {
  deviceId: string;
  source: string;
  resolution: number;
  colorMode: string;
  paperSize: string;
}

export const COLOR_MODE_LABELS: Record<string, string> = {
  RGB24: "Colour",
  Grayscale8: "Greyscale",
  BlackAndWhite1: "Black & white",
};

export const SOURCE_LABELS: Record<string, string> = {
  Platen: "Flatbed glass",
  Feeder: "Document feeder (ADF)",
};

export const PAPER_SIZE_OPTIONS = [
  { value: "a4", label: "A4" },
  { value: "letter", label: "Letter" },
  { value: "legal", label: "Legal" },
  { value: "a5", label: "A5" },
  { value: "max", label: "Scanner maximum" },
];

async function bridgeFetch(path: string, init?: RequestInit & { timeoutMs?: number }) {
  const { timeoutMs = 15000, ...rest } = init ?? {};
  const res = await fetch(`${BRIDGE_URL}${path}`, {
    ...rest,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok && res.status !== 204) {
    let message = `Bridge returned HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      /* keep the status-code message */
    }
    throw new Error(message);
  }
  return res;
}

/** Returns null when no bridge is running — the normal, expected case. */
export async function checkBridge(): Promise<BridgeHealth | null> {
  try {
    const res = await bridgeFetch("/health", { timeoutMs: 2500 });
    return (await res.json()) as BridgeHealth;
  } catch {
    return null;
  }
}

export async function listDevices(): Promise<ScannerDevice[]> {
  const res = await bridgeFetch("/devices", { timeoutMs: 20000 });
  const body = (await res.json()) as { devices: ScannerDevice[] };
  return body.devices ?? [];
}

export async function getCapabilities(deviceId: string): Promise<ScannerInfo> {
  const res = await bridgeFetch(`/devices/${encodeURIComponent(deviceId)}/capabilities`);
  return (await res.json()) as ScannerInfo;
}

/** Add a scanner mDNS could not see, by IP or hostname. */
export async function probeHost(host: string): Promise<ScannerDevice> {
  const res = await bridgeFetch("/devices/probe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ host }),
    timeoutMs: 20000,
  });
  const body = (await res.json()) as { device: ScannerDevice };
  return body.device;
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

function scanFilename(index: number, mime: string): string {
  const d = new Date();
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  const ext = mime.includes("png") ? "png" : "jpg";
  return `scan-${stamp}-${pad(index, 3)}.${ext}`;
}

/**
 * Run a scan, yielding each page as it comes off the device.
 *
 * Pages stream rather than arriving in one payload so a full feeder tray never
 * has to sit in memory, and so the UI can show pages appearing one by one.
 */
export async function* scanPages(
  request: ScanRequest,
  signal?: AbortSignal,
): AsyncGenerator<File, void, unknown> {
  const res = await bridgeFetch("/scan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    timeoutMs: 30000,
  });
  const { jobId } = (await res.json()) as { jobId: string };

  let index = 0;
  try {
    for (;;) {
      if (signal?.aborted) break;
      // A page can take a while: the lamp warms up, the carriage travels.
      const page = await bridgeFetch(`/jobs/${jobId}/next`, { timeoutMs: 180000 });
      if (page.status === 204) break;
      const blob = await page.blob();
      const mime = blob.type || "image/png";
      index += 1;
      yield new File([blob], scanFilename(index, mime), { type: mime });
    }
  } finally {
    if (signal?.aborted) {
      // Best-effort: tell the device to stop rather than leaving it spinning.
      void fetch(`${BRIDGE_URL}/jobs/${jobId}`, { method: "DELETE" }).catch(() => {});
    }
  }
}
