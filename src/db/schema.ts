import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    ownerEmail: text("owner_email").notNull(),
    active: boolean("active").notNull().default(true),
    preset: text("preset").notNull().default("waitlist"), // cashback | waitlist | points
    rewardAmount: integer("reward_amount").notNull().default(50000), // ₦500 in kobo
    currency: text("currency").notNull().default("NGN"),
    planType: text("plan_type").notNull().default("free"), // free | pro
    freeLimit: integer("free_limit").notNull().default(20),
    welcomeEmailSent: boolean("welcome_email_sent").notNull().default(false),
    limitEmailSent: boolean("limit_email_sent").notNull().default(false),
    paystackCustomerCode: text("paystack_customer_code"),
    paystackSubscriptionCode: text("paystack_subscription_code"),
    billingCycle: text("billing_cycle").notNull().default("monthly"), // "monthly" | "yearly"
    emailVerified: boolean("email_verified").notNull().default(false),
    verifyToken: text("verify_token"),
    verifyTokenExpiresAt: timestamp("verify_token_expires_at", { withTimezone: true }),
    partnerCode: text("partner_code"), // nullable — which partner referred this project
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    ownerEmailIdx: uniqueIndex("projects_owner_email_idx").on(t.ownerEmail),
  })
);

export const projectUsers = pgTable(
  "project_users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    externalUserId: text("external_user_id").notNull(),
    email: text("email"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    uq: uniqueIndex("project_users_project_external_idx").on(t.projectId, t.externalUserId),
  })
);

export const referralCodes = pgTable(
  "referral_codes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => projectUsers.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    codeIdx: uniqueIndex("referral_codes_project_code_idx").on(t.projectId, t.code),
    userIdx: uniqueIndex("referral_codes_user_idx").on(t.userId),
  })
);

export const referrals = pgTable(
  "referrals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    referrerUserId: uuid("referrer_user_id")
      .notNull()
      .references(() => projectUsers.id, { onDelete: "cascade" }),
    refereeUserId: uuid("referee_user_id")
      .notNull()
      .references(() => projectUsers.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    converted: boolean("converted").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    convertedAt: timestamp("converted_at", { withTimezone: true }),
  },
  (t) => ({
    projectIdx: index("referrals_project_idx").on(t.projectId),
    refereeIdx: uniqueIndex("referrals_project_referee_idx").on(t.projectId, t.refereeUserId),
  })
);

export const rewards = pgTable(
  "rewards",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => projectUsers.id, { onDelete: "cascade" }),
    referralId: uuid("referral_id").references(() => referrals.id, { onDelete: "set null" }),
    amount: integer("amount").notNull(), // kobo
    currency: text("currency").notNull().default("NGN"),
    status: text("status").notNull().default("available"), // available | pending | paid
    reason: text("reason").notNull().default("referral"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    userIdx: index("rewards_user_idx").on(t.userId),
    projectIdx: index("rewards_project_idx").on(t.projectId),
  })
);

export const pageviews = pgTable(
  "pageviews",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    visitorId: text("visitor_id").notNull(),
    path: text("path"),
    referrerCode: text("referrer_code"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    projectIdx: index("pageviews_project_idx").on(t.projectId),
    projectVisitorIdx: index("pageviews_project_visitor_idx").on(t.projectId, t.visitorId),
    projectCreatedIdx: index("pageviews_project_created_idx").on(t.projectId, t.createdAt),
  })
);
