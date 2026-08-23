# QuickPDF

Turn a pile of PNGs into exactly the PDFs you want: arrange the page order, split
them across multiple output files, name each file, and save the whole arrangement
as a reusable template.

Everything runs in the browser. No upload, no server, no account.

```bash
npm install
npm run dev     # http://localhost:3000
```

## The workflow

1. **Drop images in.** Files or whole folders. PNG, JPEG and WebP.
2. **Arrange.** Drag thumbnails to reorder within a document or move them between
   documents. The `Unsorted` tray is a parking bay for images not yet assigned.
3. **Split.** Four ways, see below.
4. **Rotate** anything that came in sideways — the ↻ button on a page, or the
   selection bar to turn a whole batch at once.
5. **Name.** Each document has its own filename, with token support (below).
6. **Generate.** Choose separate PDF files or one `.zip`, and name the batch.
7. **Save as template** so the next batch takes one click.

## Splitting and assigning pages

There is no fixed page count you have to work in. Pick whichever route suits the
job:

| Route | Good for |
| --- | --- |
| **Drag a thumbnail** into another document | moving one page |
| **Select pages, then act on them** | assigning an arbitrary group of pages |
| **✂ on a page** | cutting a document in two at that page |
| **`Split every N pages`** | chunking a long uniform batch in one go |

### Selecting pages

Hover a thumbnail and click its checkbox, or **Shift-click** to take everything
between the last page you clicked and this one — ranges run in reading order and
cross document boundaries, so you can sweep up a run that straddles a split. The
checkbox in a document's header takes or releases that whole document, and
`Select all` in the toolbar takes the lot. `Esc` clears the selection.

With pages selected, a bar appears offering:

- **New PDF from selection** — moves them into a brand new document, inserted
  directly after the one holding the first selected page
- **Move to…** — drops them into any existing document, or back to `Unsorted`
- **Remove** — deletes those images outright

Dragging any selected page drags the **whole selection** as one stack (the
overlay shows how many are travelling). They land in reading order regardless of
which page in the group you grabbed.

### Looking at a page

Click any thumbnail to open it full screen. Arrow keys move through every page
on the board, the magnifier toggles between fit-to-window and full size (useful
for checking whether a 300 DPI scan is actually sharp), and Esc closes.

Clicking a thumbnail does not select it — selection has its own checkbox, and
dragging needs 5px of movement, so the three gestures never collide. With the
viewer open, Esc closes it and leaves your selection intact; a second Esc clears
the selection.

### Annotating a page

The same full-screen view is the editor. Pick a tool and draw straight onto the
page:

| Tool | Key | What it does |
| --- | --- | --- |
| Select | `V` | click a mark to select, drag to move, corner handle resizes, `Del` removes |
| Pen | `P` | freehand ink |
| Text | `T` | click, type, Enter |
| Rectangle / Ellipse | `R` / `O` | drag out a box; optional fill |
| Arrow | `A` | drag from tail to head |
| Signature or image | `S` | drag a box, choose a file — it is fitted to the box keeping its proportions |

Colour, stroke width and text size are on the toolbar; `Ctrl+Z` undoes. Pages
carrying marks show a count badge on their thumbnail.

Marks are **vector, not painted onto the pixels**. They export as real PDF
content: shapes become paths, and text becomes selectable, searchable text in
Helvetica. Nothing is baked into the image, so a mark can be moved or deleted
later and the original scan is never altered.

### Rotating

The ↻ button on a thumbnail turns that page 90° clockwise; click again for 180°
and 270°. With pages selected, **Rotate** in the selection bar turns the whole
selection at once — useful when a feeder has fed a stack in sideways.

Rotation is lossless: no pixels are resampled. The page is simply built in the
rotated orientation, so a portrait scan turned 90° produces a landscape page.

## Scanning

QuickPDF can pull pages straight off a scanner. There is a catch worth
understanding: **browsers have no scanner API**. eSCL network scanners send no
CORS headers, and WIA/TWAIN/SANE are OS driver interfaces with no web
equivalent. (Google has a [Web Scanning API
explainer](https://github.com/explainers-by-googlers/web-scanning), but nothing
has shipped.) Every web-scanning product solves this the same way — a small
local service — and so does this one.

```bash
npm run scan-bridge      # in a second terminal, alongside npm run dev
```

The Scan panel then lists your scanners and gives you source, resolution,
colour mode and page size, taken from what the device actually reports. Pages
land in the board as they come off the glass, ready to arrange and split like
any other image. Without the bridge running the panel simply explains how to
start it, and the rest of the app is unaffected.

| Transport | Covers |
| --- | --- |
| **eSCL** (AirScan / Mopria) | network MFPs, auto-discovered over mDNS |
| **WIA** | scanners installed as Windows devices — USB flatbeds and USB-attached MFPs included |

USB scanners go through WIA, not eSCL: plug-in devices have no network presence
to discover. That also means USB support is currently **Windows only** — macOS
(ICA) and Linux (SANE) have no backend here yet, so on those platforms only
network eSCL scanners appear.

The feeder scans the whole tray, one page per sheet. Scanners that mDNS cannot
see — different subnet, multicast blocked — can be added by IP.

If port 7878 is taken, the bridge says so rather than crashing — and if the
occupant is another QuickPDF bridge, it tells you to just use that one. To run
elsewhere:

```bash
npm run scan-bridge -- --port 7879
```

and point the app at it with `NEXT_PUBLIC_SCAN_BRIDGE=http://127.0.0.1:7879`.

### Bridge safety

The bridge binds to `127.0.0.1` only and answers cross-origin requests for an
allowlist: any `http://localhost` / `http://127.0.0.1` port by default. Without
that, any website you happened to visit could start a scan and read the result.
To use it from a deployed origin, opt in explicitly:

```bash
npm run scan-bridge -- --allow-origin https://quickpdf.example.com
```

Chrome's Private Network Access preflight is handled for that case. Note that a
deployed **https** page can reach `http://localhost` because localhost counts as
a trustworthy origin.

### Developing without a scanner

```bash
npm run scan-bridge:mock -- --port 8081 --pages 3
```

A fake eSCL device implementing the same three endpoints a real one does. It
advertises itself over mDNS, so discovery, capability parsing, flatbed and
feeder scanning can all be exercised end to end with no hardware.

## Getting the files out

One document downloads as a plain `.pdf`. For several, you choose:

- **Separate PDF files** (default) — exactly what the button says: real PDFs,
  one per document. The browser asks permission once to save several files.
- **One .zip archive** — tidier for large batches, and you name the zip yourself.

Each PDF is named by its own document's header field, and the Output panel lists
the filenames you are about to get, so there is no guessing before you click.
The zip name accepts the same `{tokens}` as document names, so
`March Batch {n} docs {date}` becomes `March Batch 2 docs 2026-08-23.zip`, and is
sanitised the same way.

### Metadata sidecars

Optionally, the export includes `.json` files describing what was produced —
either one for the whole batch, one beside each PDF, or both. They land inside
the zip, or download alongside the PDFs.

A per-document file repeats the batch header rather than only referencing it, so
a JSON found on its own months later still explains itself:

```json
{
  "quickpdf": { "version": "1.0.0", "schema": 1 },
  "generatedAt": "2026-08-23T05:45:00.000Z",
  "batch": { "name": "March intake", "delivery": "files",
             "documentCount": 2, "pageCount": 4 },
  "template": { "name": "Intake", "groups": 1 },
  "pageSetup": { "pageSize": "a4", "fit": "contain", "marginPt": 12, "autoDpi": 300, "…": "…" },
  "document": {
    "file": "Contract 01.pdf",
    "namePattern": "Contract {ii}",
    "pageCount": 2,
    "pages": [
      { "index": 1, "source": "scan-20260823-1430-001.png",
        "width": 2480, "height": 3507, "rotation": 0,
        "bytes": 15600000, "type": "image/png",
        "origin": { "kind": "scan", "scanner": "Canon E3400 series",
                    "source": "Flatbed glass", "resolution": 300,
                    "colorMode": "Colour", "scannedAt": "2026-08-23T05:40:00.000Z" } }
    ]
  }
}
```

The batch file is identical but carries `documents` (plural) instead. Note
`namePattern`: the name as *typed*, before tokens expand, so a batch can be
reconstructed rather than merely described. Pages record their rotation and,
for scanned pages, which scanner produced them at what resolution.

## Deploying

The app is a zero-config static Next build, so it deploys to Vercel as-is.
Easiest route, since the repo is already on GitHub:

1. vercel.com/new -> import `AstroMC98/QuickPDF`
2. Accept the detected settings and deploy

That also wires up automatic deploys on every push and preview URLs per branch.
There is nothing to configure: no server routes, no environment variables, no
database.

### Scanning from a deployed page

**A hosted app cannot reach a USB scanner.** The scanner is plugged into a desk;
the deployment runs in a datacentre. What works instead is the deployed page
talking to the bridge on *the visitor's own machine*:

```bash
npm run scan-bridge -- --allow-origin https://your-deployment.vercel.app
```

The Scan panel prints that exact command, with the right origin already filled
in, whenever it is served from anywhere other than localhost. You can also set
`QUICKPDF_ALLOW_ORIGIN` instead of retyping the flag.

Three things make this possible, and all three are already handled:

- `http://localhost` counts as a trustworthy origin, so an **https** page is not
  blocked from calling it as mixed content
- Chrome's Private Network Access preflight is answered with
  `Access-Control-Allow-Private-Network` (the browser may still ask the visitor
  for permission the first time)
- the bridge answers only origins on its allowlist, which is why the deployment
  has to be named explicitly — otherwise any site you visited could start a scan

Anyone without the bridge running still gets the full app; the Scan panel simply
explains how to start it, and uploading works as normal.

## Templates

A template deliberately stores **no image data**. It stores the *shape* of the job:

- the ordered list of documents, each with a name pattern and a page count
- the page setup (size, orientation, fit, margin, background)
- how to sort images before distributing them

**A template needs no images to apply.** It describes structure, so applying it
to an empty board lays out the documents ready and waiting; pages then fill them
as they are dropped or scanned in, each document taking up to its declared page
count before the next begins. That makes the natural scanning order work: set up
the documents first, then feed pages into them.

That is what lets one template work on a batch of 12 images and a batch of 40.
The last document is normally saved as open-ended (`take: null`), meaning
"whatever is left over". Fixed-count documents are filled first, in order; the
remainder is shared evenly among the open-ended ones. If a template has no
open-ended document, surplus images land back in `Unsorted` rather than being
silently dropped.

Templates live in `localStorage`, so they are per-browser. Use **Export all** /
**Import** to move them between machines or share them with a colleague. Imported
templates are re-keyed on the way in, so they can never overwrite a local one.

### Filename tokens

| Token | Becomes |
| --- | --- |
| `{i}` `{ii}` `{iii}` | document number, optionally zero-padded |
| `{n}` | total documents in the batch |
| `{count}` | pages in this document |
| `{first}` | filename of this document's first image |
| `{template}` | the active template's name |
| `{date}` `{time}` `{year}` `{month}` `{day}` | when it was generated |

So `Invoice {ii} - {first} ({count}p)` produces `Invoice 01 - scan001 (3p).pdf`.

Names are sanitised for Windows and macOS (illegal characters stripped, reserved
device names like `con` escaped), and duplicates within a batch get ` (2)`
appended so nothing silently overwrites anything else in the zip.

## Page setup

**Match image** (default) makes each page exactly as large as its own image at
the chosen DPI — nothing is scaled, cropped or letterboxed. Pick the DPI to match
the source: 96 for screenshots, 300 for scans.

Choosing a fixed size (A4, Letter, …) enables orientation and fit:

- **Fit inside page** — whole image visible, gaps filled with the background colour
- **Fill page** — image covers the page, overflow cropped
- **Stretch** — image distorted to the page exactly

With orientation on *Match each image*, a landscape image gets a landscape page
even in an otherwise portrait document.

## How it is put together

```
scan-bridge/     local helper: not part of the web bundle
  server.mjs     HTTP API on 127.0.0.1, CORS allowlist, job streaming
  escl.mjs       eSCL protocol client and capability parsing
  wia.mjs        Windows WIA via PowerShell COM
  discovery.mjs  mDNS browse for _uscan._tcp / _uscans._tcp
  mock-scanner.mjs  fake device for testing without hardware
src/lib/
  types.ts       domain model (ImageItem, DocGroup, Board, Template)
  scanner.ts     client for the bridge; degrades cleanly when absent
  images.ts      file ingestion, dimension probing, directory-drop walking
  naming.ts      token expansion, filename sanitising, de-duplication
  pageSizes.ts   page dimensions — kept free of pdf-lib so it can be imported eagerly
  pdf.ts         pdf-lib page composition (loaded on demand)
  templates.ts   persistence, the useSyncExternalStore adapter, and apply/capture
  download.ts    Blob and object-URL plumbing
src/components/  UploadZone, DocumentColumn, SortableImage, SelectionBar,
                 SettingsPanel, TemplateManager
src/app/page.tsx board state, drag-and-drop wiring, generation
```

A few decisions worth knowing about if you extend this:

- **The board is containers-of-ids.** `Board` holds `unassigned: string[]` and
  `groups[].imageIds: string[]`; the images themselves live in a separate
  `Record<id, ImageItem>`. Moving a page between documents is an array splice, so
  image bytes are never copied.
- **Cross-container moves happen in `onDragOver`, not `onDragEnd`.** That is what
  makes a gap open under the cursor as you hover a different document. Containers
  are re-derived inside the state updater because several dragover events can
  queue before React re-renders.
- **Collision detection is `pointerWithin` first, not `closestCorners`.**
  `closestCorners` cannot see an *empty* document — with no pages inside to anchor
  against, a nearby populated document always wins and the drop silently reverts.
  `pointerWithin` fixes that, but it also reports the container when you hover the
  gap between pages, which would turn every drop into an append — so when a
  container wins, the strategy narrows to the closest page inside it.
- **Droppables use `MeasuringStrategy.Always`.** Pages move between documents
  mid-drag, so rects measured once at drag start go stale.
- **Multi-drag is faked, because dnd-kit drags exactly one node.** On drag start
  the other selected pages are lifted out of the board and stashed; dnd-kit
  animates the single remaining node; on drop the whole selection is re-laid at
  the drop point in reading order. The stash keeps a board snapshot so a
  cancelled drag restores cleanly.
- **`pdf-lib` and `JSZip` are dynamically imported** inside the generate handler.
  They are roughly 500 KB together and are not needed to render the page, which is
  why page dimensions live in their own `pageSizes.ts` — importing them from
  `pdf.ts` would drag the whole library into the initial bundle.
- **Templates are read through `useSyncExternalStore`**, not copied into state by
  an effect. `localStorage` is an external system; the adapter also listens for the
  `storage` event, so two open tabs stay in agreement.
- **`PDFDocument.create({ updateMetadata: false })`** — it is a *create* option,
  not a save option; without it pdf-lib overwrites Producer and Creator on save.
  Note `PDFDocument.load()` rewrites them too, so verify metadata by loading with
  `{ updateMetadata: false }` or you will measure pdf-lib instead of the file.
- **Templates apply to an empty board, and `fillTemplate` is the incremental
  counterpart to `applyTemplate`.** The whole-batch version distributes a known
  pool and can split a remainder evenly between open-ended groups; the
  incremental one never disturbs pages already placed, so an open-ended group
  simply keeps everything from the point it is reached onwards.
- **Annotations are stored in source-image pixels**, the same space as an
  `<svg viewBox="0 0 w h">` laid over the page. Display then needs no maths:
  image and marks share one wrapper carrying the rotation and zoom. Pointer
  input maps back through the SVG's own `getScreenCTM().inverse()`, which
  already folds in that transform — so rotating a page leaves every stored
  coordinate untouched.
- **The PDF renderer walks the same transform pdf-lib applies to the image**:
  normalise, flip to PDF's y-up, scale to the drawn size, rotate about the
  anchor, translate. Stroke widths and glyph sizes take the plain page-to-image
  scale, since they are lengths rather than points.
- **Metadata repeats rather than references.** Every per-document sidecar
  carries the full batch header. Duplication is the point: the files get
  separated, and a sidecar that only said "document 2 of 4" would be useless on
  its own.
- **The viewer computes its own sizing.** A CSS transform does not change an
  element's layout box, so `object-contain` alone would let a quarter-turned
  page overflow or sit off-centre. The wrapper is sized to the rotated
  footprint and the image is centred and rotated inside it, which also makes
  scrolling at full size match what is on screen.
- **Click-to-open composes with dnd-kit's pointer handler** rather than
  replacing it: a drag ends in a click event too, so the card records where the
  press started and only opens the viewer if the pointer stayed within 5px.
- **Rotation is stored clockwise (CSS convention) and mirrored for PDF.** CSS
  `rotate()` turns clockwise; PDF turns counter-clockwise, so the generator uses
  `(360 - rotation) % 360`. `drawImage` rotates about its own anchor, so the
  anchor moves to a different corner of the footprint for each quarter turn.
- **The bridge uses `node:https`, not `fetch`.** eSCL over HTTPS uses a
  self-signed certificate on the device itself, and `fetch` offers no supported
  way to relax certificate checking per request.
- **eSCL spatial units are 1/300th inch**, independent of scan resolution. The
  WIA path converts to pixels-at-DPI, which is what WIA extents expect.
- **The WIA PowerShell must stay 5.1-compatible.** `powershell.exe` on Windows
  11 is Windows PowerShell 5.1, where `ConvertTo-Json` has no `-AsArray`;
  `ConvertTo-Json -InputObject @(...)` produces an array on 5.1 and 7 alike.
  Enumeration failures are logged rather than swallowed, because "the script
  broke" and "no scanners attached" otherwise look identical.
- **WIA property values are clamped to each property's own SubTypeMin/Max.**
  An out-of-range value earns a bare "The parameter is incorrect" that names
  neither the property nor the limit. A4 at 300 DPI is 3508 rows, but a scanner
  whose bed maxes out at 3507 rejects the whole job over that one row.
- **WIA capabilities are queried, not assumed.** Sources come from Document
  Handling Capabilities, so a flatbed-only scanner is not offered a feeder;
  resolutions and colour modes come from the device's own ranges and lists.
- **WIA transfer format is negotiated, then converted in .NET.** Many drivers
  (Canon among them) emit BMP only. WIA's own `ImageProcess` "Convert" filter
  throws an InvalidCastException setting `FormatID` inside a transfer loop, so
  the bridge converts with `System.Drawing`, which ships with .NET Framework.
- **A scanner switched off abruptly sends no mDNS goodbye**, so its record can
  linger until the TTL expires. Rather than surface a raw socket error, the
  bridge translates connection failures into a readable message and evicts the
  stale entry so the list self-heals.
- **PNG decode has a fallback.** pdf-lib does not handle every PNG variant (16-bit,
  interlaced). When `embedPng` throws, the image is re-encoded through a canvas to
  plain 8-bit RGBA and retried.

## Verified behaviour

Exercised end to end in a real browser against generated fixtures:

- 9 images → auto-split into 3 documents → 3 PDFs in a zip, correct names and page counts
- Page geometry: a 600×800px source at 96 DPI produces a 450×600pt page; a
  landscape source produces a landscape page
- A4 output measures 595.28×841.89pt, with landscape sources auto-rotated
- A template captured from a 9-image batch replays onto a 7-image batch as 3 + 3 + 1
- Cross-document drag, in-document reorder, and ✂ split all update the live
  filename preview (`{count}` and `{first}` re-resolve immediately)
- `Bad:Name*With?Illegal|Chars` is written as `BadNameWithIllegalChars.pdf`
- Shift-click selects the range between two pages; `New PDF from selection` moves
  them into a new document inserted after the source
- `Move to…` relocates a selection into another document, appended in reading order
- Dragging one page of a 3-page selection carries all three into an empty
  document, arriving as 1, 2, 3 even when the middle page was grabbed

Scanning, against the mock eSCL device (no hardware involved):

- mDNS discovery finds the device and scanning it at its advertised address works
- capabilities parse per source — the feeder correctly offers a different
  resolution and colour list from the flatbed
- flatbed yields one page, feeder yields the whole stack, then `204` ends the job
- scanned pages enter the board and generate a correct multi-page PDF
- a hostile origin is refused with 403 and no `Access-Control-Allow-Origin`
- an unreachable scanner reports "not responding" rather than a socket error
- with no bridge running the panel explains how to start it and nothing else breaks

Templates without images:

- applying a structural template to a completely empty board creates the
  documents, and the board renders them with no pages present
- pages added afterwards fill in order against the template's counts: a
  `take: 2` document took exactly 2, `take: 1` took 1, and the open-ended
  document absorbed the remaining 3, with nothing left in Unsorted
- name tokens still resolve on empty documents (`Invoice {date}` previews as
  `Invoice 2026-08-23.pdf` once it has pages)

Output:

- separate-files delivery produces real `%PDF-` files, one per document, named
  from each document's header
- zip delivery produces a valid archive under a user-typed name, with tokens
  expanded and illegal characters stripped (`March: Batch {n} docs {date}` ->
  `March Batch 2 docs 2026-08-23.zip`)

Annotation editing:

- all six tools draw correctly, with the layer's `viewBox` matching the source
  image exactly (`0 0 600 800` for a 600×800 page)
- rotating a page leaves stored coordinates unchanged — the shared wrapper does
  the work, so marks stay put on the page
- exported PDF content streams contain real vector operators: 9 stroke ops for
  a rectangle + ellipse + arrow + 4-segment ink stroke, 4 bezier curves for the
  ellipse, and zero on an un-annotated page
- text exports as searchable text, not pixels: `/Helvetica 36 Tf` with the
  string `<415050524F56454420323320417567>` = "APPROVED 23 Aug"

Deployed-origin scanning:

- the production build served from a non-localhost origin reaches the bridge
  successfully once that origin is allowed, confirming the CORS and Private
  Network Access path
- served from an origin that is *not* allowed, the panel shows the exact
  `--allow-origin` command for its own origin. A refused origin is
  indistinguishable from "not running" in the browser — the 403 carries no CORS
  header, so the response cannot be read — which is why the panel offers the
  command that covers both cases
- with the scanner powered off, the bridge reports "no scanners" rather than
  failing

Metadata sidecars:

- both delivery paths emit them — inside the zip, or as individual downloads
- every produced file validated after download: PDFs parse, JSON parses, schema
  version present, batch files carry `documents` and per-document files carry
  `document`
- rotation and scan provenance (scanner, source, resolution, colour mode,
  timestamp) survive into the JSON

Page viewer:

- clicking a thumbnail opens it; arrow keys move through all pages and wrap at
  both ends; rotating inside the viewer keeps the page fitted to the stage
- the three gestures stay separate: the checkbox selects without opening the
  viewer, action buttons do not open it, and a real drag still reorders and does
  not open it on release
- Esc closes the viewer and preserves the selection; a second Esc clears it

Rotation, verified by composing the transformation matrices in the generated
PDF's content stream:

- all four quarter turns fill the page exactly, and the image's top-left corner
  lands where a *clockwise* turn puts it (top-right at 90°, bottom-right at 180°,
  bottom-left at 270°)
- a 90° turn swaps the page to landscape; 180° leaves it portrait

On real hardware:

- a USB-attached **Canon E3400** (port `USB001`) is enumerated by the WIA path,
  reports its true capabilities (flatbed only, 75–600 DPI, three colour modes),
  and completes an A4 / 300 DPI / colour scan to a valid 2480×3507 PNG in ~17s

**Still unverified:** the ADF feeder loop (this device has no feeder), and the
whole eSCL path, which has only ever run against the mock.

## Deploying

It is a static Next.js app with no server-side work — every route prerenders.
`npm run build` then deploy the repo to any static host or to Vercel as-is.
