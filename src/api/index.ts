import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, projects } from "../db/client";
import {
  getOrCreateUser,
  getOrCreateReferralCode,
  getReferralStats,
  applyReferralCode,
  getBalance,
  getProjectStats,
} from "../lib/referrals";
import { exportReferralsCSV } from "../lib/csv";
import { initializeTransaction, verifyTransaction, handleWebhookEvent } from "../lib/paystack";
import { recordPageview, getVisitorStats } from "../lib/visitors";
import { sendWelcomeEmail, sendRecoveryEmail, sendVerificationEmail } from "../lib/email";
import {
  securityHeaders,
  rateLimitByIP,
  rateLimitByProject,
  rateLimitCreate,
  verifyPaystackWebhook,
  sanitise,
} from "../lib/security";

const app = new Hono();

app.use("*", securityHeaders());
app.use(
  "*",
  cors({
    origin: "*",
    allowHeaders: ["x-project-id", "content-type", "x-page-url"],
    allowMethods: ["GET", "POST", "PATCH", "OPTIONS"],
  })
);
app.use("*", rateLimitByIP(100, 60_000));

const errResp = (code: string, message: string, status: number) =>
  new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { "content-type": "application/json" },
  });

function requireProjectAuth(c: Context, projectId: string): Response | null {
  const header = c.req.header("x-project-id");
  if (!header || header !== projectId)
    return c.json({ error: { code: "unauthorized", message: "x-project-id required" } }, 401) as unknown as Response;
  return null;
}

app.onError((err, c) => {
  console.error("[api]", err);
  return c.json({ error: { code: "internal_error", message: "Internal server error" } }, 500);
});

app.get("/health", (c) => c.json({ ok: true, version: "0.1.0", timestamp: Date.now() }));

function fire(p: Promise<unknown>, label: string) {
  p.catch((e) => console.error(`[fire-and-forget:${label}]`, e));
}

// ───────────── Project create (no payment gate) ─────────────
app.post(
  "/api/projects/create",
  rateLimitCreate(),
  zValidator(
    "json",
    z.object({
      email: z.string().email().max(254),
      name: z.string().min(1).max(80),
      partnerCode: z.string().max(30).regex(/^[A-Za-z0-9_-]+$/).optional(),
    }),
    (r, c) => {
      if (!r.success)
        return c.json({ error: { code: "invalid_input", message: "Invalid email or name" } }, 400);
    }
  ),
  async (c) => {
    const body = c.req.valid("json");
    const { email, name } = body;
    const cleanEmail = sanitise(email).toLowerCase();
    const cleanName = sanitise(name);

    const existing = await db
      .select()
      .from(projects)
      .where(eq(projects.ownerEmail, cleanEmail))
      .limit(1);

    if (existing[0]) {
      // duplicate → fire recovery email and surface 409 with friendly message
      fire(sendRecoveryEmail(existing[0].ownerEmail, existing[0].name, existing[0].id), "recovery");
      return c.json(
        {
          error: {
            code: "exists",
            message:
              "A project with this email already exists. We've sent your project ID to this email.",
          },
        },
        409
      );
    }

    const [created] = await db
      .insert(projects)
      .values({
        ownerEmail: cleanEmail,
        name: cleanName,
        active: true,
        partnerCode: body.partnerCode ? sanitise(body.partnerCode).toUpperCase() : null,
      })
      .returning();

    // Generate verification token
    const verifyToken = crypto.randomUUID();
    const verifyTokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await db
      .update(projects)
      .set({ verifyToken, verifyTokenExpiresAt, updatedAt: new Date() })
      .where(eq(projects.id, created.id));

    const appUrl = process.env.APP_URL || "http://localhost:3001";
    const verifyUrl = `${appUrl}/api/projects/verify?token=${verifyToken}`;

    // Verification email — fire and forget
    fire(sendVerificationEmail(created.ownerEmail, created.name, verifyUrl), "verify");

    const embedCode = `<script src="${appUrl}/v1.js" data-project="${created.id}"></script>`;

    return c.json({ projectId: created.id, name: created.name, embedCode });
  }
);

// ───────────── Email verification ─────────────
app.get("/api/projects/verify", async (c) => {
  const appUrl = process.env.APP_URL || "http://localhost:3001";
  const token = c.req.query("token");
  if (!token) return c.redirect(`${appUrl}/verify?status=invalid`);

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.verifyToken, token))
    .limit(1);

  if (!project) return c.redirect(`${appUrl}/verify?status=invalid`);
  if (!project.verifyTokenExpiresAt || project.verifyTokenExpiresAt < new Date()) {
    return c.redirect(`${appUrl}/verify?status=expired`);
  }

  await db
    .update(projects)
    .set({
      emailVerified: true,
      verifyToken: null,
      verifyTokenExpiresAt: null,
      updatedAt: new Date(),
    })
    .where(eq(projects.id, project.id));

  // Send welcome email now that email is verified — fire and forget
  fire(
    (async () => {
      await sendWelcomeEmail(project.ownerEmail, project.name, project.id);
      await db
        .update(projects)
        .set({ welcomeEmailSent: true, updatedAt: new Date() })
        .where(eq(projects.id, project.id));
    })(),
    "welcome-post-verify"
  );

  return c.redirect(`${appUrl}/verify?status=success&project=${project.id}`);
});

app.post(
  "/api/projects/verify/resend",
  rateLimitCreate(),
  zValidator(
    "json",
    z.object({ projectId: z.string().uuid() }),
    (r, c) => {
      if (!r.success)
        return c.json({ error: { code: "invalid_input", message: "Invalid projectId" } }, 400);
    }
  ),
  async (c) => {
    const { projectId } = c.req.valid("json");
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!project) return c.json({ ok: true });
    if (project.emailVerified) return c.json({ ok: true, message: "Already verified" });

    const verifyToken = crypto.randomUUID();
    const verifyTokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await db
      .update(projects)
      .set({ verifyToken, verifyTokenExpiresAt, updatedAt: new Date() })
      .where(eq(projects.id, project.id));

    const appUrl = process.env.APP_URL || "http://localhost:3001";
    const verifyUrl = `${appUrl}/api/projects/verify?token=${verifyToken}`;
    fire(sendVerificationEmail(project.ownerEmail, project.name, verifyUrl), "verify-resend");

    return c.json({ ok: true });
  }
);

// ───────────── Project recover ─────────────
app.post(
  "/api/projects/recover",
  rateLimitCreate(),
  zValidator(
    "json",
    z.object({ email: z.string().email().max(254) }),
    (r, c) => {
      if (!r.success)
        return c.json({ error: { code: "invalid_input", message: "Invalid email" } }, 400);
    }
  ),
  async (c) => {
    const { email } = c.req.valid("json");
    const cleanEmail = sanitise(email).toLowerCase();
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.ownerEmail, cleanEmail))
      .limit(1);
    if (project) {
      fire(sendRecoveryEmail(project.ownerEmail, project.name, project.id), "recovery");
    }
    return c.json({
      ok: true,
      message: "If a project exists for this email, we've sent the project ID.",
    });
  }
);

// ───────────── Project stats ─────────────
app.get("/api/projects/:projectId/stats", async (c) => {
  const projectId = c.req.param("projectId");
  const authErr = requireProjectAuth(c, projectId);
  if (authErr) return authErr;
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project)
    return c.json({ error: { code: "not_found", message: "Project not found" } }, 404);
  const stats = await getProjectStats(projectId);
  return c.json({ ...stats, currency: project.currency, active: project.active, emailVerified: project.emailVerified });
});

// ───────────── Project config ─────────────
app.get("/api/projects/:projectId/config", async (c) => {
  const projectId = c.req.param("projectId");
  const authErr = requireProjectAuth(c, projectId);
  if (authErr) return authErr;
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) return c.json({ error: { code: "not_found", message: "Project not found" } }, 404);
  return c.json({
    preset: project.preset,
    rewardAmount: project.rewardAmount,
    currency: project.currency,
    active: project.active,
    planType: project.planType,
    freeLimit: project.freeLimit,
  });
});

app.patch(
  "/api/projects/:projectId/config",
  rateLimitByProject(20),
  zValidator(
    "json",
    z.object({
      preset: z.enum(["cashback", "waitlist", "points"]).optional(),
      rewardAmount: z.number().int().min(0).max(10_000_000).optional(),
      currency: z.string().length(3).optional(),
    }),
    (r, c) => {
      if (!r.success) return c.json({ error: { code: "invalid_input", message: "Invalid config" } }, 400);
    }
  ),
  async (c) => {
    const projectId = c.req.param("projectId");
    const authErr = requireProjectAuth(c, projectId);
    if (authErr) return authErr;
    const body = c.req.valid("json");
    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (body.preset) update.preset = body.preset;
    if (typeof body.rewardAmount === "number") update.rewardAmount = body.rewardAmount;
    if (body.currency) update.currency = sanitise(body.currency).toUpperCase();
    const [updated] = await db
      .update(projects)
      .set(update)
      .where(eq(projects.id, projectId))
      .returning();
    if (!updated) return c.json({ error: { code: "not_found", message: "Project not found" } }, 404);
    return c.json({
      preset: updated.preset,
      rewardAmount: updated.rewardAmount,
      currency: updated.currency,
      active: updated.active,
    });
  }
);

// ───────────── Visitors ─────────────
app.get("/api/projects/:projectId/visitors", async (c) => {
  const projectId = c.req.param("projectId");
  const headerId = c.req.header("x-project-id");
  if (!headerId || headerId !== projectId)
    return c.json({ error: { code: "unauthorized", message: "x-project-id required" } }, 401);
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project)
    return c.json({ error: { code: "not_found", message: "Project not found" } }, 404);
  if (project.planType === "free")
    return c.json(
      { error: { code: "plan_limit", message: "Visitor analytics requires a Pro plan" } },
      403
    );
  const stats = await getVisitorStats(projectId);
  return c.json(stats);
});

// ───────────── Upgrade (Paystack) ─────────────
app.post(
  "/api/projects/:projectId/upgrade",
  rateLimitByProject(10),
  zValidator(
    "json",
    z.object({ cycle: z.enum(["monthly", "yearly"]).optional() }).optional(),
    () => undefined
  ),
  async (c) => {
    const projectId = c.req.param("projectId");
    const authErr = requireProjectAuth(c, projectId);
    if (authErr) return authErr;
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!project)
      return c.json({ error: { code: "not_found", message: "Project not found" } }, 404);
    let body: { cycle?: "monthly" | "yearly" } | undefined;
    try {
      body = c.req.valid("json") as { cycle?: "monthly" | "yearly" } | undefined;
    } catch {
      body = undefined;
    }
    const cycle = body?.cycle ?? "monthly";
    const amount = cycle === "yearly" ? 150_000_00 : 15_000_00;
    const planCode =
      cycle === "yearly"
        ? process.env.PAYSTACK_PLAN_CODE_YEARLY
        : process.env.PAYSTACK_PLAN_CODE_MONTHLY;
    try {
      const tx = await initializeTransaction(project.id, project.ownerEmail, amount, planCode);
      await db
        .update(projects)
        .set({ billingCycle: cycle, updatedAt: new Date() })
        .where(eq(projects.id, project.id));
      return c.json({ paymentUrl: tx.authorizationUrl, reference: tx.reference, cycle });
    } catch {
      return c.json(
        { error: { code: "payment_init_failed", message: "Could not initialise payment" } },
        502
      );
    }
  }
);

// ───────────── Disconnect (fires recovery email) ─────────────
app.post("/api/projects/:projectId/disconnect", rateLimitByProject(10), async (c) => {
  const projectId = c.req.param("projectId");
  const authErr = requireProjectAuth(c, projectId);
  if (authErr) return authErr;
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (project) {
    fire(sendRecoveryEmail(project.ownerEmail, project.name, project.id), "recovery-disconnect");
  }
  // Always 200 — never reveal existence
  return c.json({ ok: true });
});

// ───────────── Identify ─────────────
app.post(
  "/api/identify",
  rateLimitByProject(60),
  zValidator(
    "json",
    z.object({
      userId: z.string().min(1).max(128),
      email: z.string().email().max(254).optional(),
      metadata: z.record(z.unknown()).optional(),
    }),
    (r, c) => {
      if (!r.success) return c.json({ error: { code: "invalid_input", message: "Invalid body" } }, 400);
    }
  ),
  async (c) => {
    const projectId = c.req.header("x-project-id");
    if (!projectId)
      return c.json({ error: { code: "unauthorized", message: "x-project-id required" } }, 401);

    const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!project)
      return c.json({ error: { code: "not_found", message: "Project not found" } }, 404);

    const body = c.req.valid("json");
    const userId = sanitise(body.userId);
    const user = await getOrCreateUser(projectId, userId, body.email, body.metadata);
    const code = await getOrCreateReferralCode(projectId, user.id);
    const stats = await getReferralStats(projectId, user.id);

    let base = process.env.APP_URL || "http://localhost:3001";
    const pageUrl = c.req.header("x-page-url");
    if (pageUrl) {
      try {
        const u = new URL(pageUrl);
        u.searchParams.set("ref", code.code);
        base = u.toString();
      } catch {
        base = `${process.env.APP_URL || "http://localhost:3001"}?ref=${code.code}`;
      }
    } else {
      base = `${process.env.APP_URL || "http://localhost:3001"}?ref=${code.code}`;
    }

    return c.json({
      user: { id: user.id, externalUserId: user.externalUserId },
      referral: { code: code.code, shareUrl: base, stats },
    });
  }
);

// ───────────── Track ─────────────
app.post(
  "/api/track",
  rateLimitByProject(60),
  zValidator(
    "json",
    z.object({
      event: z.string().min(1).max(64),
      userId: z.string().min(1).max(128),
      payload: z.record(z.unknown()).optional(),
    }),
    (r, c) => {
      if (!r.success) return c.json({ error: { code: "invalid_input", message: "Invalid body" } }, 400);
    }
  ),
  async (c) => {
    const projectId = c.req.header("x-project-id");
    if (!projectId)
      return c.json({ error: { code: "unauthorized", message: "x-project-id required" } }, 401);
    const body = c.req.valid("json");
    const userId = sanitise(body.userId);

    if (body.event === "referral.convert") {
      const codeRaw = body.payload?.code;
      const codeSchema = z.string().min(1).max(20);
      const parsed = codeSchema.safeParse(codeRaw);
      if (!parsed.success)
        return c.json({ error: { code: "invalid_input", message: "code required" } }, 400);
      const code = sanitise(parsed.data);
      const result = await applyReferralCode(projectId, userId, code);
      return c.json(result);
    }
    return c.json({ ok: true, rewarded: false });
  }
);

// ───────────── Track pageview ─────────────
app.post(
  "/api/track/pageview",
  rateLimitByProject(120),
  zValidator(
    "json",
    z.object({
      visitorId: z.string().min(1).max(128),
      path: z.string().max(500).optional(),
      referrerCode: z
        .string()
        .max(20)
        .regex(/^[A-Za-z0-9]+$/, "alphanumeric only")
        .optional(),
      userAgent: z.string().max(300).optional(),
    }),
    (r, c) => {
      if (!r.success)
        return c.json({ error: { code: "invalid_input", message: "Invalid pageview" } }, 400);
    }
  ),
  async (c) => {
    const projectId = c.req.header("x-project-id");
    if (!projectId)
      return c.json({ error: { code: "unauthorized", message: "x-project-id required" } }, 401);

    const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!project)
      return c.json({ error: { code: "not_found", message: "Project not found" } }, 404);

    const body = c.req.valid("json");
    // Visitor tracking is ALWAYS on, regardless of plan or soft-lock state.
    await recordPageview(
      projectId,
      sanitise(body.visitorId),
      body.path,
      body.referrerCode,
      body.userAgent
    );
    return c.json({ ok: true });
  }
);

// ───────────── Referral ─────────────
app.get("/api/referral/:userId", rateLimitByProject(60), async (c) => {
  const projectId = c.req.header("x-project-id");
  if (!projectId)
    return c.json({ error: { code: "unauthorized", message: "x-project-id required" } }, 401);
  const userId = sanitise(c.req.param("userId"));
  const user = await getOrCreateUser(projectId, userId);
  const code = await getOrCreateReferralCode(projectId, user.id);
  const stats = await getReferralStats(projectId, user.id);
  const shareUrl = `${process.env.APP_URL || "http://localhost:3001"}?ref=${code.code}`;
  return c.json({ code: code.code, shareUrl, stats });
});

// ───────────── Balance ─────────────
app.get("/api/balance/:userId", rateLimitByProject(60), async (c) => {
  const projectId = c.req.header("x-project-id");
  if (!projectId)
    return c.json({ error: { code: "unauthorized", message: "x-project-id required" } }, 401);
  const userId = sanitise(c.req.param("userId"));
  const bal = await getBalance(projectId, userId);
  return c.json(bal);
});

// ───────────── CSV export ─────────────
app.get("/api/export/referrals", rateLimitByProject(5), async (c) => {
  const projectId = c.req.header("x-project-id");
  if (!projectId)
    return c.json({ error: { code: "unauthorized", message: "x-project-id required" } }, 401);
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project)
    return c.json({ error: { code: "not_found", message: "Project not found" } }, 404);
  if (!project.active)
    return c.json({ error: { code: "inactive", message: "Project not active" } }, 403);
  if (project.planType === "free")
    return c.json(
      { error: { code: "plan_limit", message: "CSV export requires a Pro plan" } },
      403
    );
  const csv = await exportReferralsCSV(projectId);
  const date = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="rippl-referrals-${date}.csv"`,
    },
  });
});

// ───────────── Paystack callback ─────────────
app.get("/api/paystack/callback", async (c) => {
  const reference = c.req.query("reference");
  if (!reference) return errResp("invalid_input", "reference required", 400);
  try {
    const v = await verifyTransaction(reference);
    const metaProjectId = v.metadataProjectId ?? c.req.query("project");
    if (v.status && metaProjectId) {
      await db
        .update(projects)
        .set({
          active: true,
          // Note: planType flips to "pro" via webhook charge.success — not here.
          paystackCustomerCode: v.customerCode ?? null,
          paystackSubscriptionCode: v.subscriptionCode ?? null,
          updatedAt: new Date(),
        })
        .where(eq(projects.id, metaProjectId));
    }
    const appUrl = process.env.APP_URL || "http://localhost:3001";
    return c.redirect(`${appUrl}/success?project=${metaProjectId ?? ""}`);
  } catch {
    const appUrl = process.env.APP_URL || "http://localhost:3001";
    return c.redirect(`${appUrl}/cancel`);
  }
});

// ───────────── Paystack webhook ─────────────
app.post("/api/paystack/webhook", async (c) => {
  const rawBody = await c.req.text();
  const signature = c.req.header("x-paystack-signature") ?? null;
  if (!verifyPaystackWebhook(rawBody, signature)) {
    console.warn("[webhook] invalid signature");
    return c.json({ error: { code: "unauthorized", message: "Invalid signature" } }, 401);
  }
  try {
    const parsed = JSON.parse(rawBody) as { event: string; data: Record<string, unknown> };
    await handleWebhookEvent(parsed.event, parsed.data);
    return c.json({ ok: true });
  } catch {
    return c.json({ error: { code: "invalid_payload", message: "Bad payload" } }, 400);
  }
});

export default app;
