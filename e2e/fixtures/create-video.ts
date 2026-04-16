/**
 * Creates a minimal valid WebM video blob using Canvas + MediaRecorder.
 * Runs inside the browser context via page.evaluate().
 * Returns a base64-encoded blob that can be decoded into a File in tests.
 */
export async function createMinimalVideoBlob(): Promise<string> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 240;
    const ctx = canvas.getContext("2d")!;

    const stream = canvas.captureStream(10);
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

    recorder.onerror = reject;

    // Draw a few frames so the video has duration > 0.5s
    let frame = 0;
    const colors = ["#ef4444", "#22c55e", "#3b82f6", "#eab308", "#a855f7"];

    const drawFrame = () => {
      ctx.fillStyle = colors[frame % colors.length];
      ctx.fillRect(0, 0, 320, 240);
      ctx.fillStyle = "#ffffff";
      ctx.font = "20px sans-serif";
      ctx.fillText(`Frame ${frame}`, 10, 30);
      frame++;
    };

    recorder.start(100);
    const interval = setInterval(drawFrame, 100);

    setTimeout(() => {
      clearInterval(interval);
      recorder.stop();
      stream.getTracks().forEach((t) => t.stop());
    }, 1200); // ~1.2s — well above the 0.5s minimum
  });
}
