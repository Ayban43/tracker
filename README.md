# Trip Expense Tracker

Mobile-first Next.js + Supabase app to track shared travel expenses for a small group.

## Features

- Add expenses for car, food, and other categories
- Split equally or custom by person (useful when only some people ate)
- Track who paid each expense
- Mark each person's share as paid/unpaid
- Live balance summary (who owes vs who should get back)

## 1) Supabase setup

1. Create a Supabase project.
2. Open SQL Editor and run [`supabase/schema.sql`](./supabase/schema.sql).
3. Copy your project URL and anon key.

The seed script creates one trip with this id:

- `8a5eb18a-bda9-4cf9-99a8-08e18f5f6798`

## 2) Environment variables

Copy `.env.example` to `.env.local` and fill values:

```bash
cp .env.example .env.local
```

Required:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_TRIP_ID`

## 3) Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## 4) Deploy to Vercel

1. Push this repo to GitHub/GitLab/Bitbucket.
2. Import the repo into Vercel.
3. Add the same 3 environment variables in Vercel project settings.
4. Deploy.

## Notes

- Current SQL policies are open (`using (true)`) for quick private-group usage.
- Before public use, add Supabase Auth and tighten RLS policies per user/trip.

