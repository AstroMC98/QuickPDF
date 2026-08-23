/**
 * A fake eSCL scanner, for developing and testing the bridge without hardware.
 *
 *   node scan-bridge/mock-scanner.mjs --port 8081 --pages 3
 *
 * It implements the same three endpoints a real device does
 * (ScannerCapabilities, ScanJobs, NextDocument) and returns generated PNG
 * pages, so the whole path — protocol client, bridge, UI — runs for real.
 */

import http from "node:http";
import { deflateSync } from "node:zlib";
import { Bonjour } from "bonjour-service";

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((a, i, all) =>
    a.startsWith("--") ? [[a.slice(2), all[i + 1]?.startsWith("--") ? "true" : all[i + 1]]] : [],
  ),
);
const PORT = Number(args.port ?? 8081);
const PAGES = Number(args.pages ?? 3);
const ADVERTISE = args.advertise !== "false";

/* ---------------- PNG generation ---------------- */

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

/** A page with a distinct colour band per page number, so order is visible. */
function makePage(width, height, pageNo) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2; // truecolour RGB
  const hues = [
    [220, 38, 38], [37, 99, 235], [22, 163, 74],
    [202, 138, 4], [124, 58, 237], [219, 39, 119],
  ];
  const [r, g, b] = hues[(pageNo - 1) % hues.length];
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    const row = y * (1 + width * 3);
    raw[row] = 0;
    for (let x = 0; x < width; x++) {
      const o = row + 1 + x * 3;
      // Band count equals the page number — countable in a screenshot.
      const band = Math.floor((y / height) * 12) % 2 === 0 && x < (width * pageNo) / PAGES;
      raw[o] = band ? r : 250;
      raw[o + 1] = band ? g : 250;
      raw[o + 2] = band ? b : 250;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* ---------------- eSCL surface ---------------- */

const CAPABILITIES = `<?xml version="1.0" encoding="UTF-8"?>
<scan:ScannerCapabilities xmlns:pwg="http://www.pwg.org/schemas/2010/12/sm" xmlns:scan="http://schemas.hp.com/imaging/escl/2011/05/03">
  <pwg:Version>2.6</pwg:Version>
  <pwg:MakeAndModel>QuickPDF Mock Scanner</pwg:MakeAndModel>
  <pwg:SerialNumber>MOCK-0001</pwg:SerialNumber>
  <scan:Platen>
    <scan:PlatenInputCaps>
      <scan:MinWidth>16</scan:MinWidth>
      <scan:MaxWidth>2550</scan:MaxWidth>
      <scan:MaxHeight>3508</scan:MaxHeight>
      <scan:SettingProfiles>
        <scan:SettingProfile>
          <scan:ColorModes>
            <scan:ColorMode>BlackAndWhite1</scan:ColorMode>
            <scan:ColorMode>Grayscale8</scan:ColorMode>
            <scan:ColorMode>RGB24</scan:ColorMode>
          </scan:ColorModes>
          <scan:DocumentFormats>
            <pwg:DocumentFormat>image/jpeg</pwg:DocumentFormat>
            <pwg:DocumentFormat>image/png</pwg:DocumentFormat>
          </scan:DocumentFormats>
          <scan:SupportedResolutions>
            <scan:DiscreteResolutions>
              <scan:DiscreteResolution><scan:XResolution>75</scan:XResolution><scan:YResolution>75</scan:YResolution></scan:DiscreteResolution>
              <scan:DiscreteResolution><scan:XResolution>150</scan:XResolution><scan:YResolution>150</scan:YResolution></scan:DiscreteResolution>
              <scan:DiscreteResolution><scan:XResolution>300</scan:XResolution><scan:YResolution>300</scan:YResolution></scan:DiscreteResolution>
              <scan:DiscreteResolution><scan:XResolution>600</scan:XResolution><scan:YResolution>600</scan:YResolution></scan:DiscreteResolution>
            </scan:DiscreteResolutions>
          </scan:SupportedResolutions>
        </scan:SettingProfile>
      </scan:SettingProfiles>
    </scan:PlatenInputCaps>
  </scan:Platen>
  <scan:Adf>
    <scan:AdfSimplexInputCaps>
      <scan:MaxWidth>2550</scan:MaxWidth>
      <scan:MaxHeight>4200</scan:MaxHeight>
      <scan:SettingProfiles>
        <scan:SettingProfile>
          <scan:ColorModes>
            <scan:ColorMode>Grayscale8</scan:ColorMode>
            <scan:ColorMode>RGB24</scan:ColorMode>
          </scan:ColorModes>
          <scan:SupportedResolutions>
            <scan:DiscreteResolutions>
              <scan:DiscreteResolution><scan:XResolution>200</scan:XResolution><scan:YResolution>200</scan:YResolution></scan:DiscreteResolution>
              <scan:DiscreteResolution><scan:XResolution>300</scan:XResolution><scan:YResolution>300</scan:YResolution></scan:DiscreteResolution>
            </scan:DiscreteResolutions>
          </scan:SupportedResolutions>
        </scan:SettingProfile>
      </scan:SettingProfiles>
    </scan:AdfSimplexInputCaps>
    <scan:AdfDuplexInputCaps/>
  </scan:Adf>
</scan:ScannerCapabilities>`;

const jobs = new Map();
let jobSeq = 0;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname.replace(/\/+$/, "");

  if (req.method === "GET" && path === "/eSCL/ScannerCapabilities") {
    res.writeHead(200, { "Content-Type": "text/xml" }).end(CAPABILITIES);
    return;
  }

  if (req.method === "POST" && path === "/eSCL/ScanJobs") {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks).toString("utf8");
    const source = /<[\w:]*InputSource>([^<]+)</i.exec(body)?.[1] ?? "Platen";
    // A flatbed yields exactly one page; the feeder yields the whole stack.
    const total = source === "Feeder" ? PAGES : 1;
    const id = `job${++jobSeq}`;
    jobs.set(id, { served: 0, total, source });
    console.log(`[mock] job ${id}: source=${source}, will yield ${total} page(s)`);
    res
      .writeHead(201, { Location: `http://${req.headers.host}/eSCL/ScanJobs/${id}` })
      .end();
    return;
  }

  const nextMatch = /^\/eSCL\/ScanJobs\/([^/]+)\/NextDocument$/.exec(path);
  if (req.method === "GET" && nextMatch) {
    const job = jobs.get(nextMatch[1]);
    if (!job) {
      res.writeHead(404).end();
      return;
    }
    if (job.served >= job.total) {
      console.log(`[mock] job ${nextMatch[1]}: exhausted`);
      res.writeHead(404).end();
      return;
    }
    job.served += 1;
    const png = makePage(600, 840, job.served);
    console.log(`[mock] job ${nextMatch[1]}: serving page ${job.served}/${job.total}`);
    res.writeHead(200, { "Content-Type": "image/png", "Content-Length": png.length }).end(png);
    return;
  }

  const jobMatch = /^\/eSCL\/ScanJobs\/([^/]+)$/.exec(path);
  if (req.method === "DELETE" && jobMatch) {
    jobs.delete(jobMatch[1]);
    res.writeHead(200).end();
    return;
  }

  res.writeHead(404).end("not found");
});

// Binds to all interfaces so the address it advertises over mDNS is actually
// reachable — it only ever serves generated test pages.
server.listen(PORT, "0.0.0.0", () => {
  console.log(`[mock] eSCL scanner on http://127.0.0.1:${PORT}/eSCL (${PAGES} feeder pages)`);
  if (ADVERTISE) {
    const bonjour = new Bonjour();
        // mDNS instance names must be unique on the network, so key it by port —
    // two mocks running at once would otherwise collide into one record.
    const instance = `QuickPDF Mock Scanner ${PORT}`;
    bonjour.publish({ name: instance, type: "uscan", protocol: "tcp", port: PORT, txt: { rs: "eSCL", ty: instance } });
    console.log("[mock] advertising over mDNS as _uscan._tcp");
    process.on("SIGINT", () => { bonjour.destroy(); process.exit(0); });
  }
});
