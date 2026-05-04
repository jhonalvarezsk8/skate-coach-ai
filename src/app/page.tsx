"use client";

import { useEffect, useState } from "react";
import { useVideoProcessor } from "@/hooks/useVideoProcessor";
import VideoUploader from "@/components/VideoUploader";
import ProcessingPanel from "@/components/ProcessingPanel";
import ComparisonView from "@/components/ComparisonView";
import { loadReferenceData } from "@/lib/reference/referenceLoader";
import type { ReferenceData, PoseFrame, PhaseMap } from "@/types";
import { validateVideo } from "@/lib/video/videoValidator";

// ── PROVISIONAL: export user video keypoints as JSON (debug only) ────────────
// TODO: remove this export button once debugging is done
function exportUserKeypointsJson(poseFrames: PoseFrame[], phases: PhaseMap) {
  if (poseFrames.length === 0) return;

  const first = poseFrames[0];
  const last = poseFrames[poseFrames.length - 1];
  const durationMs = last.timestampMs - first.timestampMs;
  const fps = durationMs > 0
    ? Math.round((poseFrames.length - 1) * 1000 / durationMs * 100) / 100
    : 0;

  const payload = {
    fps,
    totalFrames: poseFrames.length,
    frameWidth: first.frameWidth,
    frameHeight: first.frameHeight,
    phases: {
      setup: phases.setup,
      pop: phases.pop,
      flick: phases.flick,
      catch: phases.catch,
      landing: phases.landing,
    },
    frames: poseFrames.map((f, i) => ({
      frame: i,
      timestampMs: Math.round(f.timestampMs * 100) / 100,
      keypoints: f.keypoints.map((k) => [
        Math.round(k.x * 10) / 10,
        Math.round(k.y * 10) / 10,
      ]),
      confidence: f.keypoints.map((k) => Math.round(k.visibility * 1000) / 1000),
    })),
  };

  const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `user-video-kps-${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function HomePage() {
  const { state, workerProvider, result, processVideo, cancel, reset } =
    useVideoProcessor();

  const [referenceData, setReferenceData] = useState<ReferenceData | null>(null);
  const [refError, setRefError] = useState<string | null>(null);

  // Load reference keypoints JSON once
  useEffect(() => {
    loadReferenceData()
      .then(setReferenceData)
      .catch(() =>
        setRefError(
          "Não foi possível carregar os dados de referência. Verifique sua conexão."
        )
      );
  }, []);

  const handleVideoSelected = async (file: File) => {
    const validation = await validateVideo(file);
    if (!validation.ok) return; // VideoUploader already shows the error

    processVideo(file);
  };

  const isProcessing = [
    "extracting",
    "inferring",
    "detecting_phases",
    "rendering",
  ].includes(state.status);

  const isReady = state.status === "ready";
  const isDone  = state.status === "done";
  const isError = state.status === "error";
  const isLoadingModel = state.status === "loading_model" || state.status === "idle";

  return (
    <main className="min-h-screen flex flex-col items-center px-4 py-10 gap-8">
      {/* Header */}
      <div className="text-center">
        <h1 className="text-3xl font-bold tracking-tight">
          <span className="text-red-500">Skate</span>Coach AI
        </h1>
        <p className="text-neutral-400 text-sm mt-1">
          Analise seu Ollie quadro a quadro
        </p>
        {workerProvider && (
          <p className="text-neutral-600 text-xs mt-1">
            Motor: {workerProvider === "webgpu" ? "WebGPU (rápido)" : "WASM"}
          </p>
        )}
      </div>

      {/* Model loading indicator */}
      {isLoadingModel && (
        <div className="flex items-center gap-2 text-neutral-400 text-sm">
          <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          {state.statusMessage}
        </div>
      )}

      {/* Reference data error */}
      {refError && (
        <div className="bg-red-950 border border-red-800 rounded-xl p-4 max-w-md w-full">
          <p className="text-red-300 text-sm">{refError}</p>
        </div>
      )}

      {/* Upload section */}
      {(isReady || isError) && (
        <div className="flex flex-col items-center gap-6 w-full max-w-md">
          <VideoUploader
            onVideoSelected={handleVideoSelected}
            disabled={!isReady}
          />

          {isError && (
            <div className="bg-red-950 border border-red-800 rounded-xl p-4 w-full">
              <p className="text-red-300 text-sm">{state.errorMessage}</p>
              <button
                onClick={reset}
                className="mt-3 text-red-400 text-xs underline hover:text-red-200"
              >
                Tentar novamente
              </button>
            </div>
          )}
        </div>
      )}

      {/* Processing panel */}
      {isProcessing && (
        <div className="w-full max-w-md">
          <ProcessingPanel state={state} onCancel={cancel} />
        </div>
      )}

      {/* Results */}
      {isDone && result && referenceData && (
        <div className="w-full max-w-3xl flex flex-col gap-6">
          <ComparisonView
            userPoseFrames={result.poseFrames}
            userKeyFrameImages={result.keyFrameImages}
            allFrameImages={result.allFrameImages}
referenceData={referenceData}
            videoUrl={result.videoUrl}
            videoAspect={result.videoAspect}
          />

          <div className="flex justify-center gap-3 flex-wrap">
            <button
              onClick={reset}
              className="px-6 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-sm transition-colors"
            >
              Analisar novo vídeo
            </button>
            {/* PROVISIONAL: debug export — remove later */}
            <button
              onClick={() => exportUserKeypointsJson(result.poseFrames, result.phases)}
              className="px-6 py-2 rounded-lg bg-amber-700 hover:bg-amber-600 text-amber-50 text-sm transition-colors"
              title="Baixa um JSON com os keypoints de cada frame do seu vídeo (apenas para debug)"
            >
              Exportar JSON (debug)
            </button>
          </div>
        </div>
      )}

      {/* Footer */}
      <p className="text-neutral-700 text-xs mt-auto">
        Protótipo v1 · Apenas Ollie · Tudo roda no browser
      </p>
    </main>
  );
}
