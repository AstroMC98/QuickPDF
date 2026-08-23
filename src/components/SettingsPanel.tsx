"use client";

import { PAGE_SIZE_LABELS } from "@/lib/pageSizes";
import type { FitMode, Orientation, PageSettings, PageSizeKey } from "@/lib/types";

interface Props {
  settings: PageSettings;
  onChange: (patch: Partial<PageSettings>) => void;
}

const FIT_HELP: Record<FitMode, string> = {
  contain: "Whole image fits on the page; empty space is filled with the background colour.",
  cover: "Image fills the page edge to edge; the overflowing edges are cropped.",
  fill: "Image is stretched to the page exactly. Distorts the aspect ratio.",
};

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-[var(--ink-soft)]">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] leading-snug text-[var(--ink-soft)]">{hint}</span>}
    </label>
  );
}

const control =
  "w-full rounded-md border border-[var(--line)] bg-[var(--surface)] px-2 py-1.5 text-sm outline-none focus:border-indigo-500";

export default function SettingsPanel({ settings, onChange }: Props) {
  const isAuto = settings.pageSize === "auto";

  return (
    <div className="space-y-3">
      <Field
        label="Page size"
        hint={isAuto ? "Each page is cut to its own image — nothing is scaled or letterboxed." : undefined}
      >
        <select
          className={control}
          value={settings.pageSize}
          onChange={(e) => onChange({ pageSize: e.target.value as PageSizeKey })}
        >
          {(Object.keys(PAGE_SIZE_LABELS) as PageSizeKey[]).map((key) => (
            <option key={key} value={key}>
              {PAGE_SIZE_LABELS[key]}
            </option>
          ))}
        </select>
      </Field>

      {isAuto ? (
        <Field label="Image resolution" hint="How many image pixels make up one printed inch.">
          <select
            className={control}
            value={settings.autoDpi}
            onChange={(e) => onChange({ autoDpi: Number(e.target.value) })}
          >
            <option value={72}>72 DPI — large on paper</option>
            <option value={96}>96 DPI — screenshots</option>
            <option value={150}>150 DPI — light scans</option>
            <option value={300}>300 DPI — print scans</option>
          </select>
        </Field>
      ) : (
        <>
          <Field label="Orientation">
            <select
              className={control}
              value={settings.orientation}
              onChange={(e) => onChange({ orientation: e.target.value as Orientation })}
            >
              <option value="auto">Match each image</option>
              <option value="portrait">Portrait</option>
              <option value="landscape">Landscape</option>
            </select>
          </Field>

          <Field label="Fit" hint={FIT_HELP[settings.fit]}>
            <select
              className={control}
              value={settings.fit}
              onChange={(e) => onChange({ fit: e.target.value as FitMode })}
            >
              <option value="contain">Fit inside page</option>
              <option value="cover">Fill page (crop)</option>
              <option value="fill">Stretch to page</option>
            </select>
          </Field>
        </>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label="Margin (pt)">
          <input
            type="number"
            min={0}
            max={144}
            step={6}
            className={control}
            value={settings.marginPt}
            onChange={(e) => onChange({ marginPt: Math.max(0, Math.min(144, Number(e.target.value) || 0)) })}
          />
        </Field>
        <Field label="Background">
          <input
            type="color"
            className="h-[34px] w-full cursor-pointer rounded-md border border-[var(--line)] bg-[var(--surface)] p-1"
            value={settings.background}
            onChange={(e) => onChange({ background: e.target.value })}
          />
        </Field>
      </div>
    </div>
  );
}
