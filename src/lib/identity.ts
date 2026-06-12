/**
 * Identity SSOT helper.
 *
 * Static import of build-time snapshot at src/generated/ssot-schema.json
 * (regenerated each build by scripts/ssot-prebuild.mjs from ssot/*.json
 * + ../../config/ecosystem-identity/).
 *
 * Use these helpers wherever a page needs Organization or Person JSON-LD,
 * the canonical org sameAs list, or social-handle metadata. Do not hand-author
 * Organization or Person JSON-LD; emit through the @graph helper instead.
 *
 * Phase 2 (2026-04-29): identity.ts is the central schema builder library.
 * In addition to Organization/Person/Website/Team helpers, this module exports
 * builders for Article, MedicalWebPage, MedicalScholarlyArticle, ScholarlyArticle,
 * Course, FAQPage, BreadcrumbList, and SpeakableSpecification. Pages should
 * compose @graph arrays from these builders rather than hand-writing JSON-LD.
 *
 * Pure (SSOT-independent) builders live in ./schema-builders.mjs and are
 * re-exported below. SSOT-dependent builders (which need the org @id, person
 * @id resolution, or courses SSOT lookup) are defined here.
 */

import snapshot from '../generated/ssot-schema.json';
import teamData from '../data/team.json';
import agentSurfaces from '../../ssot/agent-surfaces.json';
import coursesSsot from '../../ssot/courses.json';

import {
  buildSpeakable as _buildSpeakable,
  buildFAQPage as _buildFAQPage,
  buildBreadcrumbList as _buildBreadcrumbList,
  buildScholarlyArticleStub as _buildScholarlyArticleStub,
  buildMedicalScholarlyArticle as _buildMedicalScholarlyArticle,
} from './schema-builders.mjs';

/**
 * Canonical `sameAs` array for Dr. Naomi Whittaker's Person node
 * (`@id: https://rrmacademy.org/#naomi-whittaker`).
 *
 * SINGLE SOURCE OF TRUTH. Every page that emits a Naomi Person node in JSON-LD
 * (homepage, /about/, commentary posts, course pages) must reference THIS array
 * rather than pasting literals, so the entity-anchor links can never drift.
 * Mirrors the entity identifiers asserted on Wikidata Q139936526.
 */
export const NAOMI_SAME_AS: readonly string[] = [
  'https://orcid.org/0000-0003-3706-3112',
  'https://www.wikidata.org/wiki/Q139936526',
  'https://openalex.org/A5035074827',
  'https://npiregistry.cms.hhs.gov/provider-view/1881034908',
  'https://www.instagram.com/napro_fertility_surgeon/',
  'https://www.linkedin.com/in/naomi-whittaker-md-906b13101/',
  'https://x.com/naomimwhittaker',
  'https://www.tiktok.com/@fertilitysurgeon',
  'https://irrma.org/case-report-a-life-saving-fertility-surgery-and-an-impossible-case-of-spontaneous-pregnancy/',
];

type SchemaNode = Record<string, unknown> & { '@id'?: string };

interface OrgNode extends SchemaNode {
  '@type': string | string[];
  '@id': string;
  name: string;
  url: string;
  sameAs?: string[];
}

interface PersonNode extends SchemaNode {
  '@type': string | string[];
  '@id': string;
  name: string;
}

interface SocialHandle {
  platform: 'instagram' | 'linkedin' | 'x' | 'tiktok' | 'facebook' | 'youtube' | 'substack' | 'threads';
  url: string;
  handle?: string;
  aria_label: string;
  order: number;
}

export interface TeamMember {
  ssot_id: string;
  given_name: string;
  family_name: string;
  name: string;
  credentials: string | null;
  academy_role: string;
  foundation_role: string;
  photo: string | null;
  photo_alt: string;
  bio_paragraphs: string[];
  display_order: number;
}

export function getOrganizationJsonLd(): OrgNode {
  return snapshot.organization as OrgNode;
}

/**
 * RRM Foundation legal-entity node. RRM Academy is a program of this 501(c)(3);
 * the registered legalName + EIN + charity profiles belong here, NOT on the
 * Academy org node. Emit this as a distinct node (the parentOrganization target)
 * in every @graph that asserts the organization, so the two entities stay
 * decoupled. Single source so consumers (homepage, BaseLayout default, about)
 * cannot drift and silently re-create the Academy=Foundation merge conflation.
 */
export function getFoundationJsonLd(): SchemaNode {
  return {
    '@type': ['Organization', 'NGO'],
    '@id': 'https://rrm.foundation/#organization',
    name: 'Restorative Reproductive Medicine Foundation',
    legalName: 'Restorative Reproductive Medicine Foundation Inc',
    url: 'https://rrm.foundation/',
    identifier: [{ '@type': 'PropertyValue', propertyID: 'EIN', value: '93-4594315' }],
    sameAs: [
      'https://projects.propublica.org/nonprofits/organizations/934594315',
      'https://www.guidestar.org/profile/93-4594315',
      'https://www.wikidata.org/wiki/Q139900390',
    ],
    // Entity-graph anchor to the restorative reproductive medicine concept node
    // on Wikidata (Q139807849). Ties our org graph to the field-of-work item the
    // Academy/Foundation Wikidata items already reference via P101. The Academy
    // org node's `knowsAbout` is a string list emitted inline in BaseLayout +
    // homepage; this is the single-source, crawlable sameAs link to the concept.
    knowsAbout: [
      {
        '@type': 'Thing',
        name: 'Restorative reproductive medicine',
        sameAs: 'https://www.wikidata.org/wiki/Q139807849',
      },
    ],
  };
}

export function getWebsiteJsonLd(): SchemaNode {
  return snapshot.website as SchemaNode;
}

export function getAllPeopleJsonLd(): PersonNode[] {
  return (snapshot.people as PersonNode[]) || [];
}

export function getPersonJsonLd(atId: string): PersonNode | undefined {
  return getAllPeopleJsonLd().find((p) => p['@id'] === atId);
}

export function getTeam(): TeamMember[] {
  const members = (teamData.members as TeamMember[]) || [];
  return [...members].sort((a, b) => a.display_order - b.display_order);
}

export function getSocialHandles(): SocialHandle[] {
  const raw = (agentSurfaces.social_handles as SocialHandle[]) || [];
  const orgSameAs = (getOrganizationJsonLd().sameAs as string[]) || [];

  for (const h of raw) {
    if (!orgSameAs.includes(h.url)) {
      throw new Error(
        `social_handles[${h.platform}].url ${h.url} is not in organization.sameAs. ` +
          `Add to ssot/organization.json same_as[] or remove from agent-surfaces.json.`
      );
    }
  }

  return [...raw].sort((a, b) => a.order - b.order);
}

export function buildIdentityGraph(): SchemaNode[] {
  const org = getOrganizationJsonLd();
  const people = getAllPeopleJsonLd();
  return [org, ...people].map((node) => {
    const { '@context': _ctx, ...rest } = node as SchemaNode & { '@context'?: unknown };
    return rest;
  });
}

// =============================================================================
// Phase 2 — pure builders re-exported from schema-builders.mjs
// =============================================================================

export const buildSpeakable: (opts?: { cssSelectors?: string[]; xpath?: string[] }) => SchemaNode | null = _buildSpeakable as any;
export const buildFAQPage: (faqs: { question: string; answer: string }[]) => SchemaNode = _buildFAQPage as any;
export const buildBreadcrumbList: (items: { name: string; url: string }[]) => SchemaNode = _buildBreadcrumbList as any;
export const buildScholarlyArticleStub: (props: {
  name: string;
  author: string;
  datePublished: string;
  journal?: string;
}) => SchemaNode = _buildScholarlyArticleStub as any;
export const buildMedicalScholarlyArticle: (article: any) => SchemaNode = _buildMedicalScholarlyArticle as any;

// =============================================================================
// Phase 2 — SSOT-dependent builders
// =============================================================================

/**
 * Course from ssot/courses.json. Looks up by slug or @id; returns null when
 * no SSOT entry matches. provider/instructor refs are already @id-shaped in
 * the SSOT, so the returned node is ready to emit.
 */
export function buildCourse(courseSlugOrId: string): SchemaNode | null {
  if (!courseSlugOrId) return null;
  const list = ((coursesSsot as { courses?: SchemaNode[] }).courses as SchemaNode[]) || [];
  const target = String(courseSlugOrId).trim();
  const found = list.find((c) => {
    const id = String(c['@id'] || '');
    if (id === target) return true;
    // Match the slug embedded in the @id pattern: .../courses/<slug>/#course
    const m = id.match(/\/courses\/([^/]+)\/#course$/);
    if (m && m[1] === target) return true;
    return false;
  });
  if (!found) return null;
  return {
    '@context': 'https://schema.org',
    ...found,
  };
}

/**
 * Article (BlogPosting / commentary) JSON-LD. Author resolved to a Person ref
 * (@id) when authorRef matches a known SSOT person; otherwise inline.
 */
export function buildArticle(props: {
  headline: string;
  url: string;
  datePublished: string;
  dateModified?: string;
  authorRef?: string;
  authorName?: string;
  image?: string;
  description?: string;
  articleSection?: string;
}): SchemaNode {
  const org = getOrganizationJsonLd();
  const node: SchemaNode = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: props.headline,
    url: props.url,
    datePublished: props.datePublished,
    dateModified: props.dateModified || props.datePublished,
    publisher: { '@id': org['@id'] },
  };
  if (props.description) node.description = props.description;
  if (props.image) node.image = props.image;
  if (props.articleSection) node.articleSection = props.articleSection;
  if (props.authorRef) {
    const person = getPersonJsonLd(props.authorRef);
    node.author = person ? { '@id': props.authorRef } : { '@type': 'Person', name: props.authorRef };
  } else if (props.authorName) {
    node.author = { '@type': 'Person', name: props.authorName };
  } else {
    node.author = { '@id': org['@id'] };
  }
  return node;
}

/**
 * MedicalWebPage for pillar guides. ReviewedBy resolves to Person @id ref when
 * reviewedByName matches an SSOT person; otherwise inline. Specialty maps to
 * MedicalAudience; about maps to MedicalCondition.
 */
export function buildMedicalWebPage(props: {
  name: string;
  url: string;
  description?: string;
  lastReviewed?: string;
  reviewedByName?: string;
  specialty?: string;
  about?: string;
}): SchemaNode {
  const org = getOrganizationJsonLd();
  const node: SchemaNode = {
    '@context': 'https://schema.org',
    '@type': 'MedicalWebPage',
    name: props.name,
    url: props.url,
    publisher: { '@id': org['@id'] },
  };
  if (props.description) node.description = props.description;
  if (props.lastReviewed) node.lastReviewed = props.lastReviewed;
  if (props.reviewedByName) {
    const all = getAllPeopleJsonLd();
    const person = all.find((p) => p.name === props.reviewedByName);
    node.reviewedBy = person
      ? { '@id': person['@id'] }
      : { '@type': 'Person', name: props.reviewedByName };
  }
  if (props.specialty) {
    node.medicalAudience = { '@type': 'MedicalAudience', audienceType: props.specialty };
  }
  if (props.about) {
    node.about = { '@type': 'MedicalCondition', name: props.about };
  }
  return node;
}
