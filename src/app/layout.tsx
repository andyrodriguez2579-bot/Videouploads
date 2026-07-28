import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Historia Dominicana Studio",
  description:
    "Editorial and production workspace for the Historia Dominicana documentary series.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
