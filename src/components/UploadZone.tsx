"use client";

import { useCallback, useRef, useState } from "react";
import { IconUpload } from "./Icons";
import { filesFromDataTransfer, isAcceptedFile } from "@/lib/images";

interface Props {
  onFiles: (files: File[]) => void;
  compact: boolean;
  busy: boolean;
}

export default function UploadZone({ onFiles, compact, busy }: Props) {
  const [hovering, setHovering] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  // dragenter/dragleave fire for every child element, so count them instead of
  // toggling a boolean — otherwise the highlight flickers as the cursor moves.
  const depth = useRef(0);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      depth.current = 0;
      setHovering(false);
      const files = await filesFromDataTransfer(e.dataTransfer);
      onFiles(files.filter(isAcceptedFile));
    },
    [onFiles],
  );

  return (
    <div
      onDragEnter={(e) => {
        e.preventDefault();
        depth.current += 1;
        setHovering(true);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={(e) => {
        e.preventDefault();
        depth.current -= 1;
        if (depth.current <= 0) setHovering(false);
      }}
      onDrop={handleDrop}
      onClick={() => !busy && input.current?.click()}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") input.current?.click();
      }}
      className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed text-center transition-colors ${
        compact ? "gap-1 px-4 py-4" : "gap-2 px-6 py-14"
      } ${
        hovering
          ? "border-indigo-500 bg-indigo-500/10"
          : "border-[var(--line)] bg-[var(--panel)] hover:border-indigo-400"
      }`}
    >
      <IconUpload className={compact ? "h-4 w-4 text-indigo-500" : "h-7 w-7 text-indigo-500"} />
      <p className={compact ? "text-sm font-medium" : "text-base font-semibold"}>
        {hovering ? "Drop them here" : "Drop images or folders here"}
      </p>
      {!compact && (
        <p className="max-w-sm text-xs text-[var(--ink-soft)]">
          PNG, JPEG and WebP. Everything is processed on this device — no upload, no server, no
          account.
        </p>
      )}
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        hidden
        onChange={(e) => {
          onFiles(Array.from(e.target.files ?? []).filter(isAcceptedFile));
          e.target.value = "";
        }}
      />
    </div>
  );
}
