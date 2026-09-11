/**
 * THE LANE RULES, AS CODE.
 *
 * The estate has four outbound mail rails and one rail this package will not
 * drive. Which rail a message may use is not the sender's choice: it follows
 * from the entity that owns the message and the purpose the message serves.
 * Every rule Brian has written down about who may send what from where lives
 * in this one file, and `resolveLane()` is the only way to get a lane, so a
 * consumer cannot quietly pick the wrong rail by passing the wrong client.
 *
 * The rule that matters most is the refusal. RRM community, member and
 * newsletter mail goes out through the Workspace lane (`va-send.sh`, a
 * personal send from a human mailbox to a Gmail Primary tab), never through
 * SES. That has been convention for a long time and the survey found SES
 * callers doing it anyway, because convention is not enforcement. Here it is
 * enforcement: `resolveLane()` THROWS `LaneRefused` for that combination and
 * `send()` answers `{ ok: false, reason: 'workspace-lane-only', how:
 * 'va-send.sh' }`, so the violation is a visible failure at the call site
 * rather than a message in the wrong tab a week later.
 *
 * Two named sends are exempt from that refusal, and only two: `EXEMPTIONS`
 * below is a closed table, a send asks for one by name, and a name that is not
 * in the table refuses. See the comment on it for the ruling behind each.
 *
 * Zero dependencies. Pure functions only, no I/O, so the rules are testable
 * without a transport and readable without a runtime.
 */

/** A message that may not be sent on the rail its fields ask for. */
export class LaneRefused extends Error {
  constructor(reason, detail, extra = {}) {
    super(`${reason}: ${detail}`);
    this.name = 'LaneRefused';
    this.reason = reason;
    this.detail = detail;
    this.lane = extra.lane || null;
    if (extra.how) this.how = extra.how;
  }
}

/**
 * A refusal by the far side that retrying cannot fix: the address is dead, the
 * identity is not verified, the account is suspended. Callers record a failure
 * and stop; they must not queue a retry. Thrown, not returned, because a
 * permanent bounce is not the same kind of answer as "the send did not work".
 */
export class MailPermanent extends Error {
  constructor(detail, extra = {}) {
    super(String(detail).slice(0, 300));
    this.name = 'MailPermanent';
    this.permanent = true;
    this.lane = extra.lane || null;
    this.status = extra.status ?? 0;
  }
}

/**
 * The rails. `transport` is which module drives the send, `env` names the
 * bindings that rail needs, and `senders` is the human sentence the refusal
 * quotes back when a from address does not belong on the rail.
 */
export const LANES = {
  workspace: {
    transport: 'none',
    env: [],
    senders: 'a human Workspace mailbox, sent by va-send.sh',
    sendable: false,
    how: 'va-send.sh',
  },
  ses_rrm: {
    transport: 'ses',
    env: ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SES_REGION'],
    senders: '@mail.rrmacademy.org or @rrmacademy.org for rrma, @rrm.foundation or @mail.rrm.foundation for rrmf',
    sendable: true,
  },
  graph_fsp: {
    transport: 'graph',
    env: ['GRAPH_TENANT_ID', 'GRAPH_CLIENT_ID', 'GRAPH_CLIENT_SECRET', 'GRAPH_SENDER_UPN'],
    senders: 'brian@fivestarpractices.com or another @fivestarpractices.com alias',
    sendable: true,
  },
  graph_neo: {
    transport: 'graph',
    env: ['GRAPH_TENANT_ID', 'GRAPH_CLIENT_ID', 'GRAPH_CLIENT_SECRET', 'GRAPH_SENDER_UPN'],
    senders: '@neofertility.ie',
    sendable: true,
  },
  cf_email: {
    transport: 'cf_email',
    env: ['EMAIL_SEND_ACCOUNT_ID', 'EMAIL_SEND_TOKEN'],
    senders: "the clinic's own sending domain",
    sendable: true,
  },
  /**
   * RRM transactional and system mail on Cloudflare Email Sending, the rail
   * that replaces SES for the Academy and the Foundation. Same transport as
   * `cf_email` and a different lane on purpose: the sender rule, the fallback
   * and the telemetry all read the lane name, and a clinic's mail and the
   * Academy's receipts are not the same traffic.
   */
  cf_rrm: {
    transport: 'cf_email',
    env: ['EMAIL_SEND_ACCOUNT_ID', 'EMAIL_SEND_TOKEN'],
    senders: '@mail.rrmacademy.org for rrma, @mail.rrm.foundation for rrmf',
    sendable: true,
  },
};

/**
 * THE ONBOARDED SENDING SUBDOMAIN PER ENTITY, which is what decides the rail.
 *
 * Email Sending is onboarded at the ACCOUNT level against one domain at a
 * time and DKIM-signs as that domain, so the sending subdomain is the fact
 * that says which rail a from address belongs on. `mail.rrmacademy.org` is
 * onboarded on the RRM account (Task 10 Step 1); `mail.rrm.foundation` is the
 * Foundation's, and it follows the same path, so until it is onboarded a
 * Foundation send on it fails loud at the far side with `550 5.7.1 Email
 * sending is not enabled for domain` rather than going out unsigned.
 *
 * The APEX addresses (`@rrmacademy.org`, `@rrm.foundation`) stay on SES.
 * They are SES-verified identities rather than onboarded sending domains, and
 * keeping them addressable is what lets the newsletter exemption keep its
 * `hello@rrmacademy.org` sender and what gives a consumer a way to name the
 * old rail deliberately while the cutover is watched.
 */
export const CF_SENDER_DOMAINS = {
  rrma: ['mail.rrmacademy.org'],
  rrmf: ['mail.rrm.foundation'],
};

/**
 * The SES sending domains that remain addressable per entity.
 *
 * `rrmacademy.com` joined the Academy's list on 2026-09-11 as the BULK SENDING
 * IDENTITY, and it is not a second apex: the zone keeps its 301 to
 * rrmacademy.org and holds exactly one mailbox-shaped identity, newsletter@.
 * It exists because Google folds a subdomain's reputation into the apex's
 * compliance verdict, so isolating multi-thousand sends needs a different
 * REGISTRABLE domain, not a subdomain. Spec: rrm-academy-cf
 * docs/superpowers/specs/2026-09-10-bulk-mail-rail-design.md section 4.
 */
export const SES_SENDER_DOMAINS = {
  rrma: ['rrmacademy.org', 'rrmacademy.com'],
  rrmf: ['rrm.foundation'],
};

/** RRM purposes that belong to a person's mailbox, not to SES. */
export const WORKSPACE_PURPOSES = ['community', 'member', 'newsletter'];
/** RRM purposes SES exists to carry. */
export const SES_PURPOSES = ['transactional', 'system', 'receipt'];

/**
 * THE NAMED EXEMPTIONS FROM THE WORKSPACE RULE.
 *
 * Brian ruled on 2026-09-09 that two RRM sends do belong on SES despite their
 * purpose, and that they are the only two. A closed table is the whole point:
 * a send asks for an exemption BY NAME, the name must be in this table, and a
 * name that is not here refuses with `unknown-exemption` rather than falling
 * through to the ordinary rule. There is no wildcard, no `exempt: true`, and
 * no way for a consumer to add one without editing this file, which is what
 * keeps "every other rrma community, member or newsletter send is refused"
 * true rather than aspirational.
 *
 * Each entry binds its own `from` addresses as well as its entity. The from
 * binding is not decoration: the overdue-outreach exemption exists for one
 * mailbox's mail, and without the binding it would be a general licence to
 * put any member mail on SES by quoting the right string.
 *
 * `reason` is the ruling itself, kept next to the rule it authorises so the
 * next reader does not have to go looking for why an exemption exists.
 */
export const EXEMPTIONS = {
  'newsletter-blast': {
    entity: 'rrma',
    from: ['hello@rrmacademy.org', 'newsletter@mail.rrmacademy.org', 'newsletter@rrmacademy.com'],
    reason:
      'the newsletter product is a bulk send from hello@rrmacademy.org through SES with list-unsubscribe headers; '
      + 'the Workspace lane is one-at-a-time Gmail with a daily quota and refuses at volume; ruled by Brian 2026-09-09. '
      + 'newsletter@rrmacademy.com added 2026-09-11: the bulk rail sends as a separate registrable domain so a '
      + 'spam-rate day cannot reach rrmacademy.org, whose compliance verdict every transactional send shares',
  },
  'stuc-overdue-outreach': {
    entity: 'rrma',
    from: ['community@rrmacademy.org'],
    reason:
      'member overdue outreach from community@rrmacademy.org; disarmed by OVERDUE_EMAIL_ENABLED today; '
      + 'ruled by Brian 2026-09-09, revisit if it is ever armed',
  },
};

/**
 * Strip every C0 control and DEL out of anything about to become a header, and
 * cap it at the RFC 5322 line length. Ported from rrm-academy-cf's
 * `sanitizeHeader` with two deliberate changes.
 *
 * That copy THROWS on a control character and this one replaces it with a
 * space. A throw turns a hostile subject line typed into a public form into a
 * 500; a strip turns it into a harmless subject and lets the send proceed,
 * which is what every caller wanted the guard to do.
 *
 * And a RUN of controls collapses to ONE space, over the whole C0 range rather
 * than CR, LF and NUL alone. Two reasons, both from the clinic sender this
 * package merged: a CRLF pair replaced character by character leaves a double
 * space in the middle of every folded subject line, and an escape or a bell in
 * a subject is exactly as unwelcome as a newline even though it cannot split a
 * header on its own.
 */
export function sanitizeHeader(value, max = 998) {
  // eslint-disable-next-line no-control-regex -- intentional: block CRLF + control header injection
  return String(value ?? '').replace(/[\x00-\x1f\x7f]+/g, ' ').trim().slice(0, max);
}

/** "Display Name <addr@host>" down to "addr@host"; anything else unchanged. */
export function bareAddress(raw) {
  const s = String(raw ?? '').trim();
  const m = s.match(/<([^>]+)>\s*$/);
  return (m ? m[1] : s).trim();
}

function domainOf(address) {
  const at = address.lastIndexOf('@');
  return at === -1 ? '' : address.slice(at + 1).toLowerCase();
}

function onDomain(address, ...domains) {
  const d = domainOf(address);
  return domains.some((allowed) => d === allowed);
}

/**
 * Which rail an RRM entity's transactional mail rides, read off the from
 * address alone. Cloudflare Email Sending is the DEFAULT for the onboarded
 * sending subdomain; the apex stays on SES.
 *
 * The default flipped on 2026-09-09, and it flipped here rather than in a
 * consumer's config so that every RRM sender in the estate moves with one
 * sync. `ses_rrm` is still reachable two ways and only two: an apex from
 * address, and the runtime fallback in `send()` when the Cloudflare rail
 * answers a 5xx or nothing at all.
 */
function rrmRail(entity, address, purpose) {
  if (onDomain(address, ...CF_SENDER_DOMAINS[entity])) return 'cf_rrm';
  if (onDomain(address, ...SES_SENDER_DOMAINS[entity])) return 'ses_rrm';
  throw new LaneRefused(
    'sender-not-on-rail',
    `${address} may not send ${entity} ${purpose} mail, which leaves from `
    + `${CF_SENDER_DOMAINS[entity].map((d) => `@${d}`).join(' or ')} on lane cf_rrm `
    + `or ${SES_SENDER_DOMAINS[entity].map((d) => `@${d}`).join(' or ')} on lane ses_rrm`,
    { lane: 'cf_rrm' },
  );
}

function refuseSender(lane, from) {
  return new LaneRefused(
    'sender-not-on-rail',
    `${from} may not send on lane ${lane}, which carries ${LANES[lane].senders}`,
    { lane },
  );
}

/**
 * The one entry point: what lane may this message use?
 *
 *   resolveLane({ entity, purpose, from, clinicRail }) -> lane name
 *
 * Throws `LaneRefused` when no lane may carry it. The workspace refusal is a
 * throw like any other, because "this is not ours to send" is a refusal even
 * though a human will send it moments later; `send()` translates it into the
 * `{ ok: false, reason: 'workspace-lane-only', how: 'va-send.sh' }` answer the
 * caller can act on.
 *
 * `clinicRail` is the switch for FSP client sites: `'cf'` (the default, and
 * what is live today) keeps them on Cloudflare Email Sending, `'graph'` moves
 * them onto the FSP tenant rail the day that rail exists. It is a config flag
 * on the consumer, never a per-message decision.
 *
 * `exemption` names one entry in `EXEMPTIONS`, and is the only way past the
 * Workspace refusal. It is checked before anything else a send asks for, so a
 * misspelled name is `unknown-exemption` rather than a silent fall-through to
 * the ordinary rule, and it is bound to its entity and its from addresses, so
 * quoting the name from somewhere else refuses too.
 */
export function resolveLane({ entity, purpose, from, clinicRail, exemption } = {}) {
  const ent = String(entity ?? '').trim().toLowerCase();
  const pur = String(purpose ?? '').trim().toLowerCase();
  if (!ent) throw new LaneRefused('no-entity', 'a message must name the entity that owns it');
  const address = bareAddress(from).toLowerCase();
  if (!address) throw new LaneRefused('no-sender', 'a message must name its from address');
  if (!address.includes('@')) {
    throw new LaneRefused('no-sender', `"${from}" is not an email address`);
  }

  const exemptionName = String(exemption ?? '').trim();
  let granted = null;
  if (exemptionName) {
    const entry = Object.prototype.hasOwnProperty.call(EXEMPTIONS, exemptionName)
      ? EXEMPTIONS[exemptionName]
      : null;
    if (!entry) {
      throw new LaneRefused(
        'unknown-exemption',
        `"${exemptionName}" is not one of the named exemptions (${Object.keys(EXEMPTIONS).join(', ')})`,
      );
    }
    if (entry.entity !== ent) {
      throw new LaneRefused(
        'exemption-not-for-entity',
        `exemption "${exemptionName}" belongs to entity ${entry.entity}, not ${ent}`,
      );
    }
    if (!entry.from.includes(address)) {
      throw new LaneRefused(
        'exemption-sender-not-allowed',
        `exemption "${exemptionName}" covers ${entry.from.join(' and ')}, not ${address}`,
      );
    }
    granted = entry;
  }

  if (ent === 'rrma') {
    if (WORKSPACE_PURPOSES.includes(pur)) {
      if (!granted) {
        throw new LaneRefused(
          'workspace-lane-only',
          `RRM ${pur} mail is a personal Workspace send, never SES`,
          { lane: 'workspace', how: LANES.workspace.how },
        );
      }
      // A granted exemption still sends from an address this entity is allowed
      // to send from: the exemption lifts the PURPOSE rule, never the rail's
      // sender rule. This reads the domain tables rather than a hardcoded pair,
      // which is what it always meant; the literal list silently outranked
      // SES_SENDER_DOMAINS and would have refused the bulk domain even after it
      // was admitted there (found 2026-09-11 building the bulk rail).
      if (!onDomain(address, ...CF_SENDER_DOMAINS[ent], ...SES_SENDER_DOMAINS[ent])) {
        throw refuseSender('ses_rrm', address);
      }
      return 'ses_rrm';
    }
    if (!SES_PURPOSES.includes(pur)) {
      throw new LaneRefused(
        'unknown-purpose',
        `purpose "${purpose}" is not one of ${[...WORKSPACE_PURPOSES, ...SES_PURPOSES].join(', ')}`,
      );
    }
    return rrmRail('rrma', address, pur);
  }

  /**
   * The Foundation is its own entity with its own sending domain, and it
   * rides the same SES account the Academy does: one verified SES identity
   * set, two org identities on top of it. Splitting it out rather than
   * folding rrm.foundation into `rrma` keeps the refusal honest, because a
   * message about Academy membership must not be able to go out over the
   * Foundation's domain by naming the wrong entity, or the reverse.
   *
   * The Foundation sends no community, member or newsletter mail: the
   * Workspace rule is the Academy's list rule, and it is left where it
   * belongs rather than copied here for symmetry.
   */
  if (ent === 'rrmf') {
    if (!SES_PURPOSES.includes(pur)) {
      throw new LaneRefused(
        'unknown-purpose',
        `purpose "${purpose}" is not one of ${SES_PURPOSES.join(', ')}`,
      );
    }
    return rrmRail('rrmf', address, pur);
  }

  if (ent === 'fsp') {
    if (!onDomain(address, 'fivestarpractices.com')) throw refuseSender('graph_fsp', address);
    return 'graph_fsp';
  }

  if (ent === 'neo') {
    if (!onDomain(address, 'neofertility.ie')) throw refuseSender('graph_neo', address);
    return 'graph_neo';
  }

  if (ent === 'clinic') {
    const rail = String(clinicRail ?? 'cf').trim().toLowerCase();
    if (rail === 'graph') {
      if (!onDomain(address, 'fivestarpractices.com')) throw refuseSender('graph_fsp', address);
      return 'graph_fsp';
    }
    if (rail !== 'cf' && rail !== 'cloudflare') {
      throw new LaneRefused('unknown-rail', `clinicRail "${clinicRail}" is neither "cf" nor "graph"`);
    }
    return 'cf_email';
  }

  throw new LaneRefused('unknown-entity', `entity "${entity}" has no lane in this estate`);
}
