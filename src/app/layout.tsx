import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import "@fontsource-variable/onest";
import "@fontsource-variable/geologica";
import { DIGIT_STYLE_COOKIE, FONT_SCALE_COOKIE, parseDigitStyle, parseFontScale } from "@/lib/appearance";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "CRM — рабочее пространство",
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

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const cookieStore = await cookies();
  const fontScale = parseFontScale(cookieStore.get(FONT_SCALE_COOKIE)?.value);
  const digitStyle = parseDigitStyle(cookieStore.get(DIGIT_STYLE_COOKIE)?.value);
  return (
    <html lang="ru" className="h-full antialiased" data-font-scale={fontScale} data-digit-style={digitStyle}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
