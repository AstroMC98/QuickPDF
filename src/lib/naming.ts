/** Characters Windows/macOS refuse in filenames. */
const ILLEGAL = /[\\/:*?"<>|\u0000-\u001f]/g;

/** Windows reserved device names — a file called "con.pdf" cannot be saved. */
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

export function sanitiseFilename(raw: string, fallback = "document"): string {
  let s = raw.replace(ILLEGAL, "").replace(/\s+/g, " ").trim();
  s = s.replace(/^\.+/, "").replace(/[. ]+$/, "");
  if (!s) s = fallback;
  if (RESERVED.test(s)) s = `_${s}`;
  return s.slice(0, 120);
}

export function stripExtension(filename: string): string {
  return filename.replace(/\.[^.]+$/, "");
}

export interface TokenContext {
  /** 1-based position of this document in the batch. */
  index: number;
  /** Total number of documents in the batch. */
  total: number;
  /** Page count of this document. */
  count: number;
  /** Filename (no extension) of this document's first image. */
  first: string;
  /** Name of the template in use, if any. */
  template: string;
  date: Date;
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/**
 * Expand {tokens} in a document name. Unknown tokens are left untouched so a
 * literal brace in a filename survives round-tripping through a template.
 */
export function expandTokens(pattern: string, ctx: TokenContext): string {
  const d = ctx.date;
  const map: Record<string, string> = {
    i: String(ctx.index),
    ii: pad(ctx.index),
    iii: pad(ctx.index, 3),
    n: String(ctx.total),
    count: String(ctx.count),
    first: ctx.first,
    template: ctx.template,
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}${pad(d.getMinutes())}`,
    year: String(d.getFullYear()),
    month: pad(d.getMonth() + 1),
    day: pad(d.getDate()),
  };
  return pattern.replace(/\{(\w+)\}/g, (whole, key: string) => {
    const v = map[key.toLowerCase()];
    return v === undefined ? whole : v;
  });
}

export const TOKEN_HELP: { token: string; meaning: string }[] = [
  { token: "{i}", meaning: "document number (1, 2, 3…)" },
  { token: "{ii}", meaning: "zero-padded number (01, 02…)" },
  { token: "{n}", meaning: "total documents in batch" },
  { token: "{count}", meaning: "pages in this document" },
  { token: "{first}", meaning: "name of its first image" },
  { token: "{template}", meaning: "template name" },
  { token: "{date}", meaning: "today, as 2026-08-23" },
  { token: "{time}", meaning: "now, as 1430" },
];

/** Append " (2)", " (3)"… so no two PDFs in a batch collide. */
export function dedupeNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((name) => {
    const key = name.toLowerCase();
    const hits = seen.get(key) ?? 0;
    seen.set(key, hits + 1);
    return hits === 0 ? name : `${name} (${hits + 1})`;
  });
}
