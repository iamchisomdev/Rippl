import { eq } from "drizzle-orm";
import { db, projects } from "../db/client";

const PAYSTACK_BASE = "https://api.paystack.co";

function authHeaders() {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key) throw new Error("PAYSTACK_SECRET_KEY missing");
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
}

export async function initializeTransaction(
  projectId: string,
  email: string,
  amount: number,
  planCode?: string
): Promise<{ authorizationUrl: string; reference: string }> {
  const body: Record<string, unknown> = {
    amount,
    email,
    currency: "NGN",
    callback_url: `${process.env.APP_URL}/api/paystack/callback?project=${encodeURIComponent(
      projectId
    )}`,
    metadata: {
      projectId,
      custom_fields: [
        { display_name: "Project ID", variable_name: "project_id", value: projectId },
      ],
    },
  };
  if (planCode) body.plan = planCode;

  const res = await fetch(`${PAYSTACK_BASE}/transaction/initialize`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as {
    status: boolean;
    message: string;
    data?: { authorization_url: string; reference: string };
  };
  if (!json.status || !json.data) throw new Error(json.message || "Paystack init failed");
  return { authorizationUrl: json.data.authorization_url, reference: json.data.reference };
}

export async function verifyTransaction(
  reference: string
): Promise<{ status: boolean; customerCode?: string; subscriptionCode?: string; metadataProjectId?: string }> {
  const res = await fetch(`${PAYSTACK_BASE}/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: authHeaders(),
  });
  const json = (await res.json()) as {
    status: boolean;
    data?: {
      status: string;
      customer?: { customer_code?: string };
      plan_object?: { subscriptions?: Array<{ subscription_code?: string }> };
      metadata?: { projectId?: string };
    };
  };
  return {
    status: json.data?.status === "success",
    customerCode: json.data?.customer?.customer_code,
    subscriptionCode: json.data?.plan_object?.subscriptions?.[0]?.subscription_code,
    metadataProjectId: json.data?.metadata?.projectId,
  };
}

interface WebhookData {
  reference?: string;
  metadata?: { projectId?: string };
  subscription_code?: string;
  customer?: { customer_code?: string };
}

export async function handleWebhookEvent(event: string, data: WebhookData): Promise<void> {
  if (event === "charge.success") {
    const projectId = data.metadata?.projectId;
    if (!projectId || !data.reference) return;
    const v = await verifyTransaction(data.reference);
    if (!v.status) return;
    await db
      .update(projects)
      .set({
        active: true,
        planType: "pro",
        paystackCustomerCode: v.customerCode ?? data.customer?.customer_code ?? null,
        paystackSubscriptionCode: v.subscriptionCode ?? null,
        updatedAt: new Date(),
      })
      .where(eq(projects.id, projectId));
  } else if (event === "subscription.disable") {
    const sub = data.subscription_code;
    if (!sub) return;
    await db
      .update(projects)
      .set({ planType: "free", updatedAt: new Date() })
      .where(eq(projects.paystackSubscriptionCode, sub));
  } else if (event === "subscription.create") {
    const subCode = data.subscription_code;
    const custCode = data.customer?.customer_code;
    if (!subCode || !custCode) return;
    await db
      .update(projects)
      .set({ paystackSubscriptionCode: subCode, updatedAt: new Date() })
      .where(eq(projects.paystackCustomerCode, custCode));
  }
}
