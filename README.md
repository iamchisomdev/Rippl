# Rippl — Referral & Rewards Plugin

A no-code referral and rewards engine for Webflow and Framer sites.
Backend: Hono + Neon Postgres + Drizzle. Payments: Paystack.

---

## 1. Unzip and install

```bash
unzip rippl-plugin.zip
cd rippl-plugin
npm install
```

## 2. Environment setup

```bash
cp .env.example .env
```

Fill in:

| Variable | Where to find it |
|----------|------------------|
| `DATABASE_URL` | [neon.tech](https://neon.tech) → create project → **Connection string** (with `?sslmode=require`) |
| `PAYSTACK_SECRET_KEY` | [paystack.com](https://paystack.com) → Settings → API Keys → **Test Secret Key** |
| `PAYSTACK_PUBLIC_KEY` | Same page → **Test Public Key** |
| `PAYSTACK_PLAN_CODE_MONTHLY` | paystack.com → Subscriptions → Plans → create **"Rippl Monthly" ₦15,000/month** → copy `PLN_...` |
| `PAYSTACK_PLAN_CODE_YEARLY`  | paystack.com → Subscriptions → Plans → create **"Rippl Yearly" ₦150,000/year** → copy `PLN_...` |
| `APP_URL` | `http://localhost:3001` locally, or your Railway URL in production |

## 3. Database setup

```bash
npm run db:generate
npm run db:migrate
```

## 4. Run locally

```bash
npm run dev
```

- `http://localhost:3001/health` → `{ ok: true }`
- `http://localhost:3001/test` → test console

---

## 5. Testing with Postman

### 1. Health check
`GET http://localhost:3001/health`
→ `{ ok: true, version: "0.1.0", timestamp: ... }`

### 2. Create a project
`POST http://localhost:3001/api/projects/create`
Headers: `Content-Type: application/json`
Body:
```json
{ "email": "test@example.com", "name": "Test Project" }
```
→ `{ projectId: "...", name: "...", embedCode: "<script ...>" }`
**Copy the `projectId` — you need it for every subsequent request.
Check your inbox for a verification email before testing paid features.**

### 3. Simulate Paystack payment (local bypass)
Open Neon SQL editor and run:
```sql
UPDATE projects SET active = true WHERE id = 'YOUR_PROJECT_ID';
```

### 4. Identify a user
`POST http://localhost:3001/api/identify`
Headers: `Content-Type: application/json`, `x-project-id: YOUR_PROJECT_ID`
Body:
```json
{ "userId": "user_001", "email": "user@test.com" }
```
→ `{ user: {...}, referral: { code: "...", shareUrl: "...", stats: {...} } }`
**Copy the referral code.**

### 5. Get referral code
`GET http://localhost:3001/api/referral/user_001`
Headers: `x-project-id: YOUR_PROJECT_ID`
→ `{ code, shareUrl, stats: { invited: 0, converted: 0 } }`

### 6. Simulate a conversion
First identify a second user:
`POST /api/identify` with body `{ "userId": "user_002" }` and the project header.

Then track:
`POST http://localhost:3001/api/track`
Headers: `Content-Type: application/json`, `x-project-id: YOUR_PROJECT_ID`
Body:
```json
{ "event": "referral.convert", "userId": "user_002", "payload": { "code": "PASTE_CODE" } }
```
→ `{ ok: true, rewarded: true, amount: 50000 }`

### 7. Check balance
`GET http://localhost:3001/api/balance/user_001`
Headers: `x-project-id: YOUR_PROJECT_ID`
→ `{ available: 50000, pending: 0, currency: "NGN" }`

### 8. Check stats
`GET http://localhost:3001/api/projects/YOUR_PROJECT_ID/stats`
→ `{ referrals: 1, conversions: 1, rewardsIssued: 50000, currency: "NGN", active: true }`

### 9. Export CSV
`GET http://localhost:3001/api/export/referrals`
Headers: `x-project-id: YOUR_PROJECT_ID`
In Postman: **Send and Download** to save the CSV.

### 10. Test rate limiting
Hit `POST /api/projects/create` more than 5 times in an hour → `429 Too Many Requests`.

### 11. Security headers
Inspect any response → headers include `X-Content-Type-Options`, `X-Frame-Options`, `X-XSS-Protection`, `Referrer-Policy`, `Permissions-Policy`, `Content-Security-Policy`.

---

## 6. Sharing with no-code friends for beta testing

### Step 1 — Expose your local server
```bash
npx ngrok http 3001
```
Copy the `https://abc123.ngrok.io` URL.

### Step 2 — Update `.env`
```
APP_URL=https://abc123.ngrok.io
```
Restart `npm run dev`.

### Step 3 — Send your friends
`https://abc123.ngrok.io/test`

### Step 4 — They follow the on-screen steps.

**Paystack test cards:**

| Network | Number | Exp | CVV |
|---------|--------|-----|-----|
| Visa | `4084 0840 8408 4081` | any future | 408 |
| Mastercard | `5531 8866 5214 2950` | 09/32 | 564 |
| Verve | `5061 2600 0000 0000000` | any future | — |

PIN `1234`, OTP `123456`.

---

## 7. Testing on Framer

1. `npm create framer-plugin@latest` in a new folder `framer-plugin/`.
2. Replace generated `App.tsx` with `src/plugin/ui.tsx` from this repo.
3. Update `API_BASE` to `http://localhost:3001`.
4. `npm run dev` (Framer plugin runs on `http://localhost:5173`).
5. In Framer: puzzle icon → **Import from URL** → paste `http://localhost:5173`.
6. In plugin panel: create project, complete test payment, copy embed code.
7. Framer: Pages → Page Settings → Custom Code → Head → paste embed code.
8. Add a Code component:
   ```html
   <div data-rippl-widget="referral-card"></div>
   ```
9. Preview → widget renders.

To share with Framer friends: send your ngrok URL `/test`.

---

## 8. Testing on Webflow

1. `npx ngrok http 3001`
2. Webflow project → Pages → (any) → Settings → Custom Code → Before `</body>`:
   ```html
   <script src="https://abc123.ngrok.io/v1.js"
           data-project="YOUR_PROJECT_ID"
           data-user-id="test_user"
           data-user-email="test@example.com"></script>
   ```
3. Add Embed elements with:
   ```html
   <div data-rippl-widget="referral-card"></div>
   <div data-rippl-widget="rewards"></div>
   ```
4. Preview → widgets load.

---

## 9. Deploying to Railway

1. `git init && git add . && git commit -m "init"`
2. Push to GitHub.
3. [railway.app](https://railway.app) → New Project → Deploy from GitHub.
4. Add all `.env` vars (use **live** Paystack keys in production).
5. Set `APP_URL` to your Railway URL.
6. Paystack → Settings → API → Webhooks → add `https://your-railway-url.railway.app/api/paystack/webhook`.
7. Railway redeploys on every git push.

---

## 10. Pre-submission checklist

- [ ] All Postman tests pass
- [ ] Rate limiting returns 429
- [ ] Security headers present on all responses
- [ ] Paystack test payment activates project
- [ ] Subscription cancel deactivates project
- [ ] Widgets render on Framer preview
- [ ] Widgets render on Webflow preview
- [ ] CSV export downloads valid file
- [ ] Error states render (try wrong project ID)
- [ ] At least 3 friends confirmed it works end-to-end
- [ ] Backend deployed on Railway with live keys
- [ ] Screenshots: 1280×846 (Webflow), 1440×900 (Framer)
- [ ] 2–3 minute Loom recorded
