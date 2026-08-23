import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Windows Image Acquisition (WIA) support, driven through PowerShell COM.
 *
 * This covers scanners installed as Windows devices — USB flatbeds and the scan
 * half of an installed printer driver — which eSCL discovery cannot see. There
 * is no npm package for WIA that avoids a native build step, and PowerShell is
 * on every Windows host, so shelling out is the pragmatic choice.
 *
 * Everything here must stay Windows PowerShell 5.1 compatible: `powershell.exe`
 * on Windows 11 is 5.1, where `ConvertTo-Json` has no `-AsArray`.
 */

export const isWindows = process.platform === "win32";

function runPowerShell(script, timeout = 180000) {
  return new Promise((resolve, reject) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      { timeout, maxBuffer: 32 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        const noise = (stderr ?? "").trim();
        if (err) return reject(new Error(noise || err.message));
        // Warnings are not failures, but they explain silently-ignored settings.
        if (noise) console.warn(`[bridge] WIA: ${noise.replace(/\s+/g, " ").slice(0, 400)}`);
        resolve(stdout.trim());
      },
    );
  });
}

/** WIA property ids, named for readability. */
const P = {
  DATA_TYPE: 4103,
  X_RESOLUTION: 6147,
  Y_RESOLUTION: 6148,
  X_POSITION: 6149,
  Y_POSITION: 6150,
  X_EXTENT: 6151,
  Y_EXTENT: 6152,
  DOC_HANDLING_CAPS: 3086,
  DOC_HANDLING_SELECT: 3088,
  HORIZONTAL_BED_SIZE: 3074,
  VERTICAL_BED_SIZE: 3075,
};

/** WIA_DPS_DOCUMENT_HANDLING_CAPABILITIES bits. */
const CAP_FEEDER = 0x01;
const CAP_FLATBED = 0x02;

const DATA_TYPE_TO_MODE = { 0: "BlackAndWhite1", 2: "Grayscale8", 3: "RGB24" };
const MODE_TO_DATA_TYPE = { BlackAndWhite1: 0, Grayscale8: 2, RGB24: 3 };

const psQuote = (s) => String(s).replace(/'/g, "''");

/**
 * Shared PowerShell helper. Clamps range properties and rejects values outside
 * list properties, because WIA answers an out-of-range value with a bare
 * "The parameter is incorrect" that names neither the property nor the limit.
 */
const SET_PROP_FN = `
function Set-Prop($holder, $id, $value, $label) {
  foreach ($p in $holder.Properties) {
    if ($p.PropertyID -eq $id) {
      if ($p.IsReadOnly) { Write-Warning "$label is read-only; left at $($p.Value)"; return }
      $v = $value
      if ($p.SubType -eq 1) {
        if ($v -lt $p.SubTypeMin) { $v = $p.SubTypeMin }
        if ($v -gt $p.SubTypeMax) { $v = $p.SubTypeMax }
      } elseif ($p.SubType -eq 2) {
        $allowed = @(); foreach ($x in $p.SubTypeValues) { $allowed += $x }
        if ($allowed -notcontains $v) {
          Write-Warning "$label=$v unsupported (allowed: $($allowed -join ','))"; return
        }
      }
      try { $p.Value = $v } catch { throw "Could not set $label to $v ($($_.Exception.Message))" }
      return
    }
  }
}
function Get-Prop($holder, $id) {
  foreach ($p in $holder.Properties) { if ($p.PropertyID -eq $id) { return $p.Value } }
  return $null
}
`;

const CONNECT_FN = (deviceId) => `
$dm = New-Object -ComObject WIA.DeviceManager
$info = $null
foreach ($d in $dm.DeviceInfos) { if ($d.DeviceID -eq '${psQuote(deviceId)}') { $info = $d } }
if ($null -eq $info) { throw 'Scanner not found: ${psQuote(deviceId)}' }
$device = $info.Connect()
$item = $device.Items.Item(1)
`;

export async function listDevices() {
  if (!isWindows) return [];
  const script = `
    $ErrorActionPreference = 'Stop'
    $dm = New-Object -ComObject WIA.DeviceManager
    $out = @()
    foreach ($d in $dm.DeviceInfos) {
      if ($d.Type -eq 1) {
        $name = $null
        foreach ($p in $d.Properties) { if ($p.Name -eq 'Name') { $name = $p.Value } }
        $out += [pscustomobject]@{ id = $d.DeviceID; name = $name }
      }
    }
    ConvertTo-Json -InputObject @($out) -Compress
  `;

  let raw;
  try {
    raw = await runPowerShell(script, 30000);
  } catch (err) {
    // Never report a broken script as "no scanners" — that is indistinguishable
    // from a genuinely empty list and hides real failures.
    console.warn(`[bridge] WIA enumeration failed: ${err.message}`);
    return [];
  }

  try {
    const parsed = JSON.parse(raw || "[]");
    return (Array.isArray(parsed) ? parsed : [parsed]).filter((d) => d && d.id);
  } catch {
    console.warn(`[bridge] WIA returned unparseable output: ${raw.slice(0, 200)}`);
    return [];
  }
}

const STANDARD_DPI = [75, 100, 150, 200, 300, 400, 600, 1200];

/**
 * Ask the device what it can actually do, rather than assuming. Without this a
 * flatbed-only scanner is offered a "Document feeder" option that cannot work.
 */
export async function getCapabilities(deviceId) {
  if (!isWindows) throw new Error("WIA is only available on Windows.");
  const script = `
    $ErrorActionPreference = 'Stop'
    ${SET_PROP_FN}
    ${CONNECT_FN(deviceId)}
    $dataTypes = @()
    $resMin = 50; $resMax = 600
    foreach ($p in $item.Properties) {
      if ($p.PropertyID -eq ${P.DATA_TYPE} -and $p.SubType -eq 2) {
        foreach ($x in $p.SubTypeValues) { $dataTypes += [int]$x }
      }
      if ($p.PropertyID -eq ${P.X_RESOLUTION} -and $p.SubType -eq 1) {
        $resMin = [int]$p.SubTypeMin; $resMax = [int]$p.SubTypeMax
      }
    }
    $result = [pscustomobject]@{
      name        = (Get-Prop $device 7)
      handling    = [int](Get-Prop $device ${P.DOC_HANDLING_CAPS})
      bedWidth    = [int](Get-Prop $device ${P.HORIZONTAL_BED_SIZE})
      bedHeight   = [int](Get-Prop $device ${P.VERTICAL_BED_SIZE})
      dataTypes   = $dataTypes
      resMin      = $resMin
      resMax      = $resMax
    }
    ConvertTo-Json -InputObject $result -Compress -Depth 4
  `;

  const raw = await runPowerShell(script, 45000);
  const info = JSON.parse(raw);

  const sources = [];
  if (info.handling & CAP_FLATBED) sources.push("Platen");
  if (info.handling & CAP_FEEDER) sources.push("Feeder");
  if (!sources.length) sources.push("Platen");

  const colorModes = (info.dataTypes ?? [])
    .map((t) => DATA_TYPE_TO_MODE[t])
    .filter(Boolean);
  const resolutions = STANDARD_DPI.filter((d) => d >= info.resMin && d <= info.resMax);

  // Bed size is in thousandths of an inch; eSCL units are 1/300 inch, and the
  // rest of the bridge speaks eSCL units.
  const maxWidth = info.bedWidth ? Math.floor((info.bedWidth / 1000) * 300) : 2550;
  const maxHeight = info.bedHeight ? Math.floor((info.bedHeight / 1000) * 300) : 3507;

  const perSource = {
    maxWidth,
    maxHeight,
    colorModes: colorModes.length ? colorModes : ["RGB24"],
    resolutions: resolutions.length ? resolutions : [300],
    formats: ["image/png"],
  };

  return {
    makeAndModel: info.name || "Windows scanner",
    serial: null,
    duplex: false,
    sources,
    caps: Object.fromEntries(sources.map((s) => [s, { ...perSource }])),
  };
}

/**
 * Scan one or more pages, returning PNG buffers.
 *
 * WIA has no streaming equivalent of eSCL's NextDocument, so the feeder loop
 * lives here and the whole batch comes back at once.
 */
export async function scan({ deviceId, source, resolution, colorMode, width, height, maxPages = 25 }) {
  if (!isWindows) throw new Error("WIA scanning is only available on Windows.");

  const dir = await mkdtemp(join(tmpdir(), "quickpdf-wia-"));
  const useFeeder = source === "Feeder";
  const dataType = MODE_TO_DATA_TYPE[colorMode] ?? MODE_TO_DATA_TYPE.RGB24;
  // WIA extents are pixels at the chosen DPI; our units are 1/300 inch.
  const pxWidth = Math.round((width / 300) * resolution);
  const pxHeight = Math.round((height / 300) * resolution);
  const outDir = dir.replace(/\\/g, "\\\\").replace(/'/g, "''");

  const script = `
    $ErrorActionPreference = 'Stop'
    ${SET_PROP_FN}
    ${CONNECT_FN(deviceId)}

    ${useFeeder ? `Set-Prop $device ${P.DOC_HANDLING_SELECT} 1 'feeder select'` : ""}

    # Order matters. Data type and resolution both change what extents are
    # legal, so they must be applied before the extents are clamped and set.
    Set-Prop $item ${P.DATA_TYPE} ${dataType} 'data type'
    Set-Prop $item ${P.X_RESOLUTION} ${resolution} 'horizontal resolution'
    Set-Prop $item ${P.Y_RESOLUTION} ${resolution} 'vertical resolution'
    Set-Prop $item ${P.X_POSITION} 0 'horizontal start'
    Set-Prop $item ${P.Y_POSITION} 0 'vertical start'
    Set-Prop $item ${P.X_EXTENT} ${pxWidth} 'horizontal extent'
    Set-Prop $item ${P.Y_EXTENT} ${pxHeight} 'vertical extent'

    Add-Type -AssemblyName System.Drawing

    $fmtPNG = '{B96B3CAF-0728-11D3-9D7B-0000F81EF32E}'
    $supported = @()
    foreach ($f in $item.Formats) { $supported += [string]$f }
    # Many drivers (Canon among them) transfer BMP only. Take whatever the
    # device offers and convert afterwards rather than refusing the scan.
    # WIA's own ImageProcess "Convert" filter is avoided here: it throws an
    # InvalidCastException setting FormatID inside a transfer loop. System.Drawing
    # ships with .NET Framework and handles every BMP variant a driver emits.
    $transferFmt = $fmtPNG
    if ($supported -notcontains $fmtPNG) { $transferFmt = $supported[0] }

    $n = 0
    do {
      $n++
      $image = $item.Transfer($transferFmt)
      $path = Join-Path '${outDir}' ("page-" + $n.ToString('000') + ".png")
      if ([string]$image.FormatID -eq $fmtPNG) {
        $image.SaveFile($path)
      } else {
        $raw = Join-Path '${outDir}' ("raw-" + $n.ToString('000') + ".tmp")
        $image.SaveFile($raw)
        $bmp = [System.Drawing.Image]::FromFile($raw)
        try { $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png) }
        finally { $bmp.Dispose(); Remove-Item $raw -Force -ErrorAction SilentlyContinue }
      }

      $more = $false
      if (${useFeeder ? "$true" : "$false"}) {
        # 3087 = Document Handling Status; bit 1 means paper is still loaded.
        $status = Get-Prop $device 3087
        if ($null -ne $status) { $more = ((([int]$status) -band 1) -ne 0) }
      }
    } while ($more -and $n -lt ${maxPages})
    Write-Output $n
  `;

  try {
    await runPowerShell(script);
    const files = (await readdir(dir)).filter((f) => /^page-\d+\.png$/.test(f)).sort();
    if (!files.length) throw new Error("The scanner produced no pages.");
    return await Promise.all(
      files.map(async (f) => ({ mime: "image/png", bytes: await readFile(join(dir, f)) })),
    );
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Used only when a live capability query fails. */
export function defaultCapabilities() {
  const caps = {
    maxWidth: 2550,
    maxHeight: 3507,
    colorModes: ["RGB24", "Grayscale8", "BlackAndWhite1"],
    resolutions: [75, 150, 200, 300, 600],
    formats: ["image/png"],
  };
  return {
    makeAndModel: "Windows scanner",
    serial: null,
    duplex: false,
    sources: ["Platen"],
    caps: { Platen: caps },
  };
}
