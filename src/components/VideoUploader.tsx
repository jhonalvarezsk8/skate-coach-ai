"use client";

import { useCallback, useRef, useState } from "react";
import { validateVideo } from "@/lib/video/videoValidator";

interface Props {
  onVideoSelected: (file: File) => void;
  disabled?: boolean;
}

export default function VideoUploader({ onVideoSelected, disabled = false }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  const handleFile = useCallback(
    async (file: File) => {
      setValidationError(null);

      const validation = await validateVideo(file);
      if (!validation.ok) {
        setValidationError(validation.message ?? "Erro ao validar o vídeo.");
        return;
      }

      // Show preview thumbnail
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(URL.createObjectURL(file));
      setFileName(file.name);
      onVideoSelected(file);
    },
    [onVideoSelected, previewUrl]
  );

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const onDragLeave = () => setIsDragging(false);

  return (
    <div className="flex flex-col items-center gap-4 w-full max-w-md">
      <div
        className={`w-full border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors
          ${isDragging ? "border-red-400 bg-red-950/30" : "border-neutral-600 hover:border-neutral-400"}
          ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
        onClick={() => !disabled && inputRef.current?.click()}
        onDrop={disabled ? undefined : onDrop}
        onDragOver={disabled ? undefined : onDragOver}
        onDragLeave={onDragLeave}
      >
        <div className="flex flex-col items-center gap-2">
          <svg className="w-10 h-10 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M15 10l4.553-2.069A1 1 0 0121 8.868V15a1 1 0 01-1.553.832L15 14M4 8h11a1 1 0 011 1v6a1 1 0 01-1 1H4a1 1 0 01-1-1V9a1 1 0 011-1z" />
          </svg>
          {fileName ? (
            <p className="text-sm text-neutral-300 truncate max-w-xs">{fileName}</p>
          ) : (
            <>
              <p className="text-neutral-300 font-medium">Arraste seu vídeo aqui</p>
              <p className="text-neutral-500 text-sm">ou clique para selecionar</p>
              <p className="text-neutral-600 text-xs mt-1">MP4 · WebM · MOV · até 200 MB · máx. 30s</p>
            </>
          )}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov"
          className="hidden"
          onChange={onInputChange}
          disabled={disabled}
        />
      </div>

      {previewUrl && (
        <video
          src={previewUrl}
          className="w-full max-h-40 rounded-lg object-contain bg-black"
          muted
          playsInline
          controls={false}
        />
      )}

      {validationError && (
        <p className="text-red-400 text-sm text-center">{validationError}</p>
      )}
    </div>
  );
}
