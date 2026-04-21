// POST /api/analyze
// Recebe o arquivo de vídeo no body da requisição (binário),
// salva num arquivo temporário, invoca o script Python analyze-server.py
// e devolve o JSON de keypoints.

import { spawn } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request) {
  const arrayBuffer = await req.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  if (buffer.length === 0) {
    return Response.json({ error: "EMPTY_BODY" }, { status: 400 });
  }

  const tmpPath = path.join(os.tmpdir(), `skaia-${Date.now()}-${Math.random().toString(36).slice(2)}.mp4`);
  await fs.writeFile(tmpPath, buffer);

  try {
    const json = await runAnalyzer(tmpPath);
    return new Response(json, {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: "ANALYZE_FAILED", message }, { status: 500 });
  } finally {
    await fs.unlink(tmpPath).catch(() => {});
  }
}

function runAnalyzer(videoPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(process.cwd(), "scripts", "analyze-server.py");
    const py = spawn("python", [scriptPath, videoPath], {
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";

    py.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf-8"); });
    py.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf-8"); });

    py.on("error", (err) => reject(err));
    py.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`python exit ${code}: ${stderr.trim().slice(-500)}`));
      }
    });
  });
}
