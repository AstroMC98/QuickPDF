"use client";

import { useRef, useState } from "react";
import { IconSave, IconTrash, IconUpload } from "./Icons";
import { TOKEN_HELP } from "@/lib/naming";
import type { SortMode, Template } from "@/lib/types";

interface Props {
  templates: Template[];
  activeTemplateId: string | null;
  groupCount: number;
  onApply: (template: Template) => void;
  onSave: (name: string, openEndedLastGroup: boolean, sortOnApply: SortMode) => void;
  onOverwrite: (templateId: string, openEndedLastGroup: boolean, sortOnApply: SortMode) => void;
  onDelete: (templateId: string) => void;
  onImport: (file: File) => void;
  onExport: () => void;
}

const control =
  "w-full rounded-md border border-[var(--line)] bg-[var(--surface)] px-2 py-1.5 text-sm outline-none focus:border-indigo-500";

export default function TemplateManager({
  templates,
  activeTemplateId,
  groupCount,
  onApply,
  onSave,
  onOverwrite,
  onDelete,
  onImport,
  onExport,
}: Props) {
  const [selectedId, setSelectedId] = useState<string>(activeTemplateId ?? "");
  const [draftName, setDraftName] = useState("");
  const [openEnded, setOpenEnded] = useState(true);
  const [sortOnApply, setSortOnApply] = useState<SortMode>("none");
  const [showTokens, setShowTokens] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const selected = templates.find((t) => t.id === selectedId) ?? null;

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <select
          className={control}
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
        >
          <option value="">
            {templates.length ? "Choose a template…" : "No saved templates yet"}
          </option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} ({t.groups.length} {t.groups.length === 1 ? "doc" : "docs"})
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={!selected}
          onClick={() => selected && onApply(selected)}
          className="shrink-0 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Apply
        </button>
        <button
          type="button"
          disabled={!selected}
          onClick={() => {
            if (selected && confirm(`Delete the template “${selected.name}”?`)) {
              onDelete(selected.id);
              setSelectedId("");
            }
          }}
          title="Delete template"
          className="shrink-0 rounded-md border border-[var(--line)] p-1.5 text-[var(--ink-soft)] hover:text-red-600 disabled:opacity-40"
        >
          <IconTrash />
        </button>
      </div>

      {selected && (
        <p className="rounded-md bg-[var(--surface)] px-2 py-1.5 text-[11px] leading-snug text-[var(--ink-soft)]">
          Applies {selected.groups.length} document
          {selected.groups.length === 1 ? "" : "s"}:{" "}
          {selected.groups
            .map((g) => `${g.name} (${g.take === null ? "the rest" : `${g.take}`})`)
            .join(", ")}
        </p>
      )}

      <hr className="border-[var(--line)]" />

      <label className="flex items-start gap-2 text-xs text-[var(--ink-soft)]">
        <input
          type="checkbox"
          checked={openEnded}
          onChange={(e) => setOpenEnded(e.target.checked)}
          className="mt-0.5 accent-indigo-600"
        />
        <span>
          Last document takes whatever is left over — keeps the template working on batches of
          any size.
        </span>
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-[var(--ink-soft)]">
          Order images by, when applying
        </span>
        <select
          className={control}
          value={sortOnApply}
          onChange={(e) => setSortOnApply(e.target.value as SortMode)}
        >
          <option value="none">Keep the order they are in</option>
          <option value="name">Filename (page2 before page10)</option>
          <option value="added">Time added</option>
          <option value="size">File size</option>
        </select>
      </label>

      <div className="flex gap-2">
        <input
          className={control}
          placeholder="Name this template…"
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
        />
        <button
          type="button"
          disabled={!draftName.trim() || groupCount === 0}
          onClick={() => {
            onSave(draftName, openEnded, sortOnApply);
            setDraftName("");
          }}
          title={groupCount === 0 ? "Create at least one document first" : "Save this arrangement"}
          className="flex shrink-0 items-center gap-1.5 rounded-md border border-[var(--line)] px-3 py-1.5 text-sm font-medium transition-colors hover:border-indigo-500 hover:text-indigo-600 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <IconSave /> Save
        </button>
      </div>

      {selected && (
        <button
          type="button"
          disabled={groupCount === 0}
          onClick={() => onOverwrite(selected.id, openEnded, sortOnApply)}
          className="w-full rounded-md border border-[var(--line)] px-3 py-1.5 text-xs font-medium text-[var(--ink-soft)] hover:border-indigo-500 hover:text-indigo-600 disabled:opacity-40"
        >
          Overwrite “{selected.name}” with the current setup
        </button>
      )}

      <div className="flex items-center gap-2 text-[11px]">
        <button
          type="button"
          onClick={() => setShowTokens((v) => !v)}
          className="text-[var(--ink-soft)] underline underline-offset-2 hover:text-indigo-600"
        >
          {showTokens ? "Hide" : "Show"} name tokens
        </button>
        <span className="text-[var(--line)]">|</span>
        <button
          type="button"
          onClick={onExport}
          disabled={!templates.length}
          className="text-[var(--ink-soft)] underline underline-offset-2 hover:text-indigo-600 disabled:no-underline disabled:opacity-40"
        >
          Export all
        </button>
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          className="flex items-center gap-1 text-[var(--ink-soft)] underline underline-offset-2 hover:text-indigo-600"
        >
          <IconUpload className="h-3 w-3" /> Import
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onImport(file);
            e.target.value = "";
          }}
        />
      </div>

      {showTokens && (
        <dl className="rounded-md bg-[var(--surface)] p-2 text-[11px] leading-relaxed">
          {TOKEN_HELP.map((t) => (
            <div key={t.token} className="flex gap-2">
              <dt className="w-16 shrink-0 font-mono text-indigo-600 dark:text-indigo-400">
                {t.token}
              </dt>
              <dd className="text-[var(--ink-soft)]">{t.meaning}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
