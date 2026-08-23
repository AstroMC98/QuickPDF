"use client";

import { IconDownload, IconSpinner } from "./Icons";
import type { DeliveryMode } from "@/lib/types";

interface Props {
  documentCount: number;
  totalPages: number;
  /** Every file the export will produce, with extensions, in order. */
  plannedFiles: string[];
  delivery: DeliveryMode;
  onDeliveryChange: (mode: DeliveryMode) => void;
  /** Raw batch-name pattern as typed; may be empty. */
  batchName: string;
  onBatchNameChange: (value: string) => void;
  /** What the batch name resolves to once tokens are expanded. */
  resolvedBatchName: string;
  batchMetadata: boolean;
  onBatchMetadataChange: (on: boolean) => void;
  documentMetadata: boolean;
  onDocumentMetadataChange: (on: boolean) => void;
  busy: boolean;
  progress: { done: number; total: number };
  onGenerate: () => void;
}

const control =
  "w-full rounded-md border border-[var(--line)] bg-[var(--surface)] px-2 py-1.5 text-sm outline-none focus:border-indigo-500";

export default function OutputPanel({
  documentCount,
  totalPages,
  plannedFiles,
  delivery,
  onDeliveryChange,
  batchName,
  onBatchNameChange,
  resolvedBatchName,
  batchMetadata,
  onBatchMetadataChange,
  documentMetadata,
  onDocumentMetadataChange,
  busy,
  progress,
  onGenerate,
}: Props) {
  const many = documentCount > 1;

  if (documentCount === 0) {
    return (
      <>
        <p className="mb-3 text-sm text-[var(--ink-soft)]">Nothing to build yet.</p>
        <button
          type="button"
          disabled
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 font-semibold text-white opacity-40"
        >
          <IconDownload /> Generate PDF
        </button>
      </>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-[var(--ink-soft)]">
        <strong className="text-[var(--ink)]">{documentCount}</strong> PDF{many ? "s" : ""} ·{" "}
        <strong className="text-[var(--ink)]">{totalPages}</strong> page
        {totalPages === 1 ? "" : "s"}
      </p>

      {many && (
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-[var(--ink-soft)]">Deliver as</span>
          <select
            className={control}
            value={delivery}
            onChange={(e) => onDeliveryChange(e.target.value as DeliveryMode)}
          >
            <option value="files">Separate files</option>
            <option value="zip">One .zip archive</option>
          </select>
        </label>
      )}

      {many && delivery === "zip" && (
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-[var(--ink-soft)]">
            Zip file name
          </span>
          <input
            className={control}
            value={batchName}
            placeholder={resolvedBatchName}
            spellCheck={false}
            onChange={(e) => onBatchNameChange(e.target.value)}
          />
          <span className="mt-1 block truncate font-mono text-[11px] text-[var(--ink-soft)]">
            {resolvedBatchName}.zip
          </span>
        </label>
      )}

      <fieldset className="space-y-1.5">
        <legend className="mb-1 text-xs font-medium text-[var(--ink-soft)]">
          Metadata sidecars
        </legend>
        <label className="flex items-start gap-2 text-xs text-[var(--ink-soft)]">
          <input
            type="checkbox"
            checked={batchMetadata}
            onChange={(e) => onBatchMetadataChange(e.target.checked)}
            className="mt-0.5 accent-indigo-600"
          />
          <span>
            One <code className="font-mono">.json</code> for the whole batch — every document and
            page in it.
          </span>
        </label>
        <label className="flex items-start gap-2 text-xs text-[var(--ink-soft)]">
          <input
            type="checkbox"
            checked={documentMetadata}
            onChange={(e) => onDocumentMetadataChange(e.target.checked)}
            className="mt-0.5 accent-indigo-600"
          />
          <span>
            A <code className="font-mono">.json</code> beside each PDF, describing just that
            document.
          </span>
        </label>
      </fieldset>

      {/* Listing the files is what makes per-document naming discoverable:
          each PDF is named by its own document's header field. */}
      <div className="rounded-md bg-[var(--surface)] p-2">
        <p className="mb-1 text-[11px] font-medium text-[var(--ink-soft)]">
          {many && delivery === "zip" ? "Inside the zip" : "Files you will get"}
        </p>
        <ul className="space-y-0.5">
          {plannedFiles.slice(0, 6).map((name) => (
            <li key={name} className="truncate font-mono text-[11px]" title={name}>
              {name}
            </li>
          ))}
          {plannedFiles.length > 6 && (
            <li className="text-[11px] text-[var(--ink-soft)]">
              +{plannedFiles.length - 6} more
            </li>
          )}
        </ul>
        <p className="mt-1.5 text-[11px] leading-snug text-[var(--ink-soft)]">
          Rename these in each document&rsquo;s header.
        </p>
      </div>

      {many && delivery === "files" && (
        <p className="text-[11px] leading-snug text-[var(--ink-soft)]">
          Your browser may ask permission to download several files at once.
        </p>
      )}

      <button
        type="button"
        onClick={onGenerate}
        disabled={busy}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 font-semibold text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy ? <IconSpinner /> : <IconDownload />}
        {busy
          ? `Building ${progress.done}/${progress.total}…`
          : many
            ? delivery === "zip"
              ? `Generate ${documentCount} PDFs as .zip`
              : `Generate ${documentCount} PDFs`
            : "Generate PDF"}
      </button>
    </div>
  );
}
