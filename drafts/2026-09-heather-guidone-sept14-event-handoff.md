# Sept 14 free event: Heather Guidone -- handoff for the /stuc-event build

Written 2026-09-01 from the Heather profile session. Use this so the event page and the
profile post say the same things. Source of truth for every biographical claim is the
attribution note in `2026-09-heather-guidone-profile.md` (same folder).

## Event facts (confirmed with Heather by email 2026-08-17)

- Monday, September 14, 2026, 5 PM Eastern (write "Eastern", never "EST")
- Title: The Mistakes of the Endometriosis Movement
- FREE public call. Brief, informal, open forum. No slides.
- Speaker: Heather Guidone, BCPA, Program Director, Center for Endometriosis Care (Atlanta)
- Host: Dr. Naomi Whittaker
- Publish with `is_free=1`. ManyChat / DM / IG link = the public `/events/<slug>/` page, never the Meet link.
- The two follow-on members sessions (Sep 21 "Better Advocacy" full talk with slides; Sep 28 advocates
  networking call, Lorraine Truman leads, Dr. Whittaker hosts, Heather on for questions) can be
  mentioned as "members only" upsell copy but are separate events.

## Speaker one-liner

Heather Guidone, BCPA, Program Director at the Center for Endometriosis Care, with three decades
of endometriosis advocacy spanning research, policy, and patient care.

## Speaker blurb (about 70 words, all facts publicly sourced)

Heather Guidone, BCPA, is Program Director at the Center for Endometriosis Care in Atlanta, an
excision-focused center founded in 1991. Diagnosed with stage IV endometriosis in her late teens,
she has spent roughly thirty years working across research, policy, and patient care: on the
Endometriosis Research Center board since 1997, as a consumer reviewer for Department of Defense
research funding panels, and as a writer whose definition of the disease has been read into the
record of the UK Parliament.

## Hard rules

- She is not a physician. Never "Dr. Guidone". BCPA is the credential.
- Never claim she endorses RRM, NaProTechnology, or RRM Academy. She is a guest of the community.
- Nothing from private email correspondence. No invented quotes or numbers.
- No em dashes. American English.

## Assets

- Cover / tile source art: `tools/generated-images/heather-guidone.raw.png` (no text) and the titled
  cover `heather-guidone-cover.{png,webp,jpg}`. Portrait source was her CDMRP consumer reviewer
  profile photo, which she supplied for public use. Never AI-generate her likeness from scratch
  (memory: stuc-speaker-bench).
- Heather has been emailed the profile preview for approval (Naomi's Gmail draft r-2925951834676721212,
  Naomi sends). If she asks for a different photo, redo the cover before anything ships.

## Loop back

Once the event page is live, drop its URL into `[REGISTRATION_URL]` in the profile draft, and the
club join link into `[MEMBERSHIP_URL]`. The profile post publishes after the event page, never before.

## STATUS 2026-09-01: all three events published

| Date | Post id | Slug | Meet | Calendar event | Email |
|---|---|---|---|---|---|
| Sep 14 (free) | efa21e8a9cab0ea259b4805eaf960695 | the-mistakes-of-the-endometriosis-movement-with-heather-guidone | tna-bnpb-vzs | 8d9std0dv1r0vt8i0tvjsutpug (Heather + Lorraine invited) | member drip sent |
| Sep 21 (members) | 3520bd0b4e049550363cb98aa7258152 | better-advocacy-with-heather-guidone | fty-ejfw-uqu | gb47hupa28o1b49o2id5pi0m2c (no attendees) | NOT sent |
| Sep 28 (members) | e57b4dea36cb17474cf30ce54553e077 | advocates-networking-and-collab-call-with-heather-guidone | uud-hueg-myr | 1tckf34ggquacqt3r07jest79s (no attendees) | NOT sent |

When ready: add Heather (+ Lorraine for Sep 28) as calendar attendees with sendUpdates=all, and run the
member drip for each (script pattern: scratchpad heather-drip.py, sent-log per event under ~/iCode/.run-log/).
