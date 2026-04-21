"use client";

import { useEffect, useRef, useState } from "react";
import { drawSkeleton } from "@/lib/skeleton/skeletonRenderer";
import { refFrameToPoseFrame } from "@/lib/reference/referenceLoader";
import type { ReferenceData } from "@/types";

// Debug page: carrega /test/test-user.mp4 + /test/test-user-kps.json
// (gerados pelo scripts/process-user-video.py) e desenha o esqueleto
// na cor do USUÁRIO (vermelho) usando o MESMO renderer da aplicação.
// Assim, a única variável em relação ao fluxo real é quem detectou:
// Python (aqui) vs browser (no fluxo normal).

export default function DebugPage() {
  const videoRef  = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [data, setData]       = useState<ReferenceData | null>(null);
  const [error, setError]     = useState<string | null>(null);
  const [status, setStatus]   = useState("Carregando JSON...");
  const [frameIdx, setFrame]  = useState(0);

  // Carrega o JSON gerado pelo Python
  useEffect(() => {
    fetch("/test/test-user-kps.json")
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json();
      })
      .then((json: ReferenceData) => {
        setData(json);
        setStatus(`JSON ok (${json.frames.length} frames). Aguardando video...`);
      })
      .catch(() =>
        setError(
          "Nao achei /test/test-user-kps.json. Rode primeiro o script Python.",
        ),
      );
  }, []);

  // Loop principal — roda uma vez quando os dados chegam
  useEffect(() => {
    if (!data) return;
    const v = videoRef.current;
    const c = canvasRef.current;
    if (!v || !c) return;

    const ctx = c.getContext("2d")!;
    const sourceW = data.frameWidth  ?? 720;
    const sourceH = data.frameHeight ?? 1280;

    // Dimensiona canvas proporcional ao vídeo (max 480x720)
    const scale = Math.min(480 / sourceW, 720 / sourceH);
    c.width  = Math.round(sourceW * scale);
    c.height = Math.round(sourceH * scale);

    let raf = 0;
    let stopped = false;

    const drawOnce = () => {
      const t   = v.currentTime;
      const idx = Math.min(data.frames.length - 1, Math.round(t * data.fps));
      setFrame(idx);

      ctx.clearRect(0, 0, c.width, c.height);
      if (v.readyState >= 2) {
        ctx.drawImage(v, 0, 0, c.width, c.height);
      } else {
        ctx.fillStyle = "#222";
        ctx.fillRect(0, 0, c.width, c.height);
      }

      const ref = data.frames[idx];
      if (ref?.keypoints) {
        const pf = refFrameToPoseFrame(ref, sourceW, sourceH, c.width, c.height);
        drawSkeleton(ctx, pf.keypoints, "user");
      }
    };

    const tick = () => {
      if (stopped) return;
      drawOnce();
      raf = requestAnimationFrame(tick);
    };

    const startPlayback = async () => {
      setStatus(`readyState=${v.readyState}, tentando play...`);
      try {
        await v.play();
        setStatus("Rodando.");
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setStatus(`Autoplay bloqueado (${msg}). Clique em qualquer lugar da pagina.`);
      }
      tick();
    };

    if (v.readyState >= 2) {
      startPlayback();
    } else {
      const onReady = () => {
        v.removeEventListener("loadeddata", onReady);
        v.removeEventListener("canplay",    onReady);
        startPlayback();
      };
      v.addEventListener("loadeddata", onReady);
      v.addEventListener("canplay",    onReady);
      v.load();
    }

    const onClick = () => {
      if (v.paused) v.play().catch(() => {});
    };
    document.addEventListener("click", onClick);

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      document.removeEventListener("click", onClick);
    };
  }, [data]);

  return (
    <main className="min-h-screen bg-neutral-950 text-white flex flex-col items-center gap-4 p-6">
      <h1 className="text-xl font-semibold">Debug — esqueleto gerado pelo Python</h1>

      {error && (
        <p className="max-w-md text-center text-red-400 bg-red-950/40 px-4 py-3 rounded">
          {error}
        </p>
      )}

      <p className="text-xs text-neutral-400">{status}</p>

      <canvas ref={canvasRef} className="rounded shadow-lg bg-black" />

      <video
        ref={videoRef}
        src="/test/test-user.mp4"
        muted
        playsInline
        loop
        preload="auto"
        style={{
          position: "absolute",
          top: -9999,
          left: -9999,
          width: 1,
          height: 1,
          opacity: 0,
          pointerEvents: "none",
        }}
      />

      {data && (
        <p className="text-sm text-neutral-400">
          Frame {frameIdx + 1}/{data.frames.length} @ {data.fps.toFixed(1)}fps
        </p>
      )}

      <p className="text-xs text-neutral-500 max-w-md text-center">
        Compare este esqueleto com o que aparece na pagina normal ao subir o mesmo video.
      </p>
    </main>
  );
}
