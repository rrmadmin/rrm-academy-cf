/**
 * Transactional email templates for the Educational Partners program.
 * Called from functions/api/admin/partners/[id].js after a state change.
 *
 * Email failure must NOT block the D1 action; the caller wraps each call
 * in try/catch. These helpers throw on SES errors so the caller can log.
 */
import { sendEmail } from '../_ses.js';

const FROM = 'RRM Academy <administrator@mail.rrmacademy.org>';
const REPLY_TO = 'administrator@rrmacademy.org';
const PROGRAM_URL = 'https://rrmacademy.org/partners/';
const TAGLINE_RULES_URL = 'https://rrmacademy.org/partners/tagline-rules.md';

function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function sendPartnerWelcomeEmail(env, partner) {
  const clinicName = partner.name || 'your clinic';
  const listingUrl = partner.slug ? `${PROGRAM_URL}#${partner.slug}` : PROGRAM_URL;

  const subject = 'Welcome to RRM Academy Educational Partners';

  const text = `Hi ${clinicName},

Your application has been approved. ${clinicName} is now a Friend in the RRM Academy Educational Partners program.

Friends is a self-attested designation for clinics that practice within the three RRM principles: find the cause, treat the disease, restore function. It signals to patients that your practice treats what other pathways bypass, and that restoring the body's own healthy function is your clinical goal. This is not a clinical endorsement; your attestation of those principles is the basis for the listing.

Your listing is live at:
${listingUrl}

Tagline and linking rules (please read before adding the tagline to your site):
${TAGLINE_RULES_URL}

Canonical taglines (pick one; do not use multiple):
- Educational partner of RRM Academy
- Proud educational partner of RRM Academy
- ${clinicName} is an educational partner of RRM Academy
- Learn more about restorative reproductive medicine at RRM Academy
- ${clinicName} partners with RRM Academy on patient education

Important link rule: every link from your site must point to https://rrmacademy.org/partners/. Do not link to our homepage or any pillar guide with the branded anchor text. The rules file explains why.

Reply to this email if you have questions.

Warmly,
Brian, Administrator
RRM Academy`;

  const html = `<p>Hi ${escapeHtml(clinicName)},</p>

<p>Your application has been approved. <strong>${escapeHtml(clinicName)}</strong> is now a Friend in the RRM Academy Educational Partners program.</p>

<p>Friends is a self-attested designation for clinics that practice within the three RRM principles: find the cause, treat the disease, restore function. It signals to patients that your practice treats what other pathways bypass, and that restoring the body's own healthy function is your clinical goal. This is not a clinical endorsement; your attestation of those principles is the basis for the listing.</p>

<p><strong>Your listing is live at:</strong><br>
<a href="${listingUrl}">${listingUrl}</a></p>

<p><strong>Tagline and linking rules</strong> (please read before adding the tagline to your site):<br>
<a href="${TAGLINE_RULES_URL}">${TAGLINE_RULES_URL}</a></p>

<p><strong>Canonical taglines</strong> (pick one; do not use multiple):</p>
<ul>
  <li>Educational partner of RRM Academy</li>
  <li>Proud educational partner of RRM Academy</li>
  <li>${escapeHtml(clinicName)} is an educational partner of RRM Academy</li>
  <li>Learn more about restorative reproductive medicine at RRM Academy</li>
  <li>${escapeHtml(clinicName)} partners with RRM Academy on patient education</li>
</ul>

<p><strong>Important link rule:</strong> every link from your site must point to <code>https://rrmacademy.org/partners/</code>. Do not link to our homepage or any pillar guide with the branded anchor text. The rules file explains why.</p>

<p>Reply to this email if you have questions.</p>

<p>Warmly,<br>
Brian, Administrator<br>
RRM Academy</p>`;

  return sendEmail(env, {
    from: FROM,
    to: partner.contact_email,
    subject,
    html,
    text,
    replyTo: REPLY_TO,
    log: env.DB ? { db: env.DB, category: 'transactional', source: 'partners/welcome' } : undefined,
  });
}

export async function sendPartnerRejectionEmail(env, partner, reason) {
  const clinicName = partner.name || 'your clinic';

  const subject = 'Your RRM Academy Educational Partners application';

  const text = `Hi ${clinicName},

Thank you for applying to the RRM Academy Educational Partners program. After review, we are not able to list ${clinicName} as a Friend at this time.

Reason provided by our review:

"${reason}"

If you believe we misread your situation, or if this changes in the future, you are welcome to apply again. Reapplications are always welcome.

For questions, reply to this email.

Warmly,
Brian, Administrator
RRM Academy`;

  const html = `<p>Hi ${escapeHtml(clinicName)},</p>

<p>Thank you for applying to the RRM Academy Educational Partners program. After review, we are not able to list <strong>${escapeHtml(clinicName)}</strong> as a Friend at this time.</p>

<p><strong>Reason provided by our review:</strong></p>

<blockquote style="border-left: 3px solid #8a606e; padding: 8px 16px; margin: 16px 0; color: #555;">
  ${escapeHtml(reason)}
</blockquote>

<p>If you believe we misread your situation, or if this changes in the future, you are welcome to apply again. Reapplications are always welcome.</p>

<p>For questions, reply to this email.</p>

<p>Warmly,<br>
Brian, Administrator<br>
RRM Academy</p>`;

  return sendEmail(env, {
    from: FROM,
    to: partner.contact_email,
    subject,
    html,
    text,
    replyTo: REPLY_TO,
    log: env.DB ? { db: env.DB, category: 'transactional', source: 'partners/rejection' } : undefined,
  });
}

export async function sendPartnerApplicationNotification(env, partner) {
  const subject = `New Educational Partner application: ${partner.name}`;

  const text = `New Educational Partner application received.

Clinic: ${partner.name}
Site: ${partner.site_url}
Country: ${partner.country}
City: ${partner.city || '(not provided)'}
Provider: ${partner.provider_name}
Credential: ${partner.provider_credential}
Contact: ${partner.contact_email}
Tier: ${partner.tier}
Status: ${partner.status}
Submitted: ${partner.created_at}

Blurb:
${partner.blurb || '(none)'}

Review at: https://rrmacademy.org/admin/partners/`;

  const html = `<p><strong>New Educational Partner application received.</strong></p>

<table style="border-collapse:collapse;width:100%;max-width:600px;">
  <tr><td style="padding:4px 8px;font-weight:bold;width:140px;">Clinic</td><td style="padding:4px 8px;">${escapeHtml(partner.name)}</td></tr>
  <tr><td style="padding:4px 8px;font-weight:bold;">Site</td><td style="padding:4px 8px;"><a href="${escapeHtml(partner.site_url)}">${escapeHtml(partner.site_url)}</a></td></tr>
  <tr><td style="padding:4px 8px;font-weight:bold;">Country</td><td style="padding:4px 8px;">${escapeHtml(partner.country)}</td></tr>
  <tr><td style="padding:4px 8px;font-weight:bold;">City</td><td style="padding:4px 8px;">${escapeHtml(partner.city || '(not provided)')}</td></tr>
  <tr><td style="padding:4px 8px;font-weight:bold;">Provider</td><td style="padding:4px 8px;">${escapeHtml(partner.provider_name)}</td></tr>
  <tr><td style="padding:4px 8px;font-weight:bold;">Credential</td><td style="padding:4px 8px;">${escapeHtml(partner.provider_credential)}</td></tr>
  <tr><td style="padding:4px 8px;font-weight:bold;">Contact</td><td style="padding:4px 8px;"><a href="mailto:${escapeHtml(partner.contact_email)}">${escapeHtml(partner.contact_email)}</a></td></tr>
  <tr><td style="padding:4px 8px;font-weight:bold;">Tier</td><td style="padding:4px 8px;">${escapeHtml(partner.tier)}</td></tr>
  <tr><td style="padding:4px 8px;font-weight:bold;">Status</td><td style="padding:4px 8px;">${escapeHtml(partner.status)}</td></tr>
  <tr><td style="padding:4px 8px;font-weight:bold;">Submitted</td><td style="padding:4px 8px;">${escapeHtml(partner.created_at)}</td></tr>
</table>

${partner.blurb ? `<p><strong>Blurb:</strong><br>${escapeHtml(partner.blurb)}</p>` : '<p><em>No blurb provided.</em></p>'}

<p><a href="https://rrmacademy.org/admin/partners/">Review application in admin</a></p>`;

  return sendEmail(env, {
    from: FROM,
    to: REPLY_TO,
    subject,
    html,
    text,
    replyTo: partner.contact_email,
    log: env.DB ? { db: env.DB, category: 'transactional', source: 'partners/application-notification' } : undefined,
  });
}

export async function sendPartnerRevocationEmail(env, partner, reason) {
  const clinicName = partner.name || 'your clinic';

  const subject = 'Update on your RRM Academy Educational Partners status';

  const text = `Hi ${clinicName},

This is a notice that ${clinicName}'s Friend status with RRM Academy has been revoked.

Reason:

"${reason}"

Please remove the RRM Academy educational partner tagline, badge, and any links to https://rrmacademy.org/partners/ from your site within 14 days.

If you believe this is a misunderstanding or want to discuss the basis for revocation, reply to this email.

Warmly,
Brian, Administrator
RRM Academy`;

  const html = `<p>Hi ${escapeHtml(clinicName)},</p>

<p>This is a notice that <strong>${escapeHtml(clinicName)}</strong>'s Friend status with RRM Academy has been revoked.</p>

<p><strong>Reason:</strong></p>

<blockquote style="border-left: 3px solid #8a606e; padding: 8px 16px; margin: 16px 0; color: #555;">
  ${escapeHtml(reason)}
</blockquote>

<p>Please remove the RRM Academy educational partner tagline, badge, and any links to <code>https://rrmacademy.org/partners/</code> from your site within 14 days.</p>

<p>If you believe this is a misunderstanding or want to discuss the basis for revocation, reply to this email.</p>

<p>Warmly,<br>
Brian, Administrator<br>
RRM Academy</p>`;

  return sendEmail(env, {
    from: FROM,
    to: partner.contact_email,
    subject,
    html,
    text,
    replyTo: REPLY_TO,
    log: env.DB ? { db: env.DB, category: 'transactional', source: 'partners/revocation' } : undefined,
  });
}
