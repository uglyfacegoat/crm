import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import "@fontsource-variable/onest";
import "@fontsource-variable/geologica";
import { APPEARANCE_THEME_COOKIE, DIGIT_STYLE_COOKIE, FONT_SCALE_COOKIE, parseAppearanceTheme, parseDigitStyle, parseFontScale } from "@/lib/appearance";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.CRM_PUBLIC_ORIGIN ?? "https://workspace-90780.tehstroinvest.ru"),
  title: {
    default: "CORE — рабочее пространство",
    template: "%s · CORE",
  },
  description: "Управление заказами, клиентами, выездами и документами",
  applicationName: "CORE",
  openGraph: {
    type: "website",
    siteName: "CORE",
    title: "CORE — рабочее пространство",
    description: "Управление заказами, клиентами, выездами и документами",
    images: [{ url: "/core-share.png", width: 1200, height: 630, alt: "CORE — рабочее пространство" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "CORE — рабочее пространство",
    description: "Управление заказами, клиентами, выездами и документами",
    images: ["/core-share.png"],
  },
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml", sizes: "any" }],
    shortcut: [{ url: "/icon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/apple-touch-icon.png", type: "image/png", sizes: "180x180" }],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "CORE",
  },
};

export const viewport: Viewport = {
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F6F5F0" },
    { media: "(prefers-color-scheme: dark)", color: "#25272C" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const cookieStore = await cookies();
  const fontScale = parseFontScale(cookieStore.get(FONT_SCALE_COOKIE)?.value);
  const digitStyle = parseDigitStyle(cookieStore.get(DIGIT_STYLE_COOKIE)?.value);
  const theme = parseAppearanceTheme(cookieStore.get(APPEARANCE_THEME_COOKIE)?.value);
  return (
    <html lang="ru" className="h-full antialiased" data-theme={theme} data-font-scale={fontScale} data-digit-style={digitStyle}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
