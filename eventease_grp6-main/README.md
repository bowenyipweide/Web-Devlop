# EventEase

A simple EventEase ticketing portal with React + Vite frontend and Node.js + Express + MongoDB backend.

## Project structure

- `client/` — React frontend
- `server/` — Express API
- `server/.env.example` — environment settings to copy to `server/.env`

Generated folders such as `node_modules`, `dist`, and macOS metadata are intentionally not included.

## Setup

### 1. Backend

```bash
step 1: cd server
step 2: vi .env

------copy front below---------
PORT=4000
NODE_ENV=development
CLIENT_URL=http://localhost:5173

# MongoDB
MONGODB_URI=
MONGODB_DATABASE=

# JWT
JWT_SECRET=change_this_to_a_long_random_secret
JWT_EXPIRES_IN=7d

# Stripe (optional; simulated/PayNow payments work without Stripe)
STRIPE_SECRET_KEY=
STRIPE_PUBLISHABLE_KEY=
# Gmail SMTP (optional)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=

RATE_WINDOW_MS=1000
RATE_LIMIT=5
SEAT_HOLD_MINUTES=10
--------end of copying & paste-------
step 3: press esc key on keyboard
step 4: wq!
step 5: press enter
step 7: npm install
step 8: npm run seed
step 9: npm run dev
```

Set your MongoDB connection in `server/.env`.

### 2. Frontend

Open another terminal:

```bash
cd client
npm install
npm run dev
```

Open `http://localhost:5173`.

The API runs on `http://localhost:4000`.

## Tests

```bash
cd server && npm test        # Jest — API unit/integration tests
cd client && npm run test:e2e   # Playwright — browser end-to-end tests
```

Neither suite touches the database in `server/.env`. Both run against a throwaway
in-memory MongoDB that is created and destroyed per run:

- Jest starts it in `server/test/global-setup.js` (database `eventease_test`).
- Playwright starts it via `client/e2e/backend.cjs`, which also seeds it
  and serves the API on port 4100 while Vite runs on 5199 (see
  `client/playwright.config.js`).

That means the e2e run creates its own users, bookings and tickets and discards
them afterwards, instead of writing into your development database. Because of
this, do not point the e2e suite at a running dev server — the ports it uses are
deliberately different from the dev ports (5173/4000).

## Demo accounts

After running the seed:

- Customer: `demo@eventease.app` / `DemoPass123!`
- Organizer: `org1@eventease.app` / `OrgPass123!`
- Admin: `admin@eventease.app` / `AdminPass123!`

## Payments

Simulated payment and PayNow are available without Stripe. Stripe is optional.

Keep `CLIENT_URL=http://localhost:5173` when using the Vite development server so browser authentication and Stripe return URLs stay on the same origin.
