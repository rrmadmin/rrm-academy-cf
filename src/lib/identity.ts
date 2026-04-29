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
 */

import snapshot from '../generated/ssot-schema.json';
import teamData from '../data/team.json';
import agentSurfaces from '../../ssot/agent-surfaces.json';

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
