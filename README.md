# OpenF1

A Vite, React, and TypeScript pit-wall dashboard powered by the OpenF1 API.

## Features

- 2026 and 2027 race calendars from OpenF1
- Race details and fastest-lap data
- GitHub OAuth sign-in through Supabase
- Fastest-lap predictions and a Supabase-backed high-score table
- Responsive race dashboard

OpenF1's API may restrict all data access during an active F1 session; live-session access requires an OpenF1 subscription. If the race calendar is unavailable during a session, try again after it ends.

## Local development

```bash
npm install
npm run dev
```

Create a `.env` file from `.env.example` and add your Supabase project URL and anon key.

## Supabase setup

1. Create a hosted Supabase project or start the local stack with `npm run supabase:start`.
2. Apply the schema migration in `supabase/migrations/20261121200000_initial_schema.sql`.
3. Create a GitHub OAuth app. Set its authorization callback URL to `https://<project-ref>.supabase.co/auth/v1/callback`.
4. In Supabase Authentication > Sign In / Providers > GitHub, enable the provider and enter the GitHub OAuth app's client ID and client secret.
5. Add `http://localhost:5173` to Supabase Authentication > URL configuration as a redirect URL.
6. Copy `.env.example` to `.env` and use local or hosted Supabase URL and anon-key values.
