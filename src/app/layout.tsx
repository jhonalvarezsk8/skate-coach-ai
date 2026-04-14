import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SkateCoach AI",
  description: "Analise sua manobra de skate quadro a quadro",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <body className="min-h-screen bg-neutral-950 text-neutral-100 antialiased">
        {children}
      </body>
    </html>
  );
}
