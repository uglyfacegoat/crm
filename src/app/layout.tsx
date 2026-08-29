import type { Metadata, Viewport } from "next";
import "@fontsource-variable/onest";
import "@fontsource-variable/geologica";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "CRM — Сервисная компания",
    template: "%s · CRM",
  },
  description: "Управление заказами, клиентами, выездами и документами",
};

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#0b0e10",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
