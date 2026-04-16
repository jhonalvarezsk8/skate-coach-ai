import { test, expect, type Page } from "@playwright/test";
import path from "path";
import fs from "fs";
import os from "os";

/** Gera um vídeo WebM via Canvas+MediaRecorder no browser com dimensões customizáveis. */
async function generateWebMBuffer(
  page: Page,
  width: number,
  height: number
): Promise<Buffer> {
  const base64 = await page.evaluate(
    async ({ w, h }) => {
      return new Promise<string>((resolve, reject) => {
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d")!;
        const stream = canvas.captureStream(10);
        const recorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp8" });
        const chunks: BlobPart[] = [];
        recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
        recorder.onstop = async () => {
          const blob = new Blob(chunks, { type: "video/webm" });
          const buf = await blob.arrayBuffer();
          const bytes = new Uint8Array(buf);
          let bin = "";
          bytes.forEach((b) => (bin += String.fromCharCode(b)));
          resolve(btoa(bin));
        };
        recorder.onerror = reject;
        // Draw a few frames
        let frame = 0;
        const draw = () => { ctx.fillStyle = `hsl(${frame * 30},70%,50%)`; ctx.fillRect(0, 0, w, h); frame++; };
        draw();
        recorder.start();
        const iv = setInterval(draw, 100);
        setTimeout(() => { clearInterval(iv); recorder.stop(); }, 600);
      });
    },
    { w: width, h: height }
  );
  return Buffer.from(base64, "base64");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Cria um arquivo temporário com extensão e tipo MIME desejados. */
function makeTempFile(
  name: string,
  content: Buffer | string,
  mimeType: string
): { filePath: string; mimeType: string } {
  const filePath = path.join(os.tmpdir(), name);
  fs.writeFileSync(filePath, content);
  return { filePath, mimeType };
}

/** Faz upload de um arquivo via input[type=file] sem acionar o file picker. */
async function uploadFile(
  page: import("@playwright/test").Page,
  filePath: string,
  mimeType: string
) {
  const fileInput = page.locator('input[type="file"]');
  const fileSize = fs.statSync(filePath).size;

  if (fileSize > 50 * 1024 * 1024) {
    // Playwright não aceita buffer > 50 MB — usa path direto
    await fileInput.setInputFiles(filePath);
  } else {
    await fileInput.setInputFiles({
      name: path.basename(filePath),
      mimeType,
      buffer: fs.readFileSync(filePath),
    });
  }
}

// ---------------------------------------------------------------------------
// Testes
// ---------------------------------------------------------------------------

test.describe("Validação de upload", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    // Aguarda a área de upload estar visível
    await page.waitForSelector('input[type="file"]', { state: "attached" });
  });

  test("rejeita arquivo de imagem (MIME inválido)", async ({ page }) => {
    const { filePath, mimeType } = makeTempFile(
      "foto.jpg",
      Buffer.from("fake-image-data"),
      "image/jpeg"
    );

    await uploadFile(page, filePath, mimeType);

    await expect(
      page.getByText("Formato não suportado. Use MP4, WebM ou MOV.")
    ).toBeVisible({ timeout: 3000 });

    fs.unlinkSync(filePath);
  });

  test("rejeita arquivo de texto (MIME inválido)", async ({ page }) => {
    const { filePath, mimeType } = makeTempFile(
      "doc.txt",
      "isso nao é um vídeo",
      "text/plain"
    );

    await uploadFile(page, filePath, mimeType);

    await expect(
      page.getByText("Formato não suportado. Use MP4, WebM ou MOV.")
    ).toBeVisible({ timeout: 3000 });

    fs.unlinkSync(filePath);
  });

  test("rejeita arquivo maior que 200 MB", async ({ page }) => {
    // Cria um arquivo WebM fake com tamanho > 200 MB via Buffer
    const bigBuffer = Buffer.alloc(201 * 1024 * 1024, 0x00); // 201 MB de zeros
    const { filePath, mimeType } = makeTempFile(
      "grande.webm",
      bigBuffer,
      "video/webm"
    );

    await uploadFile(page, filePath, mimeType);

    await expect(
      page.getByText(/Arquivo muito grande/)
    ).toBeVisible({ timeout: 3000 });

    fs.unlinkSync(filePath);
  });

  test("rejeita vídeo vertical (portrait)", async ({ page }) => {
    // Generate a portrait WebM (240×320 — height > width) via MediaRecorder
    const buffer = await generateWebMBuffer(page, 240, 320);

    await page.locator('input[type="file"]').setInputFiles({
      name: "vertical.webm",
      mimeType: "video/webm",
      buffer,
    });

    await expect(
      page.getByText(/Use um vídeo horizontal/)
    ).toBeVisible({ timeout: 5000 });
  });

  test("área de upload muda visual no drag-over", async ({ page }) => {
    const dropZone = page.locator("div.border-dashed");

    // Playwright não aceita DataTransfer inline — dispara via evaluate
    await dropZone.evaluate((el) => {
      el.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true }));
    });

    // Border deve mudar para vermelho (border-red-400)
    await expect(dropZone).toHaveClass(/border-red-400/, { timeout: 1000 });
  });

  test("área de upload volta ao normal após drag-leave", async ({ page }) => {
    const dropZone = page.locator("div.border-dashed");

    await dropZone.evaluate((el) => {
      el.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true }));
    });
    await dropZone.evaluate((el) => {
      el.dispatchEvent(new DragEvent("dragleave", { bubbles: true }));
    });

    await expect(dropZone).not.toHaveClass(/border-red-400/, {
      timeout: 1000,
    });
  });
});
