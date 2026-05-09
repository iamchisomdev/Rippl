import { and, eq, gte, sql } from "drizzle-orm";
import { db, projectUsers, referralCodes, referrals, rewards, projects } from "../db/client";
import { sendLimitReachedEmail } from "./email";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function genCode(len = 8): string {
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const buf = new Uint8Array(len);
    crypto.getRandomValues(buf);
    return Array.from(buf)
      .map((b) => ALPHABET[b % ALPHABET.length])
      .join("");
  }
  let out = "";
  for (let i = 0; i < len; i++) out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return out;
}

export async function getOrCreateUser(
  projectId: string,
  externalUserId: string,
  email?: string,
  metadata?: Record<string, unknown>
) {
  const existing = await db
    .select()
    .from(projectUsers)
    .where(and(eq(projectUsers.projectId, projectId), eq(projectUsers.externalUserId, externalUserId)))
    .limit(1);
  if (existing[0]) return existing[0];

  const [created] = await db
    .insert(projectUsers)
    .values({ projectId, externalUserId, email: email ?? null, metadata: metadata ?? null })
    .returning();
  return created;
}

export async function getOrCreateReferralCode(projectId: string, userId: string) {
  const existing = await db
    .select()
    .from(referralCodes)
    .where(eq(referralCodes.userId, userId))
    .limit(1);
  if (existing[0]) return existing[0];

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = genCode(8);
    try {
      const [created] = await db
        .insert(referralCodes)
        .values({ projectId, userId, code })
        .returning();
      return created;
    } catch {
      // collision, retry
    }
  }
  throw new Error("Could not generate unique referral code");
}

export async function getReferralStats(projectId: string, userId: string) {
  const rows = await db
    .select({
      total: sql<number>`count(*)::int`,
      converted: sql<number>`sum(case when ${referrals.converted} then 1 else 0 end)::int`,
    })
    .from(referrals)
    .where(and(eq(referrals.projectId, projectId), eq(referrals.referrerUserId, userId)));
  const r = rows[0] ?? { total: 0, converted: 0 };
  return { invited: Number(r.total ?? 0), converted: Number(r.converted ?? 0) };
}

export async function getProjectReferralCount(projectId: string): Promise<number> {
  const rows = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(referrals)
    .where(eq(referrals.projectId, projectId));
  return Number(rows[0]?.total ?? 0);
}

async function maybeFireLimitEmail(projectId: string): Promise<void> {
  // Atomic flip: only one caller will set the flag from false→true and fire.
  const [project] = await db
    .update(projects)
    .set({ limitEmailSent: true, updatedAt: new Date() })
    .where(and(eq(projects.id, projectId), eq(projects.limitEmailSent, false)))
    .returning();
  if (!project) return;
  const count = await getProjectReferralCount(projectId);
  void sendLimitReachedEmail(project.ownerEmail, project.name, project.id, count).catch((e) =>
    console.error("[limit-email]", e)
  );
}

export async function applyReferralCode(
  projectId: string,
  refereeExternalUserId: string,
  code: string
): Promise<{ ok: true; rewarded: boolean; amount: number; limitReached?: boolean }> {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) return { ok: true, rewarded: false, amount: 0 };

  // Free-tier soft lock — block new conversions but never break the API.
  if (project.planType === "free") {
    const count = await getProjectReferralCount(projectId);
    if (count >= project.freeLimit) {
      void maybeFireLimitEmail(projectId);
      return { ok: true, rewarded: false, amount: 0, limitReached: true };
    }
  }

  const [codeRow] = await db
    .select()
    .from(referralCodes)
    .where(and(eq(referralCodes.projectId, projectId), eq(referralCodes.code, code)))
    .limit(1);
  if (!codeRow) return { ok: true, rewarded: false, amount: 0 };

  const referee = await getOrCreateUser(projectId, refereeExternalUserId);
  if (referee.id === codeRow.userId) return { ok: true, rewarded: false, amount: 0 };

  const existing = await db
    .select()
    .from(referrals)
    .where(and(eq(referrals.projectId, projectId), eq(referrals.refereeUserId, referee.id)))
    .limit(1);
  if (existing[0]?.converted) return { ok: true, rewarded: false, amount: 0 };

  let referralId: string;
  if (existing[0]) {
    await db
      .update(referrals)
      .set({ converted: true, convertedAt: new Date() })
      .where(eq(referrals.id, existing[0].id));
    referralId = existing[0].id;
  } else {
    const [created] = await db
      .insert(referrals)
      .values({
        projectId,
        referrerUserId: codeRow.userId,
        refereeUserId: referee.id,
        code,
        converted: true,
        convertedAt: new Date(),
      })
      .returning();
    referralId = created.id;
  }

  await db.insert(rewards).values({
    projectId,
    userId: codeRow.userId,
    referralId,
    amount: project.rewardAmount,
    currency: project.currency,
    status: "available",
    reason: `referral:${code}`,
  });

  // Re-check after insert — if we just hit the limit, fire once.
  if (project.planType === "free") {
    const after = await getProjectReferralCount(projectId);
    if (after >= project.freeLimit) {
      void maybeFireLimitEmail(projectId);
    }
  }

  return { ok: true, rewarded: true, amount: project.rewardAmount };
}

export async function getBalance(projectId: string, externalUserId: string) {
  const user = await db
    .select()
    .from(projectUsers)
    .where(and(eq(projectUsers.projectId, projectId), eq(projectUsers.externalUserId, externalUserId)))
    .limit(1);
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  const currency = project?.currency ?? "NGN";
  if (!user[0]) return { available: 0, pending: 0, currency };

  const rows = await db
    .select({
      status: rewards.status,
      total: sql<number>`sum(${rewards.amount})::int`,
    })
    .from(rewards)
    .where(eq(rewards.userId, user[0].id))
    .groupBy(rewards.status);

  let available = 0;
  let pending = 0;
  for (const r of rows) {
    if (r.status === "available") available += Number(r.total ?? 0);
    if (r.status === "pending") pending += Number(r.total ?? 0);
  }
  return { available, pending, currency };
}

export async function getProjectStats(projectId: string) {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);

  const start = new Date();
  start.setDate(1);
  start.setHours(0, 0, 0, 0);

  const refRows = await db
    .select({
      total: sql<number>`count(*)::int`,
      converted: sql<number>`sum(case when ${referrals.converted} then 1 else 0 end)::int`,
    })
    .from(referrals)
    .where(and(eq(referrals.projectId, projectId), gte(referrals.createdAt, start)));

  const rewRows = await db
    .select({ total: sql<number>`coalesce(sum(${rewards.amount}),0)::int` })
    .from(rewards)
    .where(eq(rewards.projectId, projectId));

  const totalReferrals = await getProjectReferralCount(projectId);
  const freeLimit = project?.freeLimit ?? 20;
  const planType = project?.planType ?? "free";
  const limitReached = planType === "free" && totalReferrals >= freeLimit;

  return {
    referrals: Number(refRows[0]?.total ?? 0),
    conversions: Number(refRows[0]?.converted ?? 0),
    rewardsIssued: Number(rewRows[0]?.total ?? 0),
    totalReferrals,
    freeLimit,
    planType,
    limitReached,
  };
}
