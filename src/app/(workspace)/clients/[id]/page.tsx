import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ClientDetailWorkspace } from "@/components/clients/client-detail-workspace";
import { clients } from "@/lib/mock-data";
import { getAuthMode } from "@/server/auth/config";
import { requireOfficeSession } from "@/server/auth/session";
import { ClientNotFoundError, getClientDetail } from "@/server/clients/repository";
import { clientIdSchema } from "@/server/clients/schemas";
import type { ClientDetail } from "@/server/clients/types";

export const metadata: Metadata = { title: "Карточка клиента" };

function previewClientDetail(clientId: string): ClientDetail | null {
  const client = clients.find((record) => record.id === clientId);
  if (!client) return null;
  return {
    id: client.id, legalName: client.name, kind: client.kind === "Юр. лицо" ? "legal_entity" : "individual",
    taxId: client.taxId,
    primaryPhone: client.phone, primaryEmail: client.email, version: 1, createdAt: "2025-11-12T09:00:00.000Z",
    orderCount: client.orders,
    contacts: [
      { id: `${clientId}-contact-1`, fullName: client.contact, position: "Управляющий объектами", phone: client.phone, email: client.email, isPrimary: true, createdAt: "2025-11-12T09:00:00.000Z" },
      { id: `${clientId}-contact-2`, fullName: "Сергей Павлов", position: "Ответственный на объекте", phone: "+7 916 880-24-20", email: null, isPrimary: false, createdAt: "2026-04-03T12:00:00.000Z" },
    ],
    objects: [
      { id: `${clientId}-object-1`, name: "Основной корпус", objectType: "Жилой комплекс", address: "Москва, ул. Ленина, 15", areaSquareMeters: 8400, floorCount: 12, onsiteContact: "Сергей · +7 916 880-24-20", accessInstructions: "Вход через диспетчерскую", parkingNotes: null, restrictions: "Работы после 09:00", riskLevel: 3, infestationLevel: 2, createdAt: "2025-11-12T09:00:00.000Z" },
      { id: `${clientId}-object-2`, name: "Административный блок", objectType: "Офис", address: "Москва, ул. Пушкина, 10", areaSquareMeters: 1250, floorCount: 3, onsiteContact: null, accessInstructions: null, parkingNotes: null, restrictions: null, riskLevel: 2, infestationLevel: 1, createdAt: "2026-02-18T09:00:00.000Z" },
    ],
  };
}

export default async function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const member = await requireOfficeSession();
  if (getAuthMode() === "preview") {
    const client = previewClientDetail(id);
    if (!client) notFound();
    return <ClientDetailWorkspace client={client} />;
  }
  if (!clientIdSchema.safeParse(id).success) notFound();
  let client: ClientDetail;
  try {
    client = await getClientDetail(member, id);
  } catch (error) {
    if (error instanceof ClientNotFoundError) notFound();
    throw error;
  }
  return <ClientDetailWorkspace client={client} />;
}
