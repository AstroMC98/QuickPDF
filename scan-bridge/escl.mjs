import { request } from "./http.mjs";

/**
 * eSCL (a.k.a. AirScan / Mopria Scan) client.
 *
 * eSCL is the vendor-neutral REST protocol that essentially every network MFP
 * built since ~2013 speaks. A browser cannot call it directly — the scanner
 * sends no CORS headers — which is the entire reason this bridge exists.
 *
 * Spatial units in the protocol are 1/300th of an inch, regardless of the
 * scan resolution. They are called "threehundredths" throughout.
 */

const PWG = "http://www.pwg.org/schemas/2010/12/sm";
const SCAN_NS = "http://schemas.hp.com/imaging/escl/2011/05/03";

/* ---------------- tiny XML reader ---------------- */

// Namespace prefixes vary by vendor (scan:, pwg:, none), so match any prefix.
const tagPattern = (name) =>
  new RegExp(`<(?:[\\w.-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w.-]+:)?${name}>`, "i");
const tagPatternAll = (name) =>
  new RegExp(`<(?:[\\w.-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w.-]+:)?${name}>`, "gi");

function firstTag(xml, name) {
  const m = tagPattern(name).exec(xml ?? "");
  return m ? m[1].trim() : null;
}

function allTags(xml, name) {
  const out = [];
  const re = tagPatternAll(name);
  let m;
  while ((m = re.exec(xml ?? "")) !== null) out.push(m[1].trim());
  return out;
}

/** Also matches self-closing elements — `<scan:AdfDuplexInputCaps/>` is how
 *  several vendors advertise a capability that carries no child values. */
function hasTag(xml, name) {
  if (tagPattern(name).test(xml ?? "")) return true;
  return new RegExp(`<(?:[\\w.-]+:)?${name}(?:\\s[^>]*)?/>`, "i").test(xml ?? "");
}

const escapeXml = (s) =>
  String(s).replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]);

/* ---------------- capabilities ---------------- */

function parseInputCaps(xml) {
  if (!xml) return null;
  // A source can advertise several setting profiles; union them so the UI
  // offers everything the device can actually do.
  const profiles = allTags(xml, "SettingProfile");
  const pool = profiles.length ? profiles.join("\n") : xml;

  const colorModes = [...new Set(allTags(pool, "ColorMode"))];
  const resolutions = [
    ...new Set(allTags(pool, "DiscreteResolution").map((r) => Number(firstTag(r, "XResolution")))),
  ]
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);
  const formats = [...new Set([...allTags(pool, "DocumentFormat"), ...allTags(pool, "DocumentFormatExt")])];

  return {
    maxWidth: Number(firstTag(xml, "MaxWidth")) || 2550,
    maxHeight: Number(firstTag(xml, "MaxHeight")) || 3508,
    colorModes: colorModes.length ? colorModes : ["RGB24"],
    resolutions: resolutions.length ? resolutions : [300],
    formats: formats.length ? formats : ["image/jpeg"],
  };
}

export function parseCapabilities(xml) {
  const platenCaps = parseInputCaps(firstTag(xml, "PlatenInputCaps"));
  const adfXml = firstTag(xml, "Adf");
  const adfCaps = adfXml
    ? parseInputCaps(firstTag(adfXml, "AdfSimplexInputCaps") ?? adfXml)
    : null;

  const sources = [];
  if (platenCaps || hasTag(xml, "Platen")) sources.push("Platen");
  if (adfCaps) sources.push("Feeder");

  return {
    makeAndModel: firstTag(xml, "MakeAndModel") ?? "Network scanner",
    serial: firstTag(xml, "SerialNumber") ?? null,
    duplex: !!(adfXml && hasTag(adfXml, "AdfDuplexInputCaps")),
    sources: sources.length ? sources : ["Platen"],
    caps: {
      Platen: platenCaps ?? parseInputCaps("<x/>"),
      ...(adfCaps ? { Feeder: adfCaps } : {}),
    },
  };
}

export async function getCapabilities(base) {
  const res = await request(`${base}/ScannerCapabilities`, { timeout: 8000 });
  if (res.status !== 200) throw new Error(`ScannerCapabilities returned HTTP ${res.status}`);
  return parseCapabilities(res.text);
}

/**
 * Probe a host for an eSCL endpoint. Scanners are inconsistent about which
 * scheme/port they answer on, so try the usual combinations.
 */
export async function probe(host) {
  const candidates = host.includes(":")
    ? [`http://${host}/eSCL`, `https://${host}/eSCL`]
    : [`http://${host}/eSCL`, `https://${host}/eSCL`, `http://${host}:8080/eSCL`];

  const failures = [];
  for (const base of candidates) {
    try {
      const caps = await getCapabilities(base);
      return { base, caps };
    } catch (err) {
      failures.push(`${base}: ${err.message}`);
    }
  }
  throw new Error(`No eSCL scanner at ${host}. Tried:\n  ${failures.join("\n  ")}`);
}

/* ---------------- scanning ---------------- */

/** Common paper sizes in 1/300th inch, the unit eSCL scan regions use. */
export const PAPER_SIZES = {
  a4: { label: "A4", width: 2480, height: 3508 },
  a5: { label: "A5", width: 1748, height: 2480 },
  letter: { label: "Letter", width: 2550, height: 3300 },
  legal: { label: "Legal", width: 2550, height: 4200 },
  max: { label: "Scanner maximum", width: null, height: null },
};

export function buildScanSettings({ source, resolution, colorMode, width, height, format }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<scan:ScanSettings xmlns:pwg="${PWG}" xmlns:scan="${SCAN_NS}">
  <pwg:Version>2.6</pwg:Version>
  <pwg:ScanRegions pwg:MustHonor="false">
    <pwg:ScanRegion>
      <pwg:XOffset>0</pwg:XOffset>
      <pwg:YOffset>0</pwg:YOffset>
      <pwg:Width>${Math.round(width)}</pwg:Width>
      <pwg:Height>${Math.round(height)}</pwg:Height>
      <pwg:ContentRegionUnits>escl:ThreeHundredthsOfInches</pwg:ContentRegionUnits>
    </pwg:ScanRegion>
  </pwg:ScanRegions>
  <pwg:InputSource>${escapeXml(source)}</pwg:InputSource>
  <scan:ColorMode>${escapeXml(colorMode)}</scan:ColorMode>
  <scan:XResolution>${Math.round(resolution)}</scan:XResolution>
  <scan:YResolution>${Math.round(resolution)}</scan:YResolution>
  <pwg:DocumentFormat>${escapeXml(format)}</pwg:DocumentFormat>
</scan:ScanSettings>`;
}

/** Start a scan job. Returns the absolute job URL to pull pages from. */
export async function startJob(base, settings) {
  const res = await request(`${base}/ScanJobs`, {
    method: "POST",
    headers: { "Content-Type": "text/xml; charset=utf-8" },
    body: Buffer.from(buildScanSettings(settings), "utf8"),
    timeout: 20000,
  });

  if (res.status === 409) {
    throw new Error("The scanner is busy with another job.");
  }
  if (res.status !== 201) {
    throw new Error(`Scanner refused the job (HTTP ${res.status}). ${res.text.slice(0, 200)}`);
  }

  const location = res.headers.location;
  if (!location) throw new Error("Scanner accepted the job but returned no job location.");
  // Some firmware returns a path rather than an absolute URL.
  return location.startsWith("http") ? location : new URL(location, base).href;
}

/**
 * Pull the next page. Returns null when the job has no more pages — which is
 * how a flatbed scan ends after one page, and how an ADF signals an empty tray.
 */
export async function nextDocument(jobUrl) {
  const res = await request(`${jobUrl}/NextDocument`, { timeout: 120000 });

  // 404/410 is the documented "no more pages" signal, not an error.
  if (res.status === 404 || res.status === 410) return null;
  if (res.status === 503) throw new Error("Scanner is warming up or busy; try again.");
  if (res.status !== 200) throw new Error(`NextDocument returned HTTP ${res.status}`);
  if (!res.body.length) return null;

  return {
    mime: String(res.headers["content-type"] ?? "image/jpeg").split(";")[0].trim(),
    bytes: res.body,
  };
}

export async function cancelJob(jobUrl) {
  try {
    await request(jobUrl, { method: "DELETE", timeout: 5000 });
  } catch {
    // Cancelling is best-effort; the job times out on the device anyway.
  }
}
