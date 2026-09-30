import "server-only";
import sharp from "sharp";
import { z } from "zod";
import { hasPermission } from "@/server/auth/permissions";
import type { AuthenticatedMember } from "@/server/auth/types";
import { getDatabase } from "@/server/database";

export const profileNameSchema = z.string().trim().min(2, "Минимум 2 символа").max(200, "Максимум 200 символов");
export class InvalidProfileImageError extends Error {
  constructor() { super("Choose a PNG, JPEG or WebP image up to 2 MB."); this.name = "InvalidProfileImageError"; }
}

async function normalizeProfileImage(file: File) {
  if (file.size < 1 || file.size > 2 * 1024 * 1024) throw new InvalidProfileImageError();
  try {
    const input = Buffer.from(await file.arrayBuffer());
    const image = sharp(input, { limitInputPixels: 20_000_000, failOn: "error" });
    const metadata = await image.metadata();
    if (!metadata.format || !["jpeg", "png", "webp"].includes(metadata.format)) throw new InvalidProfileImageError();
    const output = await image.rotate().resize(256, 256, { fit: "cover" }).webp({ quality: 80 }).toBuffer();
    if (output.length > 262144) throw new InvalidProfileImageError();
    return output;
  } catch (error) {
    if (error instanceof InvalidProfileImageError) throw error;
    throw new InvalidProfileImageError();
  }
}

export async function updateOwnProfile(member: AuthenticatedMember, input: { displayName: string; photo: File | null; removePhoto: boolean }) {
  const displayName = profileNameSchema.parse(input.displayName);
  const image = input.photo && input.photo.size > 0 ? await normalizeProfileImage(input.photo) : null;
  const sql = getDatabase();
  await sql.begin(async (transaction) => {
    const [current] = await transaction`SELECT display_name FROM organization_members
      WHERE organization_id = ${member.organizationId} AND id = ${member.memberId} AND active FOR UPDATE`;
    if (!current) throw new Error("The current account is unavailable.");
    await transaction`UPDATE organization_members SET display_name = ${displayName}, version = version + 1, updated_at = now()
      WHERE organization_id = ${member.organizationId} AND id = ${member.memberId}`;
    if (image) {
      await transaction`INSERT INTO member_profile_avatars (organization_id, member_id, image_data)
        SELECT organization_id, id, ${image} FROM organization_members
        WHERE lower(email) = lower(${member.email}) AND active
        ON CONFLICT (organization_id, member_id) DO UPDATE SET
          image_data = EXCLUDED.image_data, version = member_profile_avatars.version + 1, updated_at = now()`;
    } else if (input.removePhoto) {
      await transaction`DELETE FROM member_profile_avatars avatars USING organization_members identities
        WHERE avatars.organization_id = identities.organization_id AND avatars.member_id = identities.id
          AND lower(identities.email) = lower(${member.email})`;
    }
    if (member.role === "developer" || member.role === "owner") {
      await transaction`UPDATE developer_accounts SET display_name = ${displayName} WHERE email = ${member.email}`;
    }
    await transaction`INSERT INTO audit_events
      (organization_id, actor_id, auth_session_id, action, entity_type, entity_id, changes)
      VALUES (${member.organizationId}, ${member.memberId}, ${member.sessionId}, 'organization_member.profile_update',
        'organization_member', ${member.memberId}, ${transaction.json({ before: { displayName: current.display_name }, after: { displayName, photoChanged: Boolean(image), photoRemoved: !image && input.removePhoto } })})`;
  });
}

export async function getOwnProfileAvatarUrl(member: AuthenticatedMember) {
  const [row] = await getDatabase()`SELECT avatars.version, avatars.updated_at FROM member_profile_avatars avatars
    JOIN organization_members identities ON identities.organization_id = avatars.organization_id AND identities.id = avatars.member_id
    WHERE lower(identities.email) = lower(${member.email})
    ORDER BY avatars.updated_at DESC LIMIT 1`;
  return row ? `/api/v1/profile/avatar?v=${Number(row.version)}-${new Date(row.updated_at as Date).getTime()}` : null;
}

export async function getOwnProfileAvatar(member: AuthenticatedMember) {
  const sql = getDatabase();
  const [row] = await sql`SELECT avatars.image_data FROM member_profile_avatars avatars
    JOIN organization_members identities ON identities.organization_id = avatars.organization_id AND identities.id = avatars.member_id
    WHERE lower(identities.email) = lower(${member.email})
    ORDER BY avatars.updated_at DESC LIMIT 1`;
  return row ? Buffer.from(row.image_data as Uint8Array) : null;
}

export async function getMemberProfileAvatar(member: AuthenticatedMember, targetMemberId: string) {
  const sql = getDatabase();
  const [row] = await sql`SELECT avatars.image_data FROM organization_members target
    JOIN organization_members identities ON lower(identities.email) = lower(target.email)
    JOIN member_profile_avatars avatars ON avatars.organization_id = identities.organization_id AND avatars.member_id = identities.id
    WHERE target.id = ${targetMemberId} AND target.active AND target.deleted_at IS NULL
      AND (target.organization_id = ${member.organizationId}
        OR EXISTS (SELECT 1 FROM auth_sessions session
          JOIN organization_access_grants access_grant ON access_grant.principal_organization_id = session.organization_id
            AND access_grant.principal_member_id = session.member_id
          WHERE session.id = ${member.sessionId} AND session.revoked_at IS NULL AND session.expires_at > now()
            AND access_grant.target_organization_id = target.organization_id
            AND access_grant.principal_organization_id = ${member.organizationId}
            AND ${hasPermission(member, "companies.switch")}))
    ORDER BY avatars.updated_at DESC LIMIT 1`;
  return row ? Buffer.from(row.image_data as Uint8Array) : null;
}
