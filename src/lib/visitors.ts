import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db, pageviews } from "../db/client";

const PATH_MAX = 500;
const SENSITIVE_PARAMS = ["token", "auth", "key", "password", "session", "secret", "code"];

export function sanitisePath(input?: string): string | null {
  if (!input) return null;
  let p = String(input).slice(0, PATH_MAX * 2);
  // Strip URL fragment — never store #hash or #access_token= etc.
  const hashIdx = p.indexOf("#");
  if (hashIdx >= 0) p = p.slice(0, hashIdx);
  // strip sensitive query params if present
  const qIdx = p.indexOf("?");
  if (qIdx >= 0) {
    const path = p.slice(0, qIdx);
    const query = p.slice(qIdx + 1);
    const kept: string[] = [];
    for (const pair of query.split("&")) {
      const [k] = pair.split("=");
      if (!k) continue;
      const lower = k.toLowerCase();
      if (SENSITIVE_PARAMS.some((s) => lower.includes(s))) continue;
      kept.push(pair);
    }
    p = kept.length ? `${path}?${kept.join("&")}` : path;
  }
  if (p.length > PATH_MAX) p = p.slice(0, PATH_MAX);
  return p;
}

export async function recordPageview(
  projectId: string,
  visitorId: string,
  path: string | undefined,
  referrerCode: string | undefined,
  userAgent: string | undefined
): Promise<void> {
  await db.insert(pageviews).values({
    projectId,
    visitorId: visitorId.slice(0, 128),
    path: sanitisePath(path),
    referrerCode: referrerCode ? referrerCode.slice(0, 20) : null,
    userAgent: userAgent ? userAgent.slice(0, 300) : null,
  });
}

interface WindowStats {
  uniqueVisitors: number;
  pageviews: number;
}

async function statsSince(projectId: string, since: Date | null): Promise<WindowStats> {
  const where = since
    ? and(eq(pageviews.projectId, projectId), gte(pageviews.createdAt, since))
    : eq(pageviews.projectId, projectId);
  const rows = await db
    .select({
      unique: sql<number>`count(distinct ${pageviews.visitorId})::int`,
      total: sql<number>`count(*)::int`,
    })
    .from(pageviews)
    .where(where);
  const r = rows[0];
  return {
    uniqueVisitors: Number(r?.unique ?? 0),
    pageviews: Number(r?.total ?? 0),
  };
}

export async function getVisitorStats(projectId: string) {
  const now = new Date();
  const monthStart = new Date(now);
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  const [allTime, thisMonth, today] = await Promise.all([
    statsSince(projectId, null),
    statsSince(projectId, monthStart),
    statsSince(projectId, todayStart),
  ]);

  const topRows = await db
    .select({
      path: pageviews.path,
      views: sql<number>`count(*)::int`,
      unique: sql<number>`count(distinct ${pageviews.visitorId})::int`,
    })
    .from(pageviews)
    .where(eq(pageviews.projectId, projectId))
    .groupBy(pageviews.path)
    .orderBy(desc(sql`count(*)`))
    .limit(5);

  return {
    allTime,
    thisMonth,
    today,
    topPages: topRows.map((r) => ({
      path: r.path ?? "(unknown)",
      views: Number(r.views ?? 0),
      uniqueVisitors: Number(r.unique ?? 0),
    })),
  };
}
