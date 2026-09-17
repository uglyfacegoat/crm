import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import "@fontsource-variable/onest";
import "@fontsource-variable/geologica";
import { APPEARANCE_THEME_COOKIE, DIGIT_STYLE_COOKIE, FONT_SCALE_COOKIE, parseAppearanceTheme, parseDigitStyle, parseFontScale } from "@/lib/appearance";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "CRM — рабочее пространство",
    template: "%s · CRM",
  },
  description: "Управление заказами, клиентами, выездами и документами",
  applicationName: "CRM Мастер",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "CRM",
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
