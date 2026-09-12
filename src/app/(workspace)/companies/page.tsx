import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CompanySelectionWorkspace } from "@/components/organizations/company-selection-workspace";
import { PageHeading } from "@/components/ui/page-heading";
import { getAuthMode } from "@/server/auth/config";
import { hasPermission } from "@/server/auth/permissions";
import { requireOfficeSession } from "@/server/auth/session";
import { listAccessibleOrganizations } from "@/server/organizations/repository";

export const metadata: Metadata = { title: "Компании" };

export default async function CompaniesPage() {
  const member = await requireOfficeSession();
  if (!hasPermission(member, "companies.read")) redirect("/");
  const organizations =
    getAuthMode() === "preview"
      ? [
          {
            id: member.organizationId,
            name: member.organizationName,
            kind: "center" as const,
            current: true,
            units: [],
          },
          {
            id: "38ba2dd9-44fd-4692-9e4c-9639b8302fc2",
            name: "BioSave",
            kind: "company" as const,
            current: false,
            units: [
              { id: "23af3f69-780e-4c89-a192-42f8fe4dd4e2", name: "Москва", kind: "city" as const, parentId: null, address: "Москва" },
              { id: "a93a62fd-59a4-42ca-a623-7bcf15cfa32f", name: "Центр", kind: "area" as const, parentId: "23af3f69-780e-4c89-a192-42f8fe4dd4e2", address: "ЦАО и ближайшие районы" },
              { id: "242ca27e-e24b-4f4d-bc00-e8a0d3459e95", name: "Юг", kind: "area" as const, parentId: "23af3f69-780e-4c89-a192-42f8fe4dd4e2", address: "ЮАО и ЮЗАО" },
              { id: "62cd9de1-56fc-4209-847f-0dd1ab550971", name: "Санкт-Петербург", kind: "city" as const, parentId: null, address: "Санкт-Петербург" },
              { id: "58cfdb39-f2f8-4658-beb9-3d18e012fe0d", name: "Север", kind: "area" as const, parentId: "62cd9de1-56fc-4209-847f-0dd1ab550971", address: "Выборгский и Калининский районы" },
            ],
          },
          {
            id: "833ecada-8520-45fc-ae79-d26484bbfc68",
            name: "ТехСтройИнвест",
            kind: "company" as const,
            current: false,
            units: [
              { id: "ca72515e-f2ee-4e92-88f0-bfecc26ebcef", name: "Москва", kind: "city" as const, parentId: null, address: "Москва" },
              { id: "25557c60-89db-40d4-9863-bd8c75050cb3", name: "Юг", kind: "area" as const, parentId: "ca72515e-f2ee-4e92-88f0-bfecc26ebcef", address: "ЮАО и Новая Москва" },
              { id: "13a3e0fc-42b9-49bb-859a-58a69951065e", name: "Казань", kind: "city" as const, parentId: null, address: "Казань" },
              { id: "20dc25b9-a1de-4c66-b259-3aba84fe6933", name: "Центр", kind: "area" as const, parentId: "13a3e0fc-42b9-49bb-859a-58a69951065e", address: "Вахитовский район" },
            ],
          },
        ]
      : await listAccessibleOrganizations(member);

  return (
    <div>
      <PageHeading
        eyebrow="Рабочий контур"
        title="Компании"
        description="Выберите компанию, с данными которой хотите работать. Доступны только связанные с вашей учётной записью контуры."
      />
      <CompanySelectionWorkspace
        organizations={organizations}
        canManage={
          hasPermission(member, "companies.write") &&
          getAuthMode() === "required"
        }
      />
    </div>
  );
}
