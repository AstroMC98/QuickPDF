"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { IconScan, IconSpinner, IconX } from "./Icons";
import type { ImageOrigin } from "@/lib/types";
import {
  BRIDGE_URL,
  COLOR_MODE_LABELS,
  PAPER_SIZE_OPTIONS,
  SOURCE_LABELS,
  checkBridge,
  getCapabilities,
  listDevices,
  probeHost,
  scanPages,
  type BridgeHealth,
  type ScannerDevice,
  type ScannerInfo,
} from "@/lib/scanner";

interface Props {
  /** Called for each page as it comes off the scanner, with its provenance. */
  onPages: (files: File[], origin?: ImageOrigin) => void | Promise<void>;
  disabled: boolean;
}

const control =
  "w-full rounded-md border border-[var(--line)] bg-[var(--surface)] px-2 py-1.5 text-sm outline-none focus:border-indigo-500";

type Status = "checking" | "offline" | "online";

export default function ScanPanel({ onPages, disabled }: Props) {
  const [status, setStatus] = useState<Status>("checking");
  const [health, setHealth] = useState<BridgeHealth | null>(null);
  const [devices, setDevices] = useState<ScannerDevice[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [fetchedInfo, setFetchedInfo] = useState<ScannerInfo | null>(null);
  // Derived rather than cleared in an effect: capabilities belong to a specific
  // scanner, so a stale object simply stops matching when the device changes.
  const info = fetchedInfo && fetchedInfo.id === deviceId ? fetchedInfo : null;

  const [source, setSource] = useState("Platen");
  const [resolution, setResolution] = useState(300);
  const [colorMode, setColorMode] = useState("RGB24");
  const [paperSize, setPaperSize] = useState("a4");

  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [manualHost, setManualHost] = useState("");
  const [showManual, setShowManual] = useState(false);

  const abortRef = useRef<AbortController | null>(null);

  const refreshDevices = useCallback(async () => {
    try {
      const found = await listDevices();
      setDevices(found);
      setDeviceId((current) => (current && found.some((d) => d.id === current) ? current : (found[0]?.id ?? "")));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  /** Awaits before touching state, so mounting never cascades renders. */
  const probeBridge = useCallback(async () => {
    const found = await checkBridge();
    if (!found) {
      setStatus("offline");
      setHealth(null);
      return;
    }
    setHealth(found);
    setStatus("online");
    await refreshDevices();
  }, [refreshDevices]);

  const retry = useCallback(() => {
    setStatus("checking");
    setError(null);
    void probeBridge();
  }, [probeBridge]);

  useEffect(() => {
    // The bridge is an external system and this is a one-shot probe of it: the
    // first thing probeBridge does is await, so no state is set synchronously.
    // The lint rule is static and cannot see that ordering.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void probeBridge();
  }, [probeBridge]);

  // Capabilities differ per source, so re-fetch and re-clamp whenever the
  // chosen device changes — a resolution valid on one scanner may not exist
  // on the next.
  useEffect(() => {
    if (!deviceId || status !== "online") return;
    let cancelled = false;
    (async () => {
      try {
        const caps = await getCapabilities(deviceId);
        if (cancelled) return;
        setFetchedInfo(caps);
        const nextSource = caps.sources.includes(source) ? source : caps.sources[0];
        setSource(nextSource);
        const sourceCaps = caps.caps[nextSource];
        if (sourceCaps) {
          setResolution((r) => (sourceCaps.resolutions.includes(r) ? r : (sourceCaps.resolutions.find((x) => x >= 300) ?? sourceCaps.resolutions.at(-1) ?? 300)));
          setColorMode((c) => (sourceCaps.colorModes.includes(c) ? c : (sourceCaps.colorModes.includes("RGB24") ? "RGB24" : sourceCaps.colorModes[0])));
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
    // `source` is intentionally omitted: including it would refetch on every
    // source change and fight the clamping this effect performs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId, status]);

  const sourceCaps = info?.caps[source] ?? null;

  const runScan = useCallback(async () => {
    if (!deviceId) return;
    setScanning(true);
    setScanned(0);
    setError(null);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      // Recorded on every page so exported metadata can say how it was made.
      const origin: ImageOrigin = {
        kind: "scan",
        scanner: info?.name ?? "Scanner",
        source: SOURCE_LABELS[source] ?? source,
        resolution,
        colorMode: COLOR_MODE_LABELS[colorMode] ?? colorMode,
        scannedAt: new Date().toISOString(),
      };
      let count = 0;
      for await (const file of scanPages({ deviceId, source, resolution, colorMode, paperSize }, controller.signal)) {
        count += 1;
        setScanned(count);
        await onPages([file], origin);
      }
      if (count === 0) {
        setError(
          source === "Feeder"
            ? "The feeder returned no pages — check the tray is loaded."
            : "The scanner returned no pages.",
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setScanning(false);
      abortRef.current = null;
    }
  }, [deviceId, source, resolution, colorMode, paperSize, onPages, info]);

  const addManual = useCallback(async () => {
    const host = manualHost.trim();
    if (!host) return;
    setError(null);
    try {
      const device = await probeHost(host);
      setManualHost("");
      setShowManual(false);
      await refreshDevices();
      setDeviceId(device.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [manualHost, refreshDevices]);

  /* ---------------- offline ---------------- */

  if (status === "checking") {
    return (
      <p className="flex items-center gap-2 text-sm text-[var(--ink-soft)]">
        <IconSpinner className="h-4 w-4" /> Looking for the scan bridge…
      </p>
    );
  }

  if (status === "offline") {
    // A refused origin comes back as a bare network error — the 403 carries no
    // CORS header, so the browser will not let us read it. We therefore cannot
    // tell "blocked" from "not running", and instead show the command that
    // covers both for wherever this page happens to be served from.
    const origin = typeof window === "undefined" ? "" : window.location.origin;
    const servedLocally = /^https?:\/\/(localhost|127\.0\.0\.1)(:|$)/.test(origin);
    const command = servedLocally
      ? "npm run scan-bridge"
      : `npm run scan-bridge -- --allow-origin ${origin}`;

    return (
      <div className="space-y-2 text-sm">
        <p className="text-[var(--ink-soft)]">
          No scan bridge reachable. Browsers have no scanner API, so QuickPDF talks to a small
          helper running on the machine the scanner is plugged into.
        </p>
        <pre className="overflow-x-auto rounded-md bg-[var(--surface)] px-2 py-1.5 font-mono text-[11px]">
          {command}
        </pre>
        <p className="text-[11px] leading-snug text-[var(--ink-soft)]">
          {servedLocally ? (
            <>
              Run that in the project, then press Retry. Expected at{" "}
              <code className="font-mono">{BRIDGE_URL}</code>.
            </>
          ) : (
            <>
              Run that on your own machine from a clone of the project, then press Retry. The
              bridge only answers origins you name, which is why this page has to be listed. Your
              browser may also ask permission to reach a local network device.
            </>
          )}
        </p>
        <button
          type="button"
          onClick={retry}
          className="w-full rounded-md border border-[var(--line)] px-3 py-1.5 text-sm font-medium hover:border-indigo-500 hover:text-indigo-600"
        >
          Retry
        </button>
      </div>
    );
  }

  /* ---------------- online ---------------- */

  return (
    <div className="space-y-3">
      {devices.length === 0 ? (
        <p className="text-sm text-[var(--ink-soft)]">
          Bridge is running but found no scanners
          {health?.wiaAvailable ? "" : " (Windows-installed scanners need the bridge on Windows)"}.
        </p>
      ) : (
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-[var(--ink-soft)]">Scanner</span>
          <select className={control} value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
            {devices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} {d.transport === "wia" ? "(Windows)" : "(network)"}
              </option>
            ))}
          </select>
        </label>
      )}

      {info && sourceCaps && (
        <>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-[var(--ink-soft)]">Source</span>
            <select className={control} value={source} onChange={(e) => setSource(e.target.value)}>
              {info.sources.map((s) => (
                <option key={s} value={s}>
                  {SOURCE_LABELS[s] ?? s}
                </option>
              ))}
            </select>
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-[var(--ink-soft)]">Resolution</span>
              <select
                className={control}
                value={resolution}
                onChange={(e) => setResolution(Number(e.target.value))}
              >
                {sourceCaps.resolutions.map((r) => (
                  <option key={r} value={r}>
                    {r} DPI
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-[var(--ink-soft)]">Colour</span>
              <select className={control} value={colorMode} onChange={(e) => setColorMode(e.target.value)}>
                {sourceCaps.colorModes.map((c) => (
                  <option key={c} value={c}>
                    {COLOR_MODE_LABELS[c] ?? c}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-[var(--ink-soft)]">Page size</span>
            <select className={control} value={paperSize} onChange={(e) => setPaperSize(e.target.value)}>
              {PAPER_SIZE_OPTIONS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void runScan()}
              disabled={scanning || disabled || !deviceId}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 font-semibold text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {scanning ? <IconSpinner /> : <IconScan />}
              {scanning
                ? scanned > 0
                  ? `Scanned ${scanned}…`
                  : "Scanning…"
                : source === "Feeder"
                  ? "Scan feeder"
                  : "Scan page"}
            </button>
            {scanning && (
              <button
                type="button"
                onClick={() => abortRef.current?.abort()}
                title="Stop scanning"
                className="rounded-lg border border-[var(--line)] px-3 text-[var(--ink-soft)] hover:border-red-500 hover:text-red-600"
              >
                <IconX />
              </button>
            )}
          </div>

          {source === "Feeder" && !scanning && (
            <p className="text-[11px] text-[var(--ink-soft)]">
              Scans the whole tray; each sheet lands as its own page.
            </p>
          )}
        </>
      )}

      {error && (
        <p className="rounded-md border border-red-300 bg-red-50 px-2 py-1.5 text-[11px] text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {error}
        </p>
      )}

      <div className="flex items-center gap-2 text-[11px]">
        <button
          type="button"
          onClick={() => void refreshDevices()}
          className="text-[var(--ink-soft)] underline underline-offset-2 hover:text-indigo-600"
        >
          Rescan for devices
        </button>
        <span className="text-[var(--line)]">|</span>
        <button
          type="button"
          onClick={() => setShowManual((v) => !v)}
          className="text-[var(--ink-soft)] underline underline-offset-2 hover:text-indigo-600"
        >
          Add by IP
        </button>
      </div>

      {showManual && (
        <div className="space-y-1">
          <div className="flex gap-2">
            <input
              className={control}
              placeholder="192.168.1.50"
              value={manualHost}
              onChange={(e) => setManualHost(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void addManual();
              }}
            />
            <button
              type="button"
              onClick={() => void addManual()}
              className="shrink-0 rounded-md border border-[var(--line)] px-3 py-1.5 text-sm font-medium hover:border-indigo-500 hover:text-indigo-600"
            >
              Add
            </button>
          </div>
          <p className="text-[11px] text-[var(--ink-soft)]">
            For scanners on another subnet, or where multicast discovery is blocked.
          </p>
        </div>
      )}
    </div>
  );
}
