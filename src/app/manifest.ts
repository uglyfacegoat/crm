import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CRM Мастер",
    short_name: "CRM",
    description: "Выезды, чат и рабочие документы мастера",
    start_url: "/my-visits",
    scope: "/",
    display: "standalone",
    background_color: "#F6F5F0",
    theme_color: "#25272C",
    orientation: "portrait-primary",
    icons: [
      {
        src: "/crm-app-icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/crm-app-icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      { name: "Мои выезды", short_name: "Выезды", url: "/my-visits" },
      { name: "Рабочий чат", short_name: "Чат", url: "/chat" },
    ],
  };
}
