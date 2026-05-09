// Resend transactional email helpers for Rippl.
// All sends are non-blocking — callers should not await or surface errors.

const RESEND_URL = "https://api.resend.com/emails";

function brandShell(title: string, bodyHtml: string): string {
  const appUrl = process.env.APP_URL || "http://localhost:3001";
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(
    title
  )}</title></head>
<body style="margin:0;padding:0;background:#08090C;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#E8EDF5;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#08090C;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#0F1117;border:1px solid #1E2535;border-radius:14px;overflow:hidden;">
        <tr><td style="padding:24px 28px;border-bottom:1px solid #1E2535;">
          <div style="font-size:18px;font-weight:600;color:#E8EDF5;letter-spacing:-0.01em;">
            <span style="color:#00C27C;">●</span> Rippl
          </div>
        </td></tr>
        <tr><td style="padding:28px;">
          ${bodyHtml}
        </td></tr>
        <tr><td style="padding:18px 28px;border-top:1px solid #1E2535;color:#5A6478;font-size:12px;line-height:1.6;">
          Rippl · Referral & visitor infrastructure for Webflow & Framer<br/>
          <a href="${escapeHtml(appUrl)}" style="color:#5A6478;text-decoration:none;">${escapeHtml(
    appUrl
  )}</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function send(to: string, subject: string, html: string): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn("[email] RESEND_API_KEY not set — skipping email to", to);
    return;
  }
  const from = process.env.EMAIL_FROM ?? "Rippl <no-reply@rippl.dev>";
  try {
    const res = await fetch(RESEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to, subject, html }),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      console.error("[email] resend failed", res.status, txt);
    }
  } catch (err) {
    console.error("[email] resend error", err);
  }
}

function statsCard(rows: Array<[string, string]>): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#08090C;border:1px solid #1E2535;border-radius:10px;margin:18px 0;">
    ${rows
      .map(
        ([k, v], i) => `<tr>
        <td style="padding:12px 16px;color:#5A6478;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;${
          i === 0 ? "" : "border-top:1px solid #1E2535;"
        }">${escapeHtml(k)}</td>
        <td style="padding:12px 16px;color:#E8EDF5;font-size:13px;text-align:right;${
          i === 0 ? "" : "border-top:1px solid #1E2535;"
        }">${escapeHtml(v)}</td>
      </tr>`
      )
      .join("")}
  </table>`;
}

export async function sendWelcomeEmail(
  to: string,
  projectName: string,
  projectId: string
): Promise<void> {
  const appUrl = process.env.APP_URL || "http://localhost:3001";
  const embed = `&lt;script src="${escapeHtml(
    appUrl
  )}/v1.js" data-project="${escapeHtml(projectId)}"&gt;&lt;/script&gt;`;
  const widget = `&lt;div data-rippl-widget="referral-card"&gt;&lt;/div&gt;`;
  const idShort = projectId.slice(0, 16) + "…";

  const body = `
    <h1 style="margin:0 0 8px;font-size:22px;font-weight:600;color:#E8EDF5;letter-spacing:-0.01em;">${escapeHtml(
      projectName
    )} is live</h1>
    <p style="margin:0 0 18px;color:#5A6478;font-size:14px;line-height:1.6;">
      Your project is connected and on the free plan — that's <strong style="color:#E8EDF5;">20 referrals</strong> included, no credit card.
    </p>
    <p style="margin:18px 0 8px;color:#E8EDF5;font-size:13px;font-weight:600;">1 — Paste this script before <code style="color:#00C27C;">&lt;/body&gt;</code></p>
    <pre style="background:#08090C;border:1px solid #1E2535;border-radius:8px;padding:14px;color:#00C27C;font-size:12px;font-family:'SF Mono',Menlo,monospace;overflow:auto;margin:0 0 14px;">${embed}</pre>
    <p style="margin:18px 0 8px;color:#E8EDF5;font-size:13px;font-weight:600;">2 — Drop the widget anywhere</p>
    <pre style="background:#08090C;border:1px solid #1E2535;border-radius:8px;padding:14px;color:#E8EDF5;font-size:12px;font-family:'SF Mono',Menlo,monospace;overflow:auto;margin:0 0 14px;">${widget}</pre>
    ${statsCard([
      ["Plan", "Free"],
      ["Referral limit", "20"],
      ["Project ID", idShort],
    ])}
    <p style="margin:14px 0 0;color:#5A6478;font-size:12px;line-height:1.6;">
      Lost your project ID? Reply to this email and we'll resend it.
    </p>
  `;
  await send(to, `Welcome to Rippl — ${projectName} is live`, brandShell("Welcome to Rippl", body));
}

export async function sendLimitReachedEmail(
  to: string,
  projectName: string,
  projectId: string,
  referralCount: number
): Promise<void> {
  const appUrl = process.env.APP_URL || "http://localhost:3001";
  const upgradeUrl = `${appUrl}/upgrade?project=${encodeURIComponent(projectId)}`;
  const body = `
    <h1 style="margin:0 0 8px;font-size:22px;font-weight:600;color:#E8EDF5;letter-spacing:-0.01em;">Action needed</h1>
    <p style="margin:0 0 18px;color:#5A6478;font-size:14px;line-height:1.6;">
      <strong style="color:#E8EDF5;">${escapeHtml(
        projectName
      )}</strong> just hit <strong style="color:#E8EDF5;">${referralCount} referrals</strong> — the free plan limit. New referral tracking is now <strong style="color:#E8EDF5;">paused</strong>. Upgrade to Pro to restore referral tracking and unlock visitor analytics.
    </p>
    <p style="text-align:center;margin:24px 0;">
      <a href="${escapeHtml(
        upgradeUrl
      )}" style="display:inline-block;background:#00C27C;color:#08090C;font-weight:600;font-size:14px;padding:12px 22px;border-radius:8px;text-decoration:none;">
        Upgrade to Pro
      </a>
    </p>
    ${statsCard([
      ["Referrals collected", String(referralCount)],
      ["Free limit", "20"],
      ["Status", "Paused"],
    ])}
    <p style="margin:14px 0 0;color:#5A6478;font-size:12px;line-height:1.6;">
      Upgrade unlocks unlimited referrals from ₦15,000/month or ₦150,000/year.
    </p>
  `;
  await send(
    to,
    `Action needed — ${projectName} has hit its referral limit`,
    brandShell("Limit reached", body)
  );
}

export async function sendRecoveryEmail(
  to: string,
  projectName: string,
  projectId: string
): Promise<void> {
  const body = `
    <h1 style="margin:0 0 8px;font-size:22px;font-weight:600;color:#E8EDF5;letter-spacing:-0.01em;">Your project ID</h1>
    <p style="margin:0 0 18px;color:#5A6478;font-size:14px;line-height:1.6;">
      Here's the project ID for <strong style="color:#E8EDF5;">${escapeHtml(
        projectName
      )}</strong>:
    </p>
    <pre style="background:#08090C;border:1px solid #1E2535;border-radius:8px;padding:16px;color:#00C27C;font-size:13px;font-family:'SF Mono',Menlo,monospace;overflow:auto;margin:0 0 18px;text-align:center;letter-spacing:0.02em;">${escapeHtml(
      projectId
    )}</pre>
    <p style="margin:0 0 6px;color:#E8EDF5;font-size:13px;font-weight:600;">To reconnect:</p>
    <ol style="margin:0 0 18px;padding-left:20px;color:#5A6478;font-size:13px;line-height:1.7;">
      <li>Open the Rippl plugin</li>
      <li>Click <strong style="color:#E8EDF5;">Reconnect with project ID</strong></li>
      <li>Paste the ID above</li>
    </ol>
    <p style="margin:14px 0 0;color:#5A6478;font-size:12px;line-height:1.6;">
      Didn't request this? Ignore this email.
    </p>
  `;
  await send(to, `Your Rippl project ID — ${projectName}`, brandShell("Project ID", body));
}

export async function sendVerificationEmail(
  to: string,
  projectName: string,
  verifyUrl: string
): Promise<void> {
  const body = `
    <h1 style="margin:0 0 8px;font-size:22px;font-weight:600;color:#E8EDF5;letter-spacing:-0.01em;">Confirm your email</h1>
    <p style="margin:0 0 18px;color:#5A6478;font-size:14px;line-height:1.6;">
      You're almost set. Click below to verify your email address for <strong style="color:#E8EDF5;">${escapeHtml(
        projectName
      )}</strong>. This link expires in 24 hours.
    </p>
    <p style="text-align:center;margin:24px 0;">
      <a href="${escapeHtml(
        verifyUrl
      )}" style="display:inline-block;background:#00C27C;color:#08090C;font-weight:700;font-size:14px;padding:14px 26px;border-radius:8px;text-decoration:none;">
        Confirm email →
      </a>
    </p>
    <p style="margin:14px 0 0;color:#5A6478;font-size:12px;line-height:1.6;">
      If you didn't create a Rippl project, ignore this email.
    </p>
  `;
  await send(
    to,
    `Confirm your email — ${projectName}`,
    brandShell("Confirm your email", body)
  );
}
