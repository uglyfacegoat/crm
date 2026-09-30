import { createHash } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import postgres from "postgres";
import { z } from "zod";
import { closeFileWriteGate, recordFileWriteKey, withFileWriteLease } from "../src/server/file-writes/gate.mjs";
import { storageBackend } from "../src/server/storage/s3-config.mjs";

const requiredConfirmation = "CONFIRM_LOCAL_CRM_EXAMPLE_DATA";

if (!process.argv.includes("--apply")) {
  throw new Error("Pass --apply to write local example data.");
}

const environment = z
  .object({
    DATABASE_URL: z.string().url(),
    LOCAL_EXAMPLE_SEED: z.literal(requiredConfirmation),
    LOCAL_EXAMPLE_CENTER_ID: z.string().uuid(),
    DOCUMENT_STORAGE_ROOT: z.string().min(1),
  })
  .parse(process.env);

const databaseUrl = new URL(environment.DATABASE_URL);
const allowedDatabaseHosts = new Set(["localhost", "127.0.0.1", "[::1]", "database"]);

if (databaseUrl.protocol !== "postgres:" && databaseUrl.protocol !== "postgresql:") {
  throw new Error("DATABASE_URL must use the PostgreSQL protocol.");
}

if (!allowedDatabaseHosts.has(databaseUrl.hostname)) {
  throw new Error("Local example data may only be seeded into a local or Compose PostgreSQL host.");
}

if (!isAbsolute(environment.DOCUMENT_STORAGE_ROOT)) {
  throw new Error("DOCUMENT_STORAGE_ROOT must be an absolute path.");
}

if (storageBackend(process.env) !== "local") {
  throw new Error("Local example data may only be seeded into local document storage.");
}

const companySeeds = [
  {
    name: "BioSave",
    cities: [
      { name: "Москва", areas: ["Центр", "Юг"] },
      { name: "Санкт-Петербург", areas: ["Север"] },
    ],
  },
  {
    name: "ТехСтройИнвест",
    cities: [
      { name: "Москва", areas: ["Юг", "Север"] },
      { name: "Казань", areas: ["Центр"] },
    ],
  },
];

const leadSeeds = [
  {
    externalEventId: "local-example-lead-office-v1",
    receivedOffsetMinutes: 18,
    contactName: "Анна Воронцова",
    phone: "+7 916 420-18-07",
    email: "anna.vorontsova@example.test",
    serviceInterest: "Обработка офисного центра",
    path: "/services/office",
    utmSource: "yandex",
    utmMedium: "cpc",
    utmCampaign: "office_moscow",
    status: "new",
    reviewNote: null,
  },
  {
    externalEventId: "local-example-lead-warehouse-v1",
    receivedOffsetMinutes: 132,
    contactName: "Михаил Корнеев",
    phone: "+7 903 177-42-81",
    email: "m.korneev@example.test",
    serviceInterest: "Дератизация складского комплекса",
    path: "/services/warehouse",
    utmSource: "google",
    utmMedium: "organic",
    utmCampaign: null,
    status: "new",
    reviewNote: null,
  },
  {
    externalEventId: "local-example-lead-cafe-v1",
    receivedOffsetMinutes: 1_476,
    contactName: "Елена Романова",
    phone: "+7 985 630-09-14",
    email: "elena.romanova@example.test",
    serviceInterest: "Плановая дезинсекция кафе",
    path: "/services/cafe",
    utmSource: "direct",
    utmMedium: "none",
    utmCampaign: null,
    status: "reviewing",
    reviewNote: null,
  },
  {
    externalEventId: "local-example-lead-rejected-v1",
    receivedOffsetMinutes: 2_940,
    contactName: "Тестовая заявка",
    phone: "+7 999 000-00-00",
    email: "duplicate@example.test",
    serviceInterest: "Разовая обработка помещения",
    path: "/services/request",
    utmSource: "direct",
    utmMedium: "none",
    utmCampaign: null,
    status: "rejected",
    reviewNote: "Дубликат обращения — контакт уже обработан.",
  },
];

const contractSeeds = [
  {
    contractNumber: "LOCAL-DEMO-2026-001",
    status: "active",
    startsOn: "2026-09-01",
    endsOn: "2027-08-31",
    renewalNoticeDays: 30,
    notes: "Годовое обслуживание объекта по согласованному графику.",
  },
  {
    contractNumber: "LOCAL-DEMO-2026-002",
    status: "draft",
    startsOn: "2026-10-01",
    endsOn: "2027-03-31",
    renewalNoticeDays: 14,
    notes: "Черновик договора на сезонное обслуживание.",
  },
];

function deterministicUuid(value) {
  const hex = createHash("sha256").update(`local-example:${value}`).digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const normalized = hex.join("");
  return `${normalized.slice(0, 8)}-${normalized.slice(8, 12)}-${normalized.slice(12, 16)}-${normalized.slice(16, 20)}-${normalized.slice(20)}`;
}

function createPdf(lines) {
  const escaped = lines.map((line) => line.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)"));
  const stream = `BT\n/F1 16 Tf\n72 760 Td\n${escaped.map((line, index) => `${index ? "0 -28 Td\n" : ""}(${line}) Tj`).join("\n")}\nET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n `).join("\n")}\n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body);
}

function fingerprint(externalEventId) {
  return createHash("sha256").update(`local-example:${externalEventId}`).digest("hex");
}

const inserted = {
  companies: 0,
  organizationMembers: 0,
  accessGrants: 0,
  organizationUnits: 0,
  websites: 0,
  leads: 0,
  contracts: 0,
  contractRelations: 0,
  contractEvents: 0,
  contractEventsRepaired: 0,
  documents: 0,
  documentVersions: 0,
  documentFavorites: 0,
  serviceVisits: 0,
  serviceVisitEvents: 0,
};

const createdStoragePaths = [];

try {
await withFileWriteLease(async () => {
  const sql = postgres(environment.DATABASE_URL, {
    max: 1,
    onnotice: () => undefined,
  });
  try {
  await sql.begin(async (transaction) => {
    await transaction.unsafe("SET LOCAL lock_timeout = '5s'");
    await transaction.unsafe("SET LOCAL statement_timeout = '30s'");
    await transaction`SELECT pg_advisory_xact_lock(hashtextextended('crm_local_example_seed_v1', 0))`;

    const [requiredMigration] = await transaction`
      SELECT 1
      FROM schema_migrations
      WHERE name = '053_contract_relations.sql'
    `;
    if (!requiredMigration) {
      throw new Error("Run database migrations before seeding local example data.");
    }

    const [center] = await transaction`
      SELECT id, name, timezone
      FROM organizations
      WHERE id = ${environment.LOCAL_EXAMPLE_CENTER_ID}
        AND organization_kind = 'center'
        AND parent_organization_id IS NULL
      FOR UPDATE
    `;
    if (!center || center.name !== "Local CRM") {
      throw new Error("LOCAL_EXAMPLE_CENTER_ID must identify the local 'Local CRM' center.");
    }

    const [principal] = await transaction`
      SELECT id, display_name, email
      FROM organization_members
      WHERE organization_id = ${center.id}
        AND role = 'admin'
        AND active
        AND deleted_at IS NULL
      ORDER BY created_at, id
      LIMIT 1
    `;
    if (!principal) {
      throw new Error("The local center must have an active administrator before seeding.");
    }

    for (const companySeed of companySeeds) {
      const createdCompanies = await transaction`
        INSERT INTO organizations (name, timezone, organization_kind, parent_organization_id)
        VALUES (${companySeed.name}, ${center.timezone}, 'company', ${center.id})
        ON CONFLICT DO NOTHING
        RETURNING id
      `;
      inserted.companies += createdCompanies.length;

      const [company] = await transaction`
        SELECT id
        FROM organizations
        WHERE parent_organization_id = ${center.id}
          AND lower(name) = lower(${companySeed.name})
      `;
      if (!company) throw new Error(`Unable to resolve company '${companySeed.name}'.`);

      const createdMembers = await transaction`
        INSERT INTO organization_members (organization_id, display_name, email, role, active)
        VALUES (${company.id}, ${principal.display_name}, ${principal.email}, 'admin', true)
        ON CONFLICT (organization_id, email) DO NOTHING
        RETURNING id
      `;
      inserted.organizationMembers += createdMembers.length;
      const [shadowMember] = await transaction`
        SELECT id, display_name, role, active, deleted_at, master_id
        FROM organization_members
        WHERE organization_id = ${company.id}
          AND email = ${principal.email}
      `;
      if (
        !shadowMember ||
        shadowMember.display_name !== principal.display_name ||
        shadowMember.role !== "admin" ||
        !shadowMember.active ||
        shadowMember.deleted_at !== null ||
        shadowMember.master_id !== null
      ) {
        throw new Error(`Company '${companySeed.name}' has an incompatible existing access member.`);
      }

      const [existingGrant] = await transaction`
        SELECT principal_organization_id, principal_member_id, target_member_id
        FROM organization_access_grants
        WHERE target_organization_id = ${company.id}
      `;
      if (
        existingGrant &&
        (existingGrant.principal_organization_id !== center.id ||
          existingGrant.principal_member_id !== principal.id ||
          existingGrant.target_member_id !== shadowMember.id)
      ) {
        throw new Error(`Company '${companySeed.name}' already has an access grant for another account.`);
      }
      if (!existingGrant) {
        const createdGrants = await transaction`
          INSERT INTO organization_access_grants (
            principal_organization_id,
            principal_member_id,
            target_organization_id,
            target_member_id
          )
          VALUES (${center.id}, ${principal.id}, ${company.id}, ${shadowMember.id})
          ON CONFLICT DO NOTHING
          RETURNING target_organization_id
        `;
        inserted.accessGrants += createdGrants.length;
      }

      for (const citySeed of companySeed.cities) {
        const createdCities = await transaction`
          INSERT INTO organization_units (organization_id, unit_kind, name)
          VALUES (${company.id}, 'city', ${citySeed.name})
          ON CONFLICT DO NOTHING
          RETURNING id
        `;
        inserted.organizationUnits += createdCities.length;

        const [city] = await transaction`
          SELECT id
          FROM organization_units
          WHERE organization_id = ${company.id}
            AND parent_unit_id IS NULL
            AND unit_kind = 'city'
            AND lower(name) = lower(${citySeed.name})
        `;
        if (!city) throw new Error(`Unable to resolve city '${citySeed.name}'.`);

        for (const areaName of citySeed.areas) {
          const createdAreas = await transaction`
            INSERT INTO organization_units (organization_id, parent_unit_id, unit_kind, name, address)
            VALUES (${company.id}, ${city.id}, 'area', ${areaName}, ${`${citySeed.name}, зона ${areaName}`})
            ON CONFLICT DO NOTHING
            RETURNING id
          `;
          inserted.organizationUnits += createdAreas.length;
        }
      }
    }

    const createdWebsites = await transaction`
      INSERT INTO websites (organization_id, name, domain, status)
      VALUES (${center.id}, 'Демо-источник заявок', 'crm-demo.local.test', 'active')
      ON CONFLICT (organization_id, domain) DO NOTHING
      RETURNING id
    `;
    inserted.websites += createdWebsites.length;

    const [website] = await transaction`
      SELECT id
      FROM websites
      WHERE organization_id = ${center.id}
        AND domain = 'crm-demo.local.test'
    `;
    if (!website) throw new Error("Unable to resolve the local example website.");

    const seedStartedAt = Date.now();
    for (const leadSeed of leadSeeds) {
      const reviewed = leadSeed.status === "rejected";
      const receivedAt = new Date(seedStartedAt - leadSeed.receivedOffsetMinutes * 60_000);
      const reviewedAt = reviewed ? new Date(receivedAt.getTime() + 45 * 60_000) : null;
      const createdLeads = await transaction`
        INSERT INTO website_leads (
          organization_id,
          website_id,
          external_event_id,
          received_at,
          contact_name,
          phone,
          email,
          service_interest,
          landing_url,
          utm_source,
          utm_medium,
          utm_campaign,
          payload_fingerprint,
          moderation_status,
          review_note,
          reviewed_by,
          reviewed_at
        )
        VALUES (
          ${center.id},
          ${website.id},
          ${leadSeed.externalEventId},
          ${receivedAt},
          ${leadSeed.contactName},
          ${leadSeed.phone},
          ${leadSeed.email},
          ${leadSeed.serviceInterest},
          ${`https://crm-demo.local.test${leadSeed.path}`},
          ${leadSeed.utmSource},
          ${leadSeed.utmMedium},
          ${leadSeed.utmCampaign},
          ${fingerprint(leadSeed.externalEventId)},
          ${leadSeed.status},
          ${leadSeed.reviewNote},
          ${reviewed ? principal.id : null},
          ${reviewedAt}
        )
        ON CONFLICT (organization_id, website_id, external_event_id) DO NOTHING
        RETURNING id
      `;
      inserted.leads += createdLeads.length;
    }

    const clientObjectPairs = await transaction`
      SELECT clients.id AS client_id, client_objects.id AS object_id
      FROM client_objects
      JOIN clients
        ON clients.organization_id = client_objects.organization_id
       AND clients.id = client_objects.client_id
      WHERE clients.organization_id = ${center.id}
      ORDER BY client_objects.created_at, client_objects.id
      LIMIT 2
    `;
    if (clientObjectPairs.length < contractSeeds.length) {
      throw new Error("At least two local client/object pairs are required to seed example contracts.");
    }

    for (const [index, contractSeed] of contractSeeds.entries()) {
      const pair = clientObjectPairs[index];
      const createdContracts = await transaction`
        INSERT INTO contracts (
          organization_id,
          client_id,
          object_id,
          contract_number,
          status,
          starts_on,
          ends_on,
          renewal_notice_days,
          notes,
          created_by,
          updated_by
        )
        VALUES (
          ${center.id},
          ${pair.client_id},
          ${pair.object_id},
          ${contractSeed.contractNumber},
          ${contractSeed.status},
          ${contractSeed.startsOn},
          ${contractSeed.endsOn},
          ${contractSeed.renewalNoticeDays},
          ${contractSeed.notes},
          ${principal.id},
          ${principal.id}
        )
        ON CONFLICT (organization_id, contract_number) DO NOTHING
        RETURNING id
      `;
      inserted.contracts += createdContracts.length;

      const [contract] = await transaction`
        SELECT id
        FROM contracts
        WHERE organization_id = ${center.id}
          AND contract_number = ${contractSeed.contractNumber}
      `;
      if (!contract) throw new Error(`Unable to resolve contract '${contractSeed.contractNumber}'.`);

      const [order] = await transaction`
        SELECT id, order_number
        FROM orders
        WHERE organization_id = ${center.id}
          AND client_id = ${pair.client_id}
          AND object_id = ${pair.object_id}
        ORDER BY created_at, id
        LIMIT 1
      `;
      if (!order) throw new Error(`Contract '${contractSeed.contractNumber}' requires an order for its example document.`);

      const documentId = deterministicUuid(`contract-document:${contractSeed.contractNumber}`);
      const documentVersionId = deterministicUuid(`contract-document-version:${contractSeed.contractNumber}:1`);
      const storageKey = `${center.id}/${documentId}/v1.pdf`;
      const pdf = createPdf([
        `Contract ${contractSeed.contractNumber}`,
        `Order ${order.order_number}`,
        `Period ${contractSeed.startsOn} - ${contractSeed.endsOn}`,
        "Local CRM interface preview document",
      ]);
      const sha256 = createHash("sha256").update(pdf).digest("hex");
      const storagePath = join(environment.DOCUMENT_STORAGE_ROOT, storageKey);
      await recordFileWriteKey(storageKey);
      await mkdir(join(environment.DOCUMENT_STORAGE_ROOT, center.id, documentId), { recursive: true });
      try {
        await writeFile(storagePath, pdf, { flag: "wx", mode: 0o600 });
        createdStoragePaths.push(storagePath);
      } catch (error) {
        if (!error || typeof error !== "object" || !("code" in error) || error.code !== "EEXIST") throw error;
        const existing = await readFile(storagePath);
        if (createHash("sha256").update(existing).digest("hex") !== sha256) {
          throw new Error(`Existing example document '${storagePath}' has unexpected contents.`);
        }
      }

      const createdDocuments = await transaction`
        INSERT INTO documents (
          id, organization_id, client_id, object_id, order_id, contract_id,
          title, category, description, created_by
        )
        VALUES (
          ${documentId}, ${center.id}, ${pair.client_id}, ${pair.object_id}, ${order.id}, ${contract.id},
          ${`Договор ${contractSeed.contractNumber}`}, 'contract',
          'Локальный пример документа для проверки быстрого просмотра и версий.', ${principal.id}
        )
        ON CONFLICT (id) DO NOTHING
        RETURNING id
      `;
      inserted.documents += createdDocuments.length;
      const createdVersions = await transaction`
        INSERT INTO document_versions (
          id, organization_id, document_id, version_number, original_filename, storage_key,
          mime_type, extension, size_bytes, sha256, uploaded_by
        )
        VALUES (
          ${documentVersionId}, ${center.id}, ${documentId}, 1, ${`${contractSeed.contractNumber}.pdf`}, ${storageKey},
          'application/pdf', 'pdf', ${pdf.length}, ${sha256}, ${principal.id}
        )
        ON CONFLICT (organization_id, document_id, version_number) DO NOTHING
        RETURNING id
      `;
      inserted.documentVersions += createdVersions.length;
      await transaction`
        UPDATE documents
        SET current_version_id = ${documentVersionId}, updated_at = now()
        WHERE organization_id = ${center.id} AND id = ${documentId}
          AND current_version_id IS DISTINCT FROM ${documentVersionId}
      `;
      if (index === 0) {
        const favorites = await transaction`
          INSERT INTO document_favorites (organization_id, document_id, member_id)
          VALUES (${center.id}, ${documentId}, ${principal.id})
          ON CONFLICT DO NOTHING
          RETURNING document_id
        `;
        inserted.documentFavorites += favorites.length;
      }

      const afterState = {
        contractNumber: contractSeed.contractNumber,
        status: contractSeed.status,
        startsOn: contractSeed.startsOn,
        endsOn: contractSeed.endsOn,
        renewalNoticeDays: contractSeed.renewalNoticeDays,
        version: 1,
        seed: "local-example-v1",
      };
      const [existingSeedEvent] = await transaction`
        SELECT id, jsonb_typeof(after_state) AS after_state_type
        FROM contract_events
        WHERE organization_id = ${center.id}
          AND contract_id = ${contract.id}
          AND event_type = 'created'
          AND reason = 'Добавлен локальный пример для проверки интерфейса.'
        ORDER BY created_at, id
        LIMIT 1
      `;

      if (!existingSeedEvent) {
        const createdEvents = await transaction`
          INSERT INTO contract_events (
            organization_id,
            contract_id,
            actor_id,
            event_type,
            after_state,
            reason
          )
          VALUES (
            ${center.id},
            ${contract.id},
            ${principal.id},
            'created',
            ${transaction.json(afterState)},
            'Добавлен локальный пример для проверки интерфейса.'
          )
          RETURNING id
        `;
        inserted.contractEvents += createdEvents.length;
      } else if (existingSeedEvent.after_state_type !== "object") {
        const repairedEvents = await transaction`
          UPDATE contract_events
          SET after_state = ${transaction.json(afterState)}
          WHERE organization_id = ${center.id}
            AND id = ${existingSeedEvent.id}
          RETURNING id
        `;
        inserted.contractEventsRepaired += repairedEvents.length;
      }
    }

    const relationContracts = await transaction`
      SELECT id, contract_number
      FROM contracts
      WHERE organization_id = ${center.id}
        AND contract_number IN (${contractSeeds[0].contractNumber}, ${contractSeeds[1].contractNumber})
      ORDER BY id
    `;
    if (relationContracts.length !== 2) throw new Error("Unable to resolve both contracts for the example relation.");
    const createdRelations = await transaction`
      INSERT INTO contract_relations (
        id, organization_id, contract_a_id, contract_b_id, relation_type, note, created_by
      ) VALUES (
        ${deterministicUuid("contract-relation:local-demo")}, ${center.id},
        ${relationContracts[0].id}, ${relationContracts[1].id}, 'supplement',
        'Дополнительный объём сезонных работ для связанного объекта.', ${principal.id}
      )
      ON CONFLICT (organization_id, contract_a_id, contract_b_id) DO NOTHING
      RETURNING id
    `;
    inserted.contractRelations += createdRelations.length;

    const [activityContract] = await transaction`
      SELECT contracts.id, contracts.object_id, clients.legal_name AS client_name,
        client_objects.name AS object_name, client_objects.address AS object_address
      FROM contracts
      JOIN clients ON clients.organization_id = contracts.organization_id AND clients.id = contracts.client_id
      JOIN client_objects ON client_objects.organization_id = contracts.organization_id AND client_objects.id = contracts.object_id
      WHERE contracts.organization_id = ${center.id}
        AND contracts.contract_number = ${contractSeeds[0].contractNumber}
    `;
    if (!activityContract) throw new Error("Unable to resolve the contract used for local activity data.");
    const activityPattern = [1, 3, 2, 5, 4, 2, 6, 3, 4, 7, 5, 3, 8, 4, 6, 3, 7, 5, 4, 8, 6, 3, 7, 5, 9, 6, 4, 8, 7, 6];
    const todayUtc = new Date();
    todayUtc.setUTCHours(0, 0, 0, 0);
    for (const [dayIndex, visitCount] of activityPattern.entries()) {
      const visitDate = new Date(todayUtc.getTime() - (activityPattern.length - 1 - dayIndex) * 86_400_000);
      const dateKey = visitDate.toISOString().slice(0, 10);
      for (let slot = 0; slot < visitCount; slot += 1) {
        const visitId = deterministicUuid(`activity-visit:${dateKey}:${slot}`);
        const scheduledStartAt = new Date(visitDate.getTime() + (7 + slot) * 3_600_000 + 17 * 60_000);
        const scheduledEndAt = new Date(scheduledStartAt.getTime() + 90 * 60_000);
        const createdVisits = await transaction`
          INSERT INTO service_visits (
            id, organization_id, contract_id, object_id, scheduled_start_at, scheduled_end_at,
            status, client_name_snapshot, object_name_snapshot, object_address_snapshot,
            notes, created_by, updated_by
          )
          VALUES (
            ${visitId}, ${center.id}, ${activityContract.id}, ${activityContract.object_id},
            ${scheduledStartAt}, ${scheduledEndAt}, 'confirmed', ${activityContract.client_name},
            ${activityContract.object_name}, ${activityContract.object_address},
            'Локальный пример для проверки графиков и календаря.', ${principal.id}, ${principal.id}
          )
          ON CONFLICT (id) DO NOTHING
          RETURNING id
        `;
        inserted.serviceVisits += createdVisits.length;
        if (createdVisits.length) {
          const createdEvents = await transaction`
            INSERT INTO service_visit_events (organization_id, visit_id, actor_id, event_type, after_state, reason)
            VALUES (
              ${center.id}, ${visitId}, ${principal.id}, 'created',
              ${transaction.json({ scheduledStartAt: scheduledStartAt.toISOString(), scheduledEndAt: scheduledEndAt.toISOString(), status: "confirmed", seed: "local-example-activity-v1" })},
              'Добавлен локальный пример для проверки графиков.'
            )
            RETURNING id
          `;
          inserted.serviceVisitEvents += createdEvents.length;
        }
      }
    }
  });

  console.log(JSON.stringify({ status: "ok", inserted }));
} catch (error) {
  await Promise.all(createdStoragePaths.map(async (storagePath) => {
    try { await unlink(storagePath); } catch (cleanupError) {
      if (!cleanupError || typeof cleanupError !== "object" || !("code" in cleanupError) || cleanupError.code !== "ENOENT") throw cleanupError;
    }
  }));
  throw error;
} finally {
  await sql.end();
}
});
} finally {
  await closeFileWriteGate();
}
