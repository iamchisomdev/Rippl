import "dotenv/config";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import api from "./api/index";

const app = new Hono();

// API routes
app.route("/", api);

// CORS for embed script
app.use("/v1.js", async (c, next) => {
  c.header("Access-Control-Allow-Origin", "*");
  c.header("Access-Control-Allow-Methods", "GET, OPTIONS");
  c.header("Access-Control-Allow-Headers", "*");
  c.header("Cache-Control", "public, max-age=300");

  // Handle preflight
  if (c.req.method === "OPTIONS") {
    return c.body(null, 204);
  }

  await next();
});

// Static embed script
app.use(
  "/v1.js",
  serveStatic({
    path: "./public/v1.js",
  })
);

// Test pages
app.use(
  "/test",
  serveStatic({
    path: "./test/index.html",
  })
);

app.use(
  "/test/*",
  serveStatic({
    root: "./test",
  })
);

// Success page
app.get("/success", (c) =>
  c.html(
    `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Success</title>
</head>
<body style="background:#08090C;color:#E8EDF5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">
  <div style="text-align:center">
    <h1 style="color:#00C27C;font-size:18px">Payment successful!</h1>
    <p style="color:#5A6478;font-size:13px">Return to your editor.</p>
  </div>
</body>
</html>`
  )
);

// Cancel page
app.get("/cancel", (c) =>
  c.html(
    `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>Cancelled</title>
</head>
<body style="background:#08090C;color:#E8EDF5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">
  <div style="text-align:center">
    <h1 style="color:#FF4D6A;font-size:18px">Payment cancelled.</h1>
    <p style="color:#5A6478;font-size:13px">Try again.</p>
  </div>
</body>
</html>`
  )
);

const port = Number(process.env.PORT || 3001);

serve(
  {
    fetch: app.fetch,
    port,
  },
  () => {
    const lines = [
      "",
      "  ┌────────────────────────────────────────────┐",
      `  │  Rippl API ready on http://localhost:${port}  │`,
      "  ├────────────────────────────────────────────┤",
      "  │  GET  /health                              │",
      "  │  POST /api/projects/create                 │",
      "  │  POST /api/projects/recover                │",
      "  │  GET  /api/projects/verify                 │",
      "  │  POST /api/projects/verify/resend          │",
      "  │  GET  /api/projects/:id/stats              │",
      "  │  GET  /api/projects/:id/config             │",
      "  │  GET  /api/projects/:id/visitors           │",
      "  │  PATCH /api/projects/:id/config            │",
      "  │  POST /api/projects/:id/upgrade            │",
      "  │  POST /api/projects/:id/disconnect         │",
      "  │  POST /api/identify                        │",
      "  │  POST /api/track                           │",
      "  │  POST /api/track/pageview                  │",
      "  │  GET  /api/referral/:userId                │",
      "  │  GET  /api/balance/:userId                 │",
      "  │  GET  /api/export/referrals                │",
      "  │  GET  /api/paystack/callback               │",
      "  │  POST /api/paystack/webhook                │",
      "  │  GET  /test                                │",
      "  │  GET  /v1.js                               │",
      "  └────────────────────────────────────────────┘",
      "",
    ];

    console.log(lines.join("\n"));
  }
);