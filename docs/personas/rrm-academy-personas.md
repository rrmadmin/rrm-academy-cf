---
# RRM Academy User Personas — machine-readable SSOT
# This frontmatter block is parsed by scripts/check-persona-enum-sync.mjs.
# Editing rules: keep `contact_form_category` values in sync with src/lib/contact-categories.ts.
personas:
  - id: course-taker
    name: Course taker
    bucket: A
    intent: Question about a purchased course (access, content, certificate)
    self_serve_path: /account
    surface: card
    contact_form_category: course
    auth_required_for_self_serve: true

  - id: stuc-member-stripe
    name: STUC member with Stripe subscription
    bucket: A
    intent: Cancel, change, or get receipt for Stripe-backed subscription
    self_serve_path: /account
    surface: card
    contact_form_category: stuc-billing
    auth_required_for_self_serve: true

  - id: paypal-recurring-donor
    name: PayPal-only recurring donor
    bucket: A
    intent: Cancel or change PayPal recurring profile
    self_serve_path: https://www.paypal.com/myaccount/autopay/
    surface: card
    contact_form_category: stuc-billing
    auth_required_for_self_serve: true

  - id: patient-curious
    name: Patient-curious or unsure
    bucket: A
    intent: Wondering whether RRM is right for them
    self_serve_path: /ask
    surface: card-fold
    contact_form_category: other
    auth_required_for_self_serve: true

  - id: clinician-or-researcher
    name: Clinician or researcher
    bucket: A
    intent: Library access, citation help, fulltext request
    self_serve_path: null
    surface: text-link
    contact_form_category: clinician-or-researcher
    auth_required_for_self_serve: false

  - id: speaking-or-media
    name: Speaking or media inquiry
    bucket: A
    intent: Interview, podcast, conference invite for Dr Whittaker
    self_serve_path: null
    surface: text-link
    contact_form_category: speaking
    auth_required_for_self_serve: false

  - id: partnership
    name: Partnership or affiliate
    bucket: A
    intent: B2B collab, content partnership, affiliate inquiry
    self_serve_path: null
    surface: text-link
    contact_form_category: partnership
    auth_required_for_self_serve: false

  - id: donor-or-grants
    name: Major donor or grants
    bucket: A
    intent: Large gift, foundation grant question
    self_serve_path: https://rrm.foundation/
    surface: text-link
    contact_form_category: donor-or-grants
    auth_required_for_self_serve: false

  - id: bug-report
    name: Bug or accessibility report
    bucket: A
    intent: Site issue, broken link, a11y problem
    self_serve_path: null
    surface: text-link
    contact_form_category: bug
    auth_required_for_self_serve: false

  - id: clinical-appointment
    name: Wants clinical appointment with Dr Whittaker
    bucket: B
    intent: Schedule with Dr Whittaker as a patient
    self_serve_path: /schedule-with-dr-whittaker/
    surface: bridge
    contact_form_category: null
    auth_required_for_self_serve: false

  - id: medical-advice
    name: Personal medical advice
    bucket: C
    intent: Should I take X, interpret my labs
    self_serve_path: https://www.factsaboutfertility.org/find-a-provider/
    surface: redirect-only
    contact_form_category: null
    auth_required_for_self_serve: false

  - id: find-a-doctor
    name: Find a doctor / referral
    bucket: C
    intent: Locate an RRM physician
    self_serve_path: https://www.factsaboutfertility.org/find-a-provider/
    surface: redirect-only
    contact_form_category: null
    auth_required_for_self_serve: false
---

# RRM Academy User Personas

This document is the SSOT for user personas referenced by the contact form, bridge pages, FAQs, and future surfaces. The frontmatter above is machine-readable; this prose is for humans.

## Bucket A. Personas RRM Academy can serve via the contact form

Eight personas (some sharing one card by design — see persona 2a/2b PayPal vs Stripe).

### Course taker

A user who has purchased an RRM Academy course (or has free access via membership) and needs help with access, content, or completion certificates. **Self-serve:** `/account` -> My courses (login required). **Form:** for content questions or login problems.

### STUC member or recurring donor (Stripe + PayPal)

Two sub-personas share one card label because the user often does not distinguish them mentally:

- **STUC member or Stripe-backed recurring donor:** subscription managed via Stripe. Self-serve: `/account` -> Manage subscription -> Stripe customer portal. Login required.
- **PayPal-only recurring donor:** legacy or non-STUC recurring giving to RRM Foundation. No `/account` path. Self-serve: log in to PayPal -> Settings -> Payments -> Manage automatic payments.

The card surfaces both paths; the user picks the one matching their payment source. Form fallback for refund disputes, portal failures, or payment-source confusion.

### Patient-curious or unsure

Folded into the "Something else" card. Primary self-serve is `/ask` (free RRM Academy account required), `/faqs`, the pillar guides (`/what-is-rrm/`, `/naprotechnology/`, `/femm/`, `/neofertility/`), and `/endo-survey`. Form fallback for genuinely-unique inquiries.

### Clinician or researcher, Speaking, Partnership, Major donor or grants, Bug report

Five secondary personas surfaced as text links below the cards. No self-serve path; direct-to-form. Each has a distinct wire category (see frontmatter) so triage analytics can distinguish volume.

## Bucket B. Pseudo-served via bridge page

### Wants clinical appointment with Dr Whittaker

RRM Academy is education only. Dr Whittaker's clinical practice is currently at UPMC. The bridge page at `/schedule-with-dr-whittaker/` captures branded navigational queries ("schedule with Dr Whittaker", "Dr Whittaker appointment", "Dr Whittaker endometriosis surgery"), states the academy/clinic distinction, and provides one outbound CTA to her UPMC profile. Designed for low-friction copy swap when Lunira PLLC launches.

## Bucket C. Hard redirects, not on contact form

### Personal medical advice

We are an education organization; we cannot give personal medical advice. Surface inline on FAQ pages and the medical-disclaimer page: "Talk to your clinician, or browse the FACTS About Fertility provider directory." Not on the contact form.

### Find a doctor / referral

The existing rrmacademy.org `/find-a-provider/` URL 301-redirects to homepage; only `/dev/providers.astro` exists internally. Until a first-party directory ships, this persona's destination is the FACTS About Fertility directory at `https://www.factsaboutfertility.org/find-a-provider/`. Documented in this doc, referenced inline where relevant. Not on the contact form.

## Future bridge candidates (not built)

- `/find-a-napro-doctor-near-me/` — long-tail SEO funnel, destination FACTS until first-party.
- `/find-an-endometriosis-surgeon/` — same.
- Additional candidates surface from SEO research over time.
