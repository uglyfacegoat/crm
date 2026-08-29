import type { Metadata } from "next";
import { SettingsWorkspace } from "@/components/settings/settings-workspace";
import { PageHeading } from "@/components/ui/page-heading";

export const metadata: Metadata = { title: "Настройки" };

export default function SettingsPage() {
  return <div><PageHeading eyebrow="Конфигурация" title="Настройки" description="Управление системой, организацией, пользователями и будущими интеграциями." /><SettingsWorkspace /></div>;
}
