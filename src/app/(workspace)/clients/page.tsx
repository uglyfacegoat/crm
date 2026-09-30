import type { Metadata } from "next";
import { requirePagePermission } from "@/server/auth/page-access";
import { ClientsWorkspace } from "@/components/clients/clients-workspace";
import { CreateClientButton } from "@/components/clients/create-client-dialog";
import { PageHeading } from "@/components/ui/page-heading";
import { clients } from "@/lib/mock-data";
import { clientListQuerySchema } from "@/lib/client-list";
import { getAuthMode } from "@/server/auth/config";
import { hasPermission } from "@/server/auth/permissions";
import { requireOfficeSession } from "@/server/auth/session";
import { listClientsPage } from "@/server/clients/repository";

export const metadata: Metadata = { title: "Клиенты" };

export default async function ClientsPage() {
  const member = await requireOfficeSession();
  requirePagePermission(member, "clients.read");
  const preview = getAuthMode() === "preview";
  const initialPage = preview ? null : await listClientsPage(member, clientListQuerySchema.parse({}));
  return (
    <div>
      <PageHeading
        eyebrow="Единая клиентская база"
        title="Клиенты"
        description="Контакты, объекты и вся история работы с заказчиком."
        action={hasPermission(member, "clients.write") ? <CreateClientButton /> : null}
      />
      <ClientsWorkspace clients={preview ? clients : initialPage!.items} initialPage={initialPage} />
    </div>
  );
}
