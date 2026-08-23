import { Bonjour } from "bonjour-service";

/**
 * Find eSCL scanners on the local network over mDNS.
 *
 * `_uscan._tcp` is plain-HTTP eSCL; `_uscans._tcp` is the TLS variant that
 * newer HP and Canon firmware advertises exclusively.
 */
export function startDiscovery({ onFound, onLost }) {
  const bonjour = new Bonjour();
  const browsers = [];

  for (const [type, secure] of [["uscan", false], ["uscans", true]]) {
    const browser = bonjour.find({ type, protocol: "tcp" });
    browser.on("up", (service) => {
      const device = toDevice(service, secure);
      if (device) onFound(device);
    });
    // Without this a scanner that is switched off lingers in the list forever
    // and the next scan attempt fails with a connection error.
    browser.on("down", (service) => {
      const device = toDevice(service, secure);
      if (device) onLost(device.id);
    });
    browsers.push(browser);
  }

  return {
    refresh: () => browsers.forEach((b) => b.update()),
    stop: () => {
      browsers.forEach((b) => b.stop());
      bonjour.destroy();
    },
  };
}

function toDevice(service, secure) {
  const host =
    (service.addresses ?? []).find((a) => /^\d+\.\d+\.\d+\.\d+$/.test(a)) ??
    service.referer?.address ??
    service.host;
  if (!host) return null;

  // The `rs` TXT key carries the resource path; virtually every device uses
  // "eSCL", but the record is authoritative when present.
  const rs = String(service.txt?.rs ?? "eSCL").replace(/^\/+/, "");
  const scheme = secure ? "https" : "http";

  return {
    id: `escl:${host}:${service.port}`,
    name: String(service.txt?.ty ?? service.name ?? "Network scanner"),
    transport: "escl",
    base: `${scheme}://${host}:${service.port}/${rs}`,
    discovered: true,
  };
}
