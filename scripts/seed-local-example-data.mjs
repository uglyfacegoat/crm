import { createHash } from "node:crypto";
import postgres from "postgres";
import { z } from "zod";

const requiredConfirmation = "CONFIRM_LOCAL_CRM_EXAMPLE_DATA";

if (!process.argv.includes("--apply")) {
  throw new Error("Pass --apply to write local example data.");
}

const environment = z
  .object({
    DATABASE_URL: z.string().url(),
    LOCAL_EXAMPLE_SEED: z.literal(requiredConfirmation),
    LOCAL_EXAMPLE_CENTER_ID: z.string().uuid(),
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
  contractEvents: 0,
  contractEventsRepaired: 0,
};

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
      WHERE name = '046_example_organization_units.sql'
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
  });

  console.log(JSON.stringify({ status: "ok", inserted }));
} finally {
  await sql.end();
}
