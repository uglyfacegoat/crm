import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CORE — рабочее пространство",
    short_name: "CORE",
    description: "Заявки, заказы, клиенты и рабочие инструменты компаний",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#F6F5F0",
    theme_color: "#25272C",
    orientation: "portrait-primary",
    icons: [
      {
        src: "/app-icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/app-icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/app-icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
      { src: "/core-app-icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
    shortcuts: [
      { name: "Мои выезды", short_name: "Выезды", url: "/my-visits" },
      { name: "Рабочий чат", short_name: "Чат", url: "/chat" },
    ],
  };
}
