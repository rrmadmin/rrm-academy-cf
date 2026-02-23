# Auth Spec (Phase 6)

## Architecture

Static HTML pages + CF Pages Functions (no SSR). Auth state checked via `GET /api/auth/session`.

```
Browser → static HTML shell → fetch /api/auth/* → CF Pages Function → D1
```

## D1 Database

- **Name**: `rrm-auth`
- **ID**: `22742c9c-77fa-4344-abda-7e7e8b0da9de`
- **Binding**: `DB` (in wrangler.toml)
- **Schema**: `schema.sql` in project root

### Tables

| Table | Purpose |
|-------|---------|
| `user` | Accounts (email, hashed password, name, role, stripe_customer_id) |
| `session` | Active sessions (30-day rolling, auto-renew at 15 days) |
| `email_verification` | 8-char codes, 1h expiry |
| `password_reset` | SHA-256 hashed tokens, 1h expiry |

## API Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/auth/signup` | No | Create account + send verification |
| POST | `/api/auth/login` | No | Authenticate + create session |
| POST | `/api/auth/logout` | Yes | Destroy session + clear cookie |
| GET | `/api/auth/session` | Cookie | Return current user or null |
| POST | `/api/auth/verify-email` | Yes | Verify email with code |
| POST | `/api/auth/resend-verification` | Yes | Resend verification code |
| POST | `/api/auth/forgot-password` | No | Send reset link (no enumeration) |
| POST | `/api/auth/reset-password` | No | Reset password with token |

## Pages

| Route | File | Auth |
|-------|------|------|
| `/login` | `src/pages/login.astro` | No |
| `/signup` | `src/pages/signup.astro` | No |
| `/account` | `src/pages/account/index.astro` | Yes (middleware redirect) |
| `/forgot-password` | `src/pages/forgot-password.astro` | No |
| `/reset-password` | `src/pages/reset-password.astro` | No |

## Security

- **Password hashing**: PBKDF2 (600K iterations, SHA-256, 16-byte salt) via Web Crypto API
- **Session IDs**: 25 random bytes (hex-encoded, 50 chars)
- **Session cookie**: `HttpOnly; Secure; SameSite=Lax; Path=/`
- **Session duration**: 30 days rolling (auto-renew at 15-day mark)
- **Reset tokens**: 32 random bytes, stored as SHA-256 hash, 1h expiry
- **Rate limiting**: 5 attempts per key per 15 minutes (in-memory per isolate)
- **Turnstile**: On signup, login, forgot-password forms
- **No email enumeration**: forgot-password always returns success

## Email Sender

`accounts@rrmacademy.org` via Resend API (same domain as survey@).

## Environment Secrets

| Secret | Purpose |
|--------|---------|
| `RESEND_API_KEY` | Email delivery (existing) |
| `CF_TURNSTILE_SECRET` | Bot protection (existing) |

## Router Changes (rrm-router)

**Added to ASTRO_ROUTES**: `/login`, `/signup`, `/account`, `/forgot-password`, `/reset-password`

**Added to REDIRECTS**: `/members-area` → `/account`, `/custom-signup` → `/signup`
