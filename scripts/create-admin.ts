import postgres from "postgres";
import { z } from "zod";
import { hashPassword } from "../src/server/auth/password.ts";
import { normalizeLoginIdentity } from "../src/server/auth/identity.ts";

const environmentSchema = z.object({
  DATABASE_URL: z.string().url(),
  AUTH_BOOTSTRAP_ORGANIZATION_NAME: z.string().trim().min(2).max(200),
  AUTH_BOOTSTRAP_TIMEZONE: z.string().trim().min(3).max(100).default("Europe/Moscow"),
  AUTH_BOOTSTRAP_ADMIN_NAME: z.string().trim().min(2).max(200),
  AUTH_BOOTSTRAP_ADMIN_EMAIL: z.string().email().transform((value) => value.toLocaleLowerCase("en")),
  AUTH_BOOTSTRAP_ADMIN_PHONE: z.string().optional(),
  AUTH_BOOTSTRAP_ADMIN_PASSWORD: z.string().min(12).max(128),
  AUTH_BOOTSTRAP_DEVELOPER: z.enum(["true", "false"]).default("false"),
});

const environment = environmentSchema.parse(process.env);
const emailIdentity = normalizeLoginIdentity(environment.AUTH_BOOTSTRAP_ADMIN_EMAIL);
const phoneIdentity = environment.AUTH_BOOTSTRAP_ADMIN_PHONE ? normalizeLoginIdentity(environment.AUTH_BOOTSTRAP_ADMIN_PHONE) : null;
if (!emailIdentity || emailIdentity.kind !== "email") throw new Error("AUTH_BOOTSTRAP_ADMIN_EMAIL is invalid.");
if (environment.AUTH_BOOTSTRAP_ADMIN_PHONE && (!phoneIdentity || phoneIdentity.kind !== "phone")) throw new Error("AUTH_BOOTSTRAP_ADMIN_PHONE is invalid.");

const sql = postgres(environment.DATABASE_URL, { max: 1 });
try {
  const passwordHash = await hashPassword(environment.AUTH_BOOTSTRAP_ADMIN_PASSWORD);
  const result = await sql.begin(async (transaction) => {
    const existingIdentity = await transaction`SELECT 1 FROM member_login_identities WHERE kind = 'email' AND normalized_value = ${emailIdentity.normalizedValue}`;
    if (existingIdentity.length) throw new Error("An account with this email already exists.");

    const [organization] = await transaction`INSERT INTO organizations (name, timezone) VALUES (${environment.AUTH_BOOTSTRAP_ORGANIZATION_NAME}, ${environment.AUTH_BOOTSTRAP_TIMEZONE}) RETURNING id`;
    if (environment.AUTH_BOOTSTRAP_DEVELOPER === "true") {
      await transaction`INSERT INTO developer_accounts (email, display_name)
        VALUES (${emailIdentity.normalizedValue}, ${environment.AUTH_BOOTSTRAP_ADMIN_NAME})
        ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name`;
    } else {
      const protectedAccount = await transaction`SELECT 1 FROM developer_accounts WHERE email = ${emailIdentity.normalizedValue}`;
      if (protectedAccount.length) throw new Error("The email is reserved for a developer account.");
    }
    const [member] = await transaction`INSERT INTO organization_members (organization_id, display_name, email, role) VALUES (${organization.id}, ${environment.AUTH_BOOTSTRAP_ADMIN_NAME}, ${emailIdentity.normalizedValue}, 'admin') RETURNING id`;
    await transaction`INSERT INTO member_login_identities (organization_id, member_id, kind, normalized_value, verified_at) VALUES (${organization.id}, ${member.id}, 'email', ${emailIdentity.normalizedValue}, now())`;
    if (phoneIdentity) await transaction`INSERT INTO member_login_identities (organization_id, member_id, kind, normalized_value, verified_at) VALUES (${organization.id}, ${member.id}, 'phone', ${phoneIdentity.normalizedValue}, now())`;
    await transaction`INSERT INTO member_credentials (organization_id, member_id, password_hash) VALUES (${organization.id}, ${member.id}, ${passwordHash})`;
    return { organizationId: String(organization.id), memberId: String(member.id) };
  });
  console.log(`Created organization ${result.organizationId} and ${environment.AUTH_BOOTSTRAP_DEVELOPER === "true" ? "developer" : "admin"} ${result.memberId}.`);
} finally {
  await sql.end();
}
