import { test, expect } from "@playwright/test";
import path from "path";
import fs from "fs";
import os from "os";

// ---------------------------------------------------------------------------
// Helper: gera um vídeo WebM válido via MediaRecorder no browser
// e retorna o buffer como base64 para uso nos testes.
// ---------------------------------------------------------------------------

async function generateWebMBuffer(
  page: import("@playwright/test").Page
): Promise<Buffer> {
  const base64 = await page.evaluate(async () => {
    return new Promise<string>((resolve, reject) => {
      const canvas = document.createElement("canvas");
      canvas.width = 320;
      canvas.height = 240;
      const ctx = canvas.getContext("2d")!;
      const stream = canvas.captureStream(10);

      if (!MediaRecorder.isTypeSupported("video/webm")) {
        reject(new Error("video/webm not supported in this browser"));
        return;
      }

      const recorder = new MediaRecorder(stream, { mimeType: "video/webm" });
      const chunks: BlobPart[] = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: "video/webm" });
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      };

      recorder.onerror = () => reject(new Error("MediaRecorder error"));

      let frame = 0;
      const colors = ["#ef4444", "#22c55e", "#3b82f6", "#eab308"];
      const interval = setInterval(() => {
        ctx.fillStyle = colors[frame % colors.length];
        ctx.fillRect(0, 0, 320, 240);
        frame++;
      }, 100);

      recorder.start(100);

      setTimeout(() => {
        clearInterval(interval);
        recorder.stop();
        stream.getTracks().forEach((t) => t.stop());
      }, 1200);
    });
  });

  // Remove o prefixo "data:video/webm;base64,"
  const raw = base64.replace(/^data:[^;]+;base64,/, "");
  return Buffer.from(raw, "base64");
}

// ---------------------------------------------------------------------------
// Testes
// ---------------------------------------------------------------------------

test.describe("Fluxo de processamento", () => {
  test.beforeEach(async ({ page }) => {
    // WebM criado por MediaRecorder não tem metadado de duração —
    // video.duration retorna Infinity, reprovando o validador.
    // Patch: se duration for Infinity em blob URL, devolve 2s.
    await page.addInitScript(() => {
      const original = Object.getOwnPropertyDescriptor(
        HTMLMediaElement.prototype,
        "duration"
      )!;
      Object.defineProperty(HTMLMediaElement.prototype, "duration", {
        get() {
          const val = original.get!.call(this);
          if (!isFinite(val) && this.src?.startsWith("blob:")) return 2;
          return val;
        },
        configurable: true,
      });
    });

    await page.goto("/");
    await page.waitForSelector('input[type="file"]', { state: "attached" });
  });

  test("exibe painel de processamento após upload de vídeo válido", async ({
    page,
  }) => {

    // Gera um vídeo WebM real via Canvas+MediaRecorder no browser
    const videoBuffer = await generateWebMBuffer(page);
    const tmpPath = path.join(os.tmpdir(), "test-ollie.webm");
    fs.writeFileSync(tmpPath, videoBuffer);

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: "test-ollie.webm",
      mimeType: "video/webm",
      buffer: videoBuffer,
    });

    // O painel de processamento deve aparecer (status muda para extracting/inferring)
    await expect(page.getByText(/Preparando|Detectando|Identificando/)).toBeVisible({
      timeout: 10_000,
    });

    fs.unlinkSync(tmpPath);
  });

  test("botão Cancelar aparece durante o processamento", async ({ page }) => {
    const videoBuffer = await generateWebMBuffer(page);

    await page.locator('input[type="file"]').setInputFiles({
      name: "test-ollie.webm",
      mimeType: "video/webm",
      buffer: videoBuffer,
    });

    await expect(page.getByRole("button", { name: /Cancelar/ })).toBeVisible({
      timeout: 10_000,
    });
  });

  test("cancelar processamento volta para a tela de upload", async ({
    page,
  }) => {
    const videoBuffer = await generateWebMBuffer(page);

    await page.locator('input[type="file"]').setInputFiles({
      name: "test-ollie.webm",
      mimeType: "video/webm",
      buffer: videoBuffer,
    });

    const cancelBtn = page.getByRole("button", { name: /Cancelar/ });
    await expect(cancelBtn).toBeVisible({ timeout: 10_000 });
    await cancelBtn.click();

    // Painel de processamento some — uploader volta (mesmo que mostre o nome do arquivo)
    await expect(cancelBtn).not.toBeVisible({ timeout: 5_000 });
    await expect(page.locator('input[type="file"]')).toBeAttached({ timeout: 3_000 });
  });

  test("não exibe mensagem de erro após cancelar (estado limpo)", async ({
    page,
  }) => {
    const videoBuffer = await generateWebMBuffer(page);

    await page.locator('input[type="file"]').setInputFiles({
      name: "test-ollie.webm",
      mimeType: "video/webm",
      buffer: videoBuffer,
    });

    const cancelBtn = page.getByRole("button", { name: /Cancelar/ });
    await expect(cancelBtn).toBeVisible({ timeout: 10_000 });
    await cancelBtn.click();

    // Nenhuma mensagem de erro deve estar visível
    await expect(page.locator(".text-red-400")).not.toBeVisible({
      timeout: 2_000,
    });
  });
});
