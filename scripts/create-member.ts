import postgres from "postgres";
import { z } from "zod";
import { normalizeLoginIdentity } from "../src/server/auth/identity.ts";
import { hashPassword } from "../src/server/auth/password.ts";
import { organizationRoles } from "../src/server/auth/types.ts";

const environmentSchema = z.object({
  DATABASE_URL: z.string().url(),
  AUTH_MEMBER_ORGANIZATION_ID: z.string().uuid(),
  AUTH_MEMBER_NAME: z.string().trim().min(2).max(200),
  AUTH_MEMBER_EMAIL: z.string().email().transform((value) => value.toLocaleLowerCase("en")),
  AUTH_MEMBER_PHONE: z.string().optional(),
  AUTH_MEMBER_PASSWORD: z.string().min(12).max(128),
  AUTH_MEMBER_ROLE: z.enum(organizationRoles),
  AUTH_MEMBER_MASTER_ID: z.string().uuid().optional(),
});

const environment = environmentSchema.parse(process.env);
const emailIdentity = normalizeLoginIdentity(environment.AUTH_MEMBER_EMAIL);
const phoneIdentity = environment.AUTH_MEMBER_PHONE ? normalizeLoginIdentity(environment.AUTH_MEMBER_PHONE) : null;

if (!emailIdentity || emailIdentity.kind !== "email") throw new Error("AUTH_MEMBER_EMAIL is invalid.");
if (environment.AUTH_MEMBER_PHONE && (!phoneIdentity || phoneIdentity.kind !== "phone")) {
  throw new Error("AUTH_MEMBER_PHONE is invalid.");
}
if (environment.AUTH_MEMBER_ROLE === "master" && !environment.AUTH_MEMBER_MASTER_ID) {
  throw new Error("AUTH_MEMBER_MASTER_ID is required for a master account.");
}
if (environment.AUTH_MEMBER_ROLE !== "master" && environment.AUTH_MEMBER_MASTER_ID) {
  throw new Error("AUTH_MEMBER_MASTER_ID can only be used with AUTH_MEMBER_ROLE=master.");
}

const sql = postgres(environment.DATABASE_URL, { max: 1 });

try {
  const passwordHash = await hashPassword(environment.AUTH_MEMBER_PASSWORD);
  const memberId = await sql.begin(async (transaction) => {
    const organizations = await transaction`SELECT id, organization_kind FROM organizations WHERE id = ${environment.AUTH_MEMBER_ORGANIZATION_ID} FOR UPDATE`;
    if (organizations.length !== 1) throw new Error("The organization does not exist.");

    if (environment.AUTH_MEMBER_MASTER_ID) {
      const masters = await transaction`SELECT id FROM masters
        WHERE organization_id = ${environment.AUTH_MEMBER_ORGANIZATION_ID}
          AND id = ${environment.AUTH_MEMBER_MASTER_ID}
          AND active
        FOR UPDATE`;
      if (masters.length !== 1) throw new Error("The selected active master does not exist in this organization.");
    }

    const identities = [emailIdentity, ...(phoneIdentity ? [phoneIdentity] : [])];
    const normalizedValues = identities.map((identity) => identity.normalizedValue);
    const existingIdentities = await transaction`SELECT 1 FROM member_login_identities WHERE normalized_value IN ${transaction(normalizedValues)}`;
    if (existingIdentities.length) throw new Error("An account with this email or phone already exists.");
    if (environment.AUTH_MEMBER_ROLE === "developer" || environment.AUTH_MEMBER_ROLE === "owner") {
      await transaction`INSERT INTO developer_accounts (email, display_name, account_role)
        VALUES (${emailIdentity.normalizedValue}, ${environment.AUTH_MEMBER_NAME}, ${environment.AUTH_MEMBER_ROLE})
        ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name, account_role = EXCLUDED.account_role`;
    } else {
      const protectedAccount = await transaction`SELECT 1 FROM developer_accounts WHERE email = ${emailIdentity.normalizedValue}`;
      if (protectedAccount.length) throw new Error("The email is reserved for a developer account.");
    }

    const [member] = await transaction`INSERT INTO organization_members (organization_id, display_name, email, role, master_id)
      VALUES (${environment.AUTH_MEMBER_ORGANIZATION_ID}, ${environment.AUTH_MEMBER_NAME}, ${emailIdentity.normalizedValue}, ${environment.AUTH_MEMBER_ROLE === "developer" || environment.AUTH_MEMBER_ROLE === "owner" ? "admin" : environment.AUTH_MEMBER_ROLE}, ${environment.AUTH_MEMBER_MASTER_ID ?? null})
      RETURNING id`;

    await transaction`INSERT INTO member_login_identities ${transaction(identities.map((identity) => ({
      organization_id: environment.AUTH_MEMBER_ORGANIZATION_ID,
      member_id: member.id,
      kind: identity.kind,
      normalized_value: identity.normalizedValue,
      verified_at: new Date(),
    })), "organization_id", "member_id", "kind", "normalized_value", "verified_at")}`;
    await transaction`INSERT INTO member_credentials (organization_id, member_id, password_hash)
      VALUES (${environment.AUTH_MEMBER_ORGANIZATION_ID}, ${member.id}, ${passwordHash})`;

    if ((environment.AUTH_MEMBER_ROLE === "developer" || environment.AUTH_MEMBER_ROLE === "owner") && organizations[0].organization_kind === "center") {
      const companies = await transaction`SELECT id FROM organizations
        WHERE parent_organization_id = ${environment.AUTH_MEMBER_ORGANIZATION_ID} AND organization_kind = 'company'
        ORDER BY id FOR UPDATE`;
      for (const company of companies) {
        const [shadow] = await transaction`INSERT INTO organization_members (organization_id, display_name, email, role)
          VALUES (${company.id}, ${environment.AUTH_MEMBER_NAME}, ${emailIdentity.normalizedValue}, 'admin') RETURNING id`;
        await transaction`INSERT INTO organization_access_grants
          (principal_organization_id, principal_member_id, target_organization_id, target_member_id)
          VALUES (${environment.AUTH_MEMBER_ORGANIZATION_ID}, ${member.id}, ${company.id}, ${shadow.id})`;
      }
    }

    return String(member.id);
  });

  console.log(`Created ${environment.AUTH_MEMBER_ROLE} member ${memberId} in organization ${environment.AUTH_MEMBER_ORGANIZATION_ID}.`);
} finally {
  await sql.end();
}
