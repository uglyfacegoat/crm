import type { Metadata } from "next";
import { ClientsWorkspace } from "@/components/clients/clients-workspace";
import { CreateClientButton } from "@/components/clients/create-client-dialog";
import { PageHeading } from "@/components/ui/page-heading";
import { clients } from "@/lib/mock-data";
import { getAuthMode } from "@/server/auth/config";
import { requireSession } from "@/server/auth/session";
import { listClients } from "@/server/clients/repository";

export const metadata: Metadata = { title: "Клиенты" };

export default async function ClientsPage() {
  const member = await requireSession();
  const clientRecords = getAuthMode() === "preview" ? clients : await listClients(member);
  return (
    <div>
      <PageHeading
        eyebrow="Единая клиентская база"
        title="Клиенты"
        description="Контакты, объекты и вся история работы с заказчиком."
        action={<CreateClientButton />}
      />
      <ClientsWorkspace clients={clientRecords} />
    </div>
  );
}
