import { eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, referrals, projectUsers } from "../db/client";

const referrerUsers = alias(projectUsers, "referrer_users");
const refereeUsers = alias(projectUsers, "referee_users");

function escape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function exportReferralsCSV(projectId: string): Promise<string> {
  const rows = await db
    .select({
      id: referrals.id,
      code: referrals.code,
      converted: referrals.converted,
      createdAt: referrals.createdAt,
      convertedAt: referrals.convertedAt,
      referrerExternal: referrerUsers.externalUserId,
      referrerEmail: referrerUsers.email,
      refereeExternal: refereeUsers.externalUserId,
      refereeEmail: refereeUsers.email,
    })
    .from(referrals)
    .leftJoin(referrerUsers, eq(referrerUsers.id, referrals.referrerUserId))
    .leftJoin(refereeUsers, eq(refereeUsers.id, referrals.refereeUserId))
    .where(eq(referrals.projectId, projectId));

  const header = [
    "id",
    "code",
    "converted",
    "created_at",
    "converted_at",
    "referrer_user_id",
    "referrer_email",
    "referee_user_id",
    "referee_email",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.id,
        r.code,
        r.converted ? "true" : "false",
        r.createdAt?.toISOString() ?? "",
        r.convertedAt?.toISOString() ?? "",
        r.referrerExternal ?? "",
        r.referrerEmail ?? "",
        r.refereeExternal ?? "",
        r.refereeEmail ?? "",
      ]
        .map(escape)
        .join(",")
    );
  }
  return lines.join("\n");
}
