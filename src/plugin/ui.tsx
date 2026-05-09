import React, { useEffect, useState, useCallback } from "react";

const C = {
  bg: "#08090C",
  surface: "#0F1117",
  raised: "#161B24",
  border: "#1E2535",
  borderB: "#252F42",
  text: "#E8EDF5",
  muted: "#5A6478",
  accent: "#00C27C",
  accentD: "rgba(0,194,124,0.10)",
  accentDD: "rgba(0,194,124,0.18)",
  red: "#FF4D6A",
  redD: "rgba(255,77,106,0.08)",
  amber: "#F59E0B",
};

const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const MONO = '"SF Mono", "Fira Code", ui-monospace, monospace';

const API_BASE =
  (typeof process !== "undefined" && (process.env as Record<string, string>).VITE_API_URL) ||
  "http://localhost:3001";
const STORAGE_KEY = "rippl_project_id";

type Screen = "loading" | "connect" | "active" | "error";

interface Stats {
  referrals: number;
  conversions: number;
  rewardsIssued: number;
  totalReferrals: number;
  freeLimit: number;
  planType: "free" | "pro";
  limitReached: boolean;
  currency: string;
  active: boolean;
  emailVerified: boolean;
}
interface Config {
  preset: "cashback" | "waitlist" | "points";
  rewardAmount: number;
  currency: string;
  active: boolean;
}
interface VisitorStats {
  allTime: { uniqueVisitors: number; pageviews: number };
  thisMonth: { uniqueVisitors: number; pageviews: number };
  today: { uniqueVisitors: number; pageviews: number };
  topPages: Array<{ path: string; views: number; uniqueVisitors: number }>;
}

function Logo({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ display: "block" }}>
      <rect width="24" height="24" rx="7" fill={C.accent} />
      <path d="M6 16 Q 9 8 18 7" stroke={C.bg} strokeWidth="2.2" strokeLinecap="round" fill="none" />
      <circle cx="18" cy="7" r="1.6" fill={C.bg} />
    </svg>
  );
}

function Spinner({ size = 18, color = C.accent }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ display: "inline-block" }}>
      <circle cx="12" cy="12" r="9" stroke={color} strokeWidth="2.5" fill="none" strokeDasharray="40 60" strokeLinecap="round">
        <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.9s" repeatCount="indefinite" />
      </circle>
    </svg>
  );
}

function Wordmark() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
      <Logo />
      <span style={{ fontFamily: FONT, fontSize: 15, fontWeight: 700, color: C.text, letterSpacing: -0.3 }}>
        Rippl
      </span>
    </div>
  );
}

function fmtMoney(kobo: number, currency = "NGN"): string {
  const major = kobo / 100;
  if (currency === "NGN") {
    return `₦${major.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return major.toLocaleString("en-US", { style: "currency", currency });
}

function fmtNum(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 0 : 1) + "k";
  return String(n);
}

export default function RipplPlugin() {
  const [screen, setScreen] = useState<Screen>("loading");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [visitors, setVisitors] = useState<VisitorStats | null>(null);

  const checkStatus = useCallback(async (id: string) => {
    try {
      const [sRes, cRes, vRes] = await Promise.all([
        fetch(`${API_BASE}/api/projects/${id}/stats`, { headers: { "x-project-id": id } }),
        fetch(`${API_BASE}/api/projects/${id}/config`, { headers: { "x-project-id": id } }),
        fetch(`${API_BASE}/api/projects/${id}/visitors`, { headers: { "x-project-id": id } }),
      ]);
      if (sRes.status === 404) {
        // Project genuinely gone — clear storage
        localStorage.removeItem(STORAGE_KEY);
        setScreen("connect");
        return;
      }
      if (!sRes.ok) {
        // API error — show error state, do NOT clear storage
        setScreen("error");
        return;
      }
      const s: Stats = await sRes.json();
      const cf: Config = await cRes.json();
      const v: VisitorStats = vRes.ok
        ? await vRes.json()
        : { allTime: { uniqueVisitors: 0, pageviews: 0 }, thisMonth: { uniqueVisitors: 0, pageviews: 0 }, today: { uniqueVisitors: 0, pageviews: 0 }, topPages: [] };
      setStats(s);
      setConfig(cf);
      setVisitors(v);
      setScreen("active");
    } catch {
      // Network error — do NOT clear storage
      setScreen("error");
    }
  }, []);

  useEffect(() => {
    const id = typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
    if (id) {
      setProjectId(id);
      checkStatus(id);
    } else {
      setScreen("connect");
    }
  }, [checkStatus]);

  const wrap: React.CSSProperties = {
    width: "100%",
    maxWidth: 320,
    background: C.bg,
    color: C.text,
    fontFamily: FONT,
    minHeight: "100vh",
    margin: "0 auto",
  };

  if (screen === "loading") {
    return (
      <div style={{ ...wrap, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Spinner size={26} />
      </div>
    );
  }

  if (screen === "error")
    return (
      <div style={{ ...wrap, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", gap: 12, padding: 24 }}>
        <div style={{ fontSize: 13, color: C.muted, textAlign: "center", lineHeight: 1.6 }}>
          Could not reach Rippl.<br/>Check your connection.
        </div>
        <button onClick={() => projectId && checkStatus(projectId)}
          style={{ background: C.raised, border: `1px solid ${C.border}`, color: C.text,
            padding: "8px 16px", borderRadius: 7, fontSize: 12, cursor: "pointer", fontFamily: FONT }}>
          Retry
        </button>
      </div>
    );

  if (screen === "connect")
    return (
      <div style={wrap}>
        <ConnectScreen
          onConnected={(id) => {
            localStorage.setItem(STORAGE_KEY, id);
            setProjectId(id);
            setScreen("loading");
            checkStatus(id);
          }}
        />
      </div>
    );

  if (screen === "active" && projectId && stats && config && visitors)
    return (
      <div style={wrap}>
        <ActiveScreen
          projectId={projectId}
          stats={stats}
          config={config}
          visitors={visitors}
          refresh={() => checkStatus(projectId)}
          onDisconnect={() => {
            localStorage.removeItem(STORAGE_KEY);
            setProjectId(null);
            setStats(null);
            setConfig(null);
            setVisitors(null);
            setScreen("connect");
          }}
        />
      </div>
    );

  return null;
}

// ────────────────────────────────────────── Connect ──────────────────────────────────────────
function ConnectScreen({ onConnected }: { onConnected: (id: string) => void }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [partnerCode, setPartnerCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Reconnect flow
  const [showReconnect, setShowReconnect] = useState(false);
  const [reconnectId, setReconnectId] = useState("");
  const [reconnectErr, setReconnectErr] = useState<string | null>(null);
  const [reconnecting, setReconnecting] = useState(false);

  const submit = async () => {
    setErr(null);
    setInfo(null);
    setLoading(true);
    try {
      const r = await fetch(`${API_BASE}/api/projects/create`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email,
          name,
          ...(partnerCode.trim() ? { partnerCode: partnerCode.trim().toUpperCase() } : {}),
        }),
      });
      const j = await r.json();
      if (r.status === 409) {
        setInfo(
          j?.error?.message ??
            "A project with this email already exists. We've sent your project ID to this email."
        );
        setShowReconnect(true);
        return;
      }
      if (!r.ok) throw new Error(j?.error?.message ?? "Failed");
      onConnected(j.projectId);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const submitReconnect = async () => {
    setReconnectErr(null);
    setReconnecting(true);
    try {
      const id = reconnectId.trim();
      if (!id) throw new Error("Project ID required");
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
        setReconnectErr("Invalid project ID — check and try again");
        setReconnecting(false);
        return;
      }
      const r = await fetch(`${API_BASE}/api/projects/${encodeURIComponent(id)}/stats`);
      if (!r.ok) {
        setReconnectErr("Project ID not found");
        return;
      }
      onConnected(id);
    } catch (e) {
      setReconnectErr((e as Error).message);
    } finally {
      setReconnecting(false);
    }
  };

  const label: React.CSSProperties = {
    fontSize: 10, fontWeight: 700, letterSpacing: 1.2, textTransform: "uppercase",
    color: C.muted, marginBottom: 6, display: "block",
  };
  const input: React.CSSProperties = {
    width: "100%", background: C.raised, border: `1px solid ${C.border}`,
    borderRadius: 7, padding: "9px 12px", fontSize: 13, color: C.text,
    fontFamily: FONT, outline: "none", boxSizing: "border-box",
  };

  return (
    <div>
      <div style={{ padding: "20px 16px 0" }}>
        <Wordmark />
        <div style={{ marginTop: 6, fontSize: 11, color: C.muted }}>
          Referrals & visitor analytics for your site
        </div>
      </div>

      <div style={{ margin: 16, padding: "12px 14px", background: C.accentD,
          border: "1px solid rgba(0,194,124,0.15)", borderRadius: 9,
          fontSize: 12, color: C.muted, lineHeight: 1.6 }}>
        Add referral links to every page visitor. Reward them when their friends sign up.
      </div>

      <div style={{ padding: "0 16px", display: "flex", flexDirection: "column", gap: 10 }}>
        <div>
          <label style={label}>Email</label>
          <input style={input} value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            onFocus={(e) => (e.currentTarget.style.borderColor = C.borderB)}
            onBlur={(e) => (e.currentTarget.style.borderColor = C.border)} />
        </div>
        <div>
          <label style={label}>Project name</label>
          <input style={input} value={name} onChange={(e) => setName(e.target.value)}
            placeholder="My Framer Site"
            onFocus={(e) => (e.currentTarget.style.borderColor = C.borderB)}
            onBlur={(e) => (e.currentTarget.style.borderColor = C.border)} />
        </div>
        <div>
          <label style={label}>
            Partner code <span style={{ color: C.muted, fontWeight: 400 }}>(optional)</span>
          </label>
          <input
            style={input}
            value={partnerCode}
            onChange={(e) => setPartnerCode(e.target.value)}
            placeholder="e.g. RPL-X7K2"
            onFocus={(e) => (e.currentTarget.style.borderColor = C.borderB)}
            onBlur={(e) => (e.currentTarget.style.borderColor = C.border)}
          />
        </div>

        {err && (
          <div style={{ padding: "9px 12px", background: C.redD, borderLeft: `3px solid ${C.red}`,
            borderRadius: 7, fontSize: 12, color: C.red }}>
            {err}
          </div>
        )}

        {info && (
          <div style={{ padding: "10px 12px", background: C.accentD,
              border: `1px solid ${C.accentDD}`, borderRadius: 7, fontSize: 12,
              color: C.accent, lineHeight: 1.5 }}>
            {info}
          </div>
        )}

        <button
          disabled={loading || !email || !name}
          onClick={submit}
          style={{
            background: C.accent, color: C.bg, padding: "11px 14px",
            borderRadius: 8, fontSize: 13, fontWeight: 700, border: "none",
            width: "100%", marginTop: 4,
            cursor: loading || !email || !name ? "not-allowed" : "pointer",
            opacity: loading || !email || !name ? 0.5 : 1,
            display: "flex", alignItems: "center", justifyContent: "center",
            gap: 8, fontFamily: FONT,
          }}
        >
          {loading && <Spinner size={14} color={C.bg} />}
          {loading ? "Connecting..." : "Get started — it's free"}
        </button>

        <div style={{ fontSize: 11, color: C.muted, textAlign: "center", lineHeight: 1.5 }}>
          Free plan · 20 referrals included · No credit card required
        </div>

        {!showReconnect ? (
          <button
            onClick={() => setShowReconnect(true)}
            style={{
              background: "transparent", color: C.muted, padding: "9px 14px",
              borderRadius: 7, border: `1px solid ${C.border}`, fontSize: 12,
              fontWeight: 600, cursor: "pointer", fontFamily: FONT, marginTop: 4,
            }}
          >
            Reconnect with project ID
          </button>
        ) : (
          <div style={{ marginTop: 4, display: "flex", flexDirection: "column", gap: 8 }}>
            <label style={label}>Project ID</label>
            <input style={{ ...input, fontFamily: MONO, fontSize: 12 }}
              value={reconnectId}
              onChange={(e) => setReconnectId(e.target.value)}
              placeholder="paste project ID here"
              onFocus={(e) => (e.currentTarget.style.borderColor = C.borderB)}
              onBlur={(e) => (e.currentTarget.style.borderColor = C.border)} />
            {reconnectErr && (
              <div style={{ fontSize: 11, color: C.red }}>{reconnectErr}</div>
            )}
            <button
              onClick={submitReconnect}
              disabled={reconnecting || !reconnectId}
              style={{
                background: C.raised, color: C.text, padding: "10px 14px",
                borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 12,
                fontWeight: 700, cursor: reconnecting ? "not-allowed" : "pointer",
                opacity: reconnecting || !reconnectId ? 0.6 : 1, fontFamily: FONT,
                display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              }}
            >
              {reconnecting && <Spinner size={12} color={C.text} />}
              {reconnecting ? "Verifying..." : "Restore session"}
            </button>
          </div>
        )}
      </div>

      <div style={{ marginTop: 16, padding: "0 16px 20px", display: "flex", flexDirection: "column", gap: 9 }}>
        {[
          "Visitor analytics from day one",
          "Referral links per page visitor",
          "One embed script — no code required",
        ].map((t) => (
          <div key={t} style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <span style={{ width: 4, height: 4, background: C.accent, display: "inline-block" }} />
            <span style={{ fontSize: 12, color: C.muted }}>{t}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ────────────────────────────────────────── Active ──────────────────────────────────────────
function ActiveScreen({
  projectId,
  stats,
  config,
  visitors,
  refresh,
  onDisconnect,
}: {
  projectId: string;
  stats: Stats;
  config: Config;
  visitors: VisitorStats;
  refresh: () => void;
  onDisconnect: () => void;
}) {
  const [preset, setPreset] = useState(config.preset);
  const [reward, setReward] = useState(config.rewardAmount);
  const [savedFlash, setSavedFlash] = useState(false);
  const [copied, setCopied] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [upgrading, setUpgrading] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendSent, setResendSent] = useState(false);
  const [cycle, setCycle] = useState<"monthly" | "yearly">("monthly");

  const embed = `<script src="${API_BASE}/v1.js" data-project="${projectId}"></script>`;

  const sectionLabel: React.CSSProperties = {
    fontSize: 10, fontWeight: 700, letterSpacing: 1.2, textTransform: "uppercase",
    color: C.muted, marginBottom: 10,
  };
  const ghostBtn: React.CSSProperties = {
    width: "100%", background: C.raised, color: C.muted, padding: "10px 14px",
    borderRadius: 8, border: `1px solid ${C.border}`, fontSize: 12, fontWeight: 700,
    cursor: "pointer", fontFamily: FONT,
  };

  async function saveConfig(next: Partial<Config>) {
    const r = await fetch(`${API_BASE}/api/projects/${projectId}/config`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-project-id": projectId },
      body: JSON.stringify(next),
    });
    if (r.ok) {
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1500);
      refresh();
    }
  }

  async function doExport() {
    setExporting(true);
    try {
      const r = await fetch(`${API_BASE}/api/export/referrals`, {
        headers: { "x-project-id": projectId },
      });
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `rippl-referrals-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  async function doUpgrade() {
    setUpgrading(true);
    try {
      const r = await fetch(`${API_BASE}/api/projects/${projectId}/upgrade`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-project-id": projectId },
        body: JSON.stringify({ cycle }),
      });
      const j = await r.json();
      if (r.ok && j.paymentUrl) window.open(j.paymentUrl, "_blank");
    } finally {
      setUpgrading(false);
    }
  }

  async function doResendVerification() {
    setResending(true);
    try {
      await fetch(`${API_BASE}/api/projects/verify/resend`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      setResendSent(true);
      setTimeout(() => setResendSent(false), 4000);
    } finally {
      setResending(false);
    }
  }

  async function doConfirmDisconnect() {
    // Fire recovery email server-side so the founder always has the project ID.
    try {
      await fetch(`${API_BASE}/api/projects/${projectId}/disconnect`, {
        method: "POST",
        headers: { "x-project-id": projectId },
      });
    } catch {}
    onDisconnect();
  }

  const usagePct = Math.min(
    100,
    stats.freeLimit > 0 ? Math.round((stats.totalReferrals / stats.freeLimit) * 100) : 0
  );
  const isFree = stats.planType === "free";
  const limitHit = stats.limitReached;

  return (
    <div>
      <style>{`
        @keyframes pulseDot{0%,100%{opacity:1}50%{opacity:0.4}}
        @keyframes ripplGrow{from{width:0%}to{width:var(--w)}}
      `}</style>

      {/* header */}
      <div style={{ padding: "13px 16px", borderBottom: `1px solid ${C.border}`,
        display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Wordmark />
        <span style={{
          padding: "3px 9px", borderRadius: 100,
          background: limitHit ? C.redD : C.accentD,
          border: `1px solid ${limitHit ? "rgba(255,77,106,0.25)" : "rgba(0,194,124,0.20)"}`,
          fontSize: 10, fontWeight: 700, textTransform: "uppercase",
          color: limitHit ? C.red : C.accent, letterSpacing: 0.6,
          display: "inline-flex", alignItems: "center", gap: 6,
        }}>
          <span style={{
            width: 5, height: 5, borderRadius: "50%",
            background: limitHit ? C.red : C.accent,
            animation: "pulseDot 1.6s ease-in-out infinite",
          }} />
          {limitHit ? "Paused" : "Active"}
        </span>
      </div>

      <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 14 }}>

        {/* Email verification banner */}
        {!stats.emailVerified && (
          <div style={{
            background: "rgba(245,158,11,0.08)", borderLeft: `3px solid ${C.amber}`,
            borderRadius: 7, padding: "10px 12px", display: "flex",
            alignItems: "flex-start", gap: 10,
          }}>
            <span style={{ color: C.amber, fontSize: 14, lineHeight: 1.2 }}>⚠</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 2 }}>
                Confirm your email
              </div>
              <div style={{ fontSize: 11, color: C.muted, lineHeight: 1.5 }}>
                Check your inbox for a verification link. Your project is fully active.
              </div>
            </div>
            <button onClick={doResendVerification} disabled={resending || resendSent}
              style={{
                background: "transparent", border: "none", color: C.amber,
                fontSize: 11, fontWeight: 700, cursor: resending ? "default" : "pointer",
                fontFamily: FONT, padding: "2px 4px", whiteSpace: "nowrap",
              }}>
              {resendSent ? "Sent ✓" : resending ? "Sending..." : "Resend email"}
            </button>
          </div>
        )}

        {/* Visitors */}
        <div>
          <div style={sectionLabel}>Visitors</div>
          {!isFree ? (
          <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
            {[
              { label: "Today", v: visitors.today },
              { label: "This month", v: visitors.thisMonth },
              { label: "All time", v: visitors.allTime },
            ].map((t) => (
              <div key={t.label} style={{
                background: C.surface, border: `1px solid ${C.border}`,
                borderRadius: 9, padding: "10px 10px",
              }}>
                <div style={{
                  fontSize: 9, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase",
                  color: C.muted, marginBottom: 4,
                }}>{t.label}</div>
                <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: -0.4, color: C.text, lineHeight: 1.1 }}>
                  {fmtNum(t.v.uniqueVisitors)}
                </div>
                <div style={{ fontSize: 9, color: C.muted, marginTop: 2 }}>visitors</div>
                <div style={{ fontSize: 10, color: C.muted, marginTop: 6, fontFamily: MONO }}>
                  {fmtNum(t.v.pageviews)} pv
                </div>
              </div>
            ))}
          </div>
          {visitors.topPages.length > 0 && (
            <div style={{ marginTop: 10, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 9 }}>
              {visitors.topPages.slice(0, 3).map((p, i) => (
                <div key={p.path + i} style={{
                  padding: "8px 12px", display: "flex", justifyContent: "space-between",
                  alignItems: "center", borderTop: i === 0 ? "none" : `1px solid ${C.border}`,
                }}>
                  <span style={{ fontSize: 11, color: C.muted, fontFamily: MONO,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 200,
                  }}>{p.path}</span>
                  <span style={{ fontSize: 11, color: C.text, fontWeight: 600 }}>{fmtNum(p.views)}</span>
                </div>
              ))}
            </div>
          )}
          </>
          ) : (
            <div style={{
              textAlign: "center",
              padding: "24px 16px",
              color: C.muted,
              fontSize: 12,
              lineHeight: 1.6,
            }}>
              Visitor analytics is a Pro feature.<br />
              <span
                style={{ color: C.accent, cursor: "pointer", fontWeight: 700 }}
                onClick={() => setCycle("monthly")}
              >
                Upgrade to Pro — ₦15,000/month
              </span>
            </div>
          )}
        </div>

        {/* Free plan limit bar */}
        {isFree && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <span style={sectionLabel}>{limitHit ? "Limit reached" : "Free plan usage"}</span>
              <span style={{
                fontSize: 11, color: limitHit ? C.red : C.text, fontWeight: 700, fontFamily: MONO,
              }}>
                {stats.totalReferrals} / {stats.freeLimit}
              </span>
            </div>
            <div style={{
              height: 8, width: "100%", background: C.raised,
              border: `1px solid ${C.border}`, borderRadius: 100, overflow: "hidden",
            }}>
              <div style={{
                ["--w" as never]: `${usagePct}%`,
                width: `${usagePct}%`,
                height: "100%",
                background: limitHit
                  ? `linear-gradient(90deg, ${C.red}, #FF7088)`
                  : `linear-gradient(90deg, ${C.accent}, #4DE0A8)`,
                animation: "ripplGrow 0.8s ease-out",
                transition: "width 0.4s ease",
              }} />
            </div>
            <div style={{ marginTop: 7, fontSize: 11, color: limitHit ? C.red : C.muted, lineHeight: 1.5 }}>
              {limitHit
                ? "Limit reached — upgrade to continue tracking referrals."
                : "Upgrade to Pro for unlimited referrals."}
            </div>
          </div>
        )}

        {/* Referral stats */}
        <div>
          <div style={sectionLabel}>Referrals (this month)</div>
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 11 }}>
            {[
              { label: "Referrals", value: String(stats.referrals), color: C.text },
              { label: "Conversions", value: String(stats.conversions), color: C.accent },
              { label: "Rewards issued", value: fmtMoney(stats.rewardsIssued, stats.currency), color: C.text, mono: true },
            ].map((row, i) => (
              <div key={row.label} style={{
                padding: "11px 14px", borderBottom: i < 2 ? `1px solid ${C.border}` : "none",
                display: "flex", justifyContent: "space-between", alignItems: "center",
              }}>
                <span style={{ fontSize: 12, color: C.muted }}>{row.label}</span>
                <span style={{
                  fontSize: 15, fontWeight: 800, letterSpacing: -0.4, color: row.color,
                  fontFamily: row.mono ? MONO : FONT,
                }}>{row.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Config */}
        <div>
          <div style={sectionLabel}>Preset</div>
          <div style={{ display: "flex", gap: 6 }}>
            {(["cashback", "waitlist", "points"] as const).map((p) => {
              const sel = preset === p;
              return (
                <button key={p} onClick={() => { setPreset(p); saveConfig({ preset: p }); }}
                  style={{
                    flex: 1, padding: "7px 0", borderRadius: 7, fontSize: 12, fontWeight: 600,
                    cursor: "pointer", transition: "all 0.15s", textTransform: "capitalize",
                    background: sel ? C.accentD : C.raised,
                    border: `1px solid ${sel ? "rgba(0,194,124,0.25)" : C.border}`,
                    color: sel ? C.accent : C.muted, fontFamily: FONT,
                  }}>{p}</button>
              );
            })}
          </div>

          <div style={{ marginTop: 12 }}>
            <div style={sectionLabel}>Reward per referral</div>
            <div style={{ display: "flex", gap: 8 }}>
              <input type="number" min={0} step={100} value={reward}
                onChange={(e) => setReward(Number(e.target.value))} placeholder="50000"
                style={{
                  flex: 1, background: C.raised, border: `1px solid ${C.border}`,
                  borderRadius: 7, padding: "9px 12px", fontSize: 13, color: C.text,
                  fontFamily: FONT, outline: "none",
                }} />
              <button onClick={() => saveConfig({ rewardAmount: reward })}
                style={{
                  padding: "8px 14px", background: C.raised,
                  color: savedFlash ? C.accent : C.muted, border: `1px solid ${C.border}`,
                  borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: FONT,
                }}>{savedFlash ? "Saved ✓" : "Save"}</button>
            </div>
          </div>
        </div>

        {/* Embed */}
        <div>
          <div style={sectionLabel}>Embed code</div>
          <div style={{
            background: "#060709", border: `1px solid ${C.border}`, borderRadius: 9,
            padding: "12px 14px", fontFamily: MONO, fontSize: 11, color: C.muted,
            lineHeight: 1.7, wordBreak: "break-all", userSelect: "all",
          }}>{embed}</div>
          <button onClick={() => {
              navigator.clipboard.writeText(embed);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
            style={{ ...ghostBtn, marginTop: 8, color: copied ? C.accent : C.muted }}>
            {copied ? "Copied ✓" : "Copy embed code"}
          </button>
          <div style={{ fontSize: 10, color: C.muted, marginTop: 6, lineHeight: 1.5 }}>
            Paste into your site's &lt;head&gt; custom code. Then add data-rippl-widget elements where you want the widgets to appear.
          </div>
          <div style={{ fontSize: 10, color: C.muted, marginTop: 6, lineHeight: 1.6 }}>
            Have a login system? Also add{" "}
            <code style={{ background: C.raised, padding: "1px 5px", borderRadius: 4, fontFamily: MONO }}>
              data-user-id="YOUR_USER_ID"
            </code>{" "}
            to link referrals to real accounts.
          </div>
        </div>

        {!isFree ? (
          <button onClick={doExport} style={ghostBtn}>
            {exporting ? "Exporting..." : "↓ Export referrals as CSV"}
          </button>
        ) : (
          <button
            disabled
            style={{ ...ghostBtn, opacity: 0.4, cursor: "not-allowed" }}
            title="CSV export requires a Pro plan"
          >
            ↓ Export referrals as CSV — Pro only
          </button>
        )}

        {/* Upgrade button — free plan only */}
        {isFree && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", gap: 6 }}>
              {(["monthly", "yearly"] as const).map((cyc) => {
                const sel = cycle === cyc;
                return (
                  <button key={cyc} onClick={() => setCycle(cyc)}
                    style={{
                      flex: 1, padding: "8px 0", borderRadius: 100, fontSize: 11, fontWeight: 700,
                      cursor: "pointer", transition: "all 0.15s",
                      background: sel ? C.accentD : C.raised,
                      border: `1px solid ${sel ? "rgba(0,194,124,0.25)" : C.border}`,
                      color: sel ? C.accent : C.muted, fontFamily: FONT,
                    }}>
                    {cyc === "monthly" ? "Monthly" : "Yearly — 2 months free"}
                  </button>
                );
              })}
            </div>
            <button onClick={doUpgrade} disabled={upgrading}
              style={{
                background: C.accent, color: C.bg, padding: "12px 14px", borderRadius: 9,
                fontSize: 13, fontWeight: 800, border: "none", width: "100%",
                cursor: upgrading ? "not-allowed" : "pointer",
                opacity: upgrading ? 0.6 : 1, fontFamily: FONT,
                display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              }}>
              {upgrading && <Spinner size={14} color={C.bg} />}
              {upgrading
                ? "Opening Paystack..."
                : cycle === "yearly"
                  ? "Upgrade to Pro — ₦150,000/year"
                  : "Upgrade to Pro — ₦15,000/month"}
            </button>
            {cycle === "yearly" && (
              <div style={{ fontSize: 11, color: C.accent, textAlign: "center", fontWeight: 600 }}>
                Save ₦30,000 vs monthly
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{
        padding: "12px 16px", borderTop: `1px solid ${C.border}`,
        display: "flex", justifyContent: "space-between", alignItems: "center",
      }}>
        <span style={{ fontFamily: MONO, fontSize: 10, color: "#252F42" }}>
          {projectId.slice(0, 12)}...
        </span>
        {!confirmDisconnect ? (
          <button onClick={() => setConfirmDisconnect(true)}
            style={{
              background: "none", border: "none", color: C.muted,
              fontSize: 11, cursor: "pointer", fontFamily: FONT,
            }}>Disconnect</button>
        ) : (
          <span style={{ display: "inline-flex", gap: 6 }}>
            <button onClick={() => setConfirmDisconnect(false)}
              style={{
                background: "transparent", border: `1px solid ${C.border}`, color: C.muted,
                fontSize: 11, padding: "4px 10px", borderRadius: 6, cursor: "pointer",
                fontFamily: FONT,
              }}>Cancel</button>
            <button onClick={doConfirmDisconnect}
              style={{
                background: C.red, border: "none", color: C.bg,
                fontSize: 11, padding: "4px 10px", borderRadius: 6, cursor: "pointer",
                fontFamily: FONT, fontWeight: 700,
              }}>Confirm</button>
          </span>
        )}
      </div>

      {confirmDisconnect && (
        <div style={{
          margin: "0 16px 12px", padding: "10px 12px", background: C.redD,
          borderLeft: `3px solid ${C.red}`, borderRadius: 6, fontSize: 11,
          color: C.muted, lineHeight: 1.5,
        }}>
          This removes Rippl from this browser. Your project stays active. We'll email you the project ID.
        </div>
      )}

      <div style={{ fontSize: 10, color: C.muted, textAlign: "center", padding: "8px 0 14px" }}>
        Payments secured by Paystack
      </div>
    </div>
  );
}
