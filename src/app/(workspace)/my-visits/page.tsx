import type { Metadata } from "next";
import { Link2Off } from "lucide-react";
import { redirect } from "next/navigation";
import { MasterVisitsWorkspace } from "@/components/visits/master-visits-workspace";
import { requireSession } from "@/server/auth/session";
import { listDocumentTemplates } from "@/server/document-templates/repository";
import { listAssignedMasterVisits } from "@/server/visits/repository";

export const metadata: Metadata = { title: "Мои выезды" };

export default async function MyVisitsPage() {
  const member = await requireSession();
  if (member.role !== "master") redirect("/");
  if (!member.masterId) {
    return <section className="surface-panel mx-auto grid min-h-[min(34rem,70vh)] max-w-2xl place-items-center p-6 text-center"><div className="max-w-md"><Link2Off className="mx-auto size-9 text-[#e0aa62]" /><p className="eyebrow mt-5">Требуется настройка</p><h1 className="mt-3 font-display text-2xl font-semibold text-white">Аккаунт не привязан к мастеру</h1><p className="mt-3 text-sm leading-6 text-[#7c868c]">Администратор должен связать вашу учётную запись с профилем мастера. До этого CRM не показывает выезды, чтобы исключить доступ к чужим заказам.</p></div></section>;
  }
  const [visits, templates] = await Promise.all([listAssignedMasterVisits(member), listDocumentTemplates(member)]);
  return <MasterVisitsWorkspace visits={visits} templates={templates} now={new Date().toISOString()} />;
}
