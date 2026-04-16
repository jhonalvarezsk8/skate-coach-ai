import { test, expect } from "@playwright/test";

test.describe("Page load", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("exibe o título SkateCoach AI", async ({ page }) => {
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "SkateCoach AI"
    );
  });

  test("exibe o subtítulo", async ({ page }) => {
    await expect(
      page.getByText("Analise seu Ollie quadro a quadro")
    ).toBeVisible();
  });

  test("exibe a área de upload", async ({ page }) => {
    await expect(
      page.getByText("Toque ou arraste seu vídeo aqui")
    ).toBeVisible();
  });

  test("exibe dica de formatos aceitos", async ({ page }) => {
    await expect(page.getByText(/MP4.*WebM.*MOV/)).toBeVisible();
  });

  test("exibe spinner enquanto o modelo carrega", async ({ page }) => {
    // Spinner aparece imediatamente (status idle/loading_model)
    const spinner = page.locator("svg.animate-spin");
    await expect(spinner).toBeVisible();
  });

  test("não exibe painel de processamento na carga inicial", async ({
    page,
  }) => {
    await expect(page.getByText("Processando…")).not.toBeVisible();
    await expect(page.getByText("Cancelar")).not.toBeVisible();
  });
});

test.describe("Page load — mobile", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("exibe a área de upload em tela estreita", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByText("Toque ou arraste seu vídeo aqui")
    ).toBeVisible();
  });

  test("o título cabe na viewport mobile sem overflow", async ({ page }) => {
    await page.goto("/");
    const heading = page.getByRole("heading", { level: 1 });
    const box = await heading.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390 + 1); // +1 tolerância
  });
});
