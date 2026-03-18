// scripts/convert-provider-data.mjs
// Converts provider directory unified data into Astro-ready providers.json
//
// Usage: node scripts/convert-provider-data.mjs [input.json]
// Default input: ../projects/rrm-provider-directory/data/prototype-full.json
// Output: src/data/providers.json

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const inputPath = process.argv[2] || resolve(__dirname, '../../../projects/rrm-provider-directory/data/prototype-full.json');
const outputPath = resolve(__dirname, '../src/data/providers.json');

const raw = JSON.parse(readFileSync(inputPath, 'utf8'));

// --- Data Prerequisites (from spec) ---

// 1. NaPro implies Creighton
function applyNaproCreighton(record) {
  if (record.methods?.includes('napro') && !record.methods.includes('creighton')) {
    record.methods = ['creighton', ...record.methods];
  }
  return record;
}

// 2. Page generation threshold: name + (city OR methods OR phone OR website)
function passesThreshold(r) {
  if (!r.name) return false;
  return !!(r.city || (r.methods && r.methods.length > 0) || r.phone || r.website);
}

// 3. Accepting patients merge
function mergeAccepting(r) {
  if (r.gbp_accepting_patients !== undefined && r.gbp_accepting_patients !== null) {
    return r.gbp_accepting_patients;
  }
  if (r.accepting_patients !== undefined && r.accepting_patients !== null) {
    return r.accepting_patients;
  }
  return null; // unknown
}

// 4. Verification tier -> badge type
function verificationBadge(r) {
  const tier = r.verification_tier || '';
  if (tier === 'npi_healthgrades' || tier === 'npi_verified') return 'npi_verified';
  if (tier === 'multi_source' || tier === 'manually_verified') return 'verified';
  return null;
}

// 5. FAQ generator
function generateFAQs(r) {
  const faqs = [];
  const name = r.display_name || r.name;

  if (r.methods && r.methods.length > 0) {
    const methodNames = r.methods.map(m => METHOD_LABELS[m] || m).join(', ');
    const sources = r.source_directory_label || r.source || 'public directories';
    faqs.push({
      q: `What methods does ${name} practice?`,
      a: `${name} is trained in ${methodNames}, as listed in the ${sources} directory.`
    });
  }

  if (mergeAccepting(r) !== null) {
    const status = mergeAccepting(r) ? 'currently accepting new patients' : 'not currently accepting new patients';
    const loc = r.practice_name ? ` at ${r.practice_name}` : '';
    const city = r.city ? ` in ${r.city}, ${r.state || ''}`.trim() : '';
    faqs.push({
      q: `Is ${name} accepting new patients?`,
      a: `${mergeAccepting(r) ? 'Yes' : 'No'}, ${name} is ${status}${loc}${city}.`
    });
  }

  if (r.telehealth === 'yes') {
    faqs.push({
      q: `Does ${name} offer telehealth?`,
      a: `Yes, ${name} offers telehealth appointments.`
    });
  }

  if (r.city) {
    const practice = r.practice_name ? ` at ${r.practice_name}` : '';
    const phone = r.phone ? ` You can reach the office at ${r.phone}.` : '';
    faqs.push({
      q: `Where is ${name} located?`,
      a: `${name} practices${practice} in ${r.city}, ${r.state || r.country || ''}.${phone}`
    });
  }

  if (r.phone) {
    faqs.push({
      q: `What is ${name}'s phone number?`,
      a: `You can reach ${name} at ${r.phone}${r.phone_ext ? ` ext. ${r.phone_ext}` : ''}.`
    });
  }

  if (r.npi_verified) {
    faqs.push({
      q: `Is ${name} NPI verified?`,
      a: `Yes, ${name}'s NPI number (${r.npi_number}) has been verified as active in the federal registry.`
    });
  }

  if (r.practitioner_type) {
    const typeLabel = TYPE_LABELS[r.practitioner_type] || r.practitioner_type;
    faqs.push({
      q: `What type of provider is ${name}?`,
      a: `${name} is a ${typeLabel}.`
    });
  }

  // Universal fallback: source (always exists)
  const sourceLabel = r.source_directory_label || r.source || 'a fertility awareness directory';
  faqs.push({
    q: `What directories list ${name}?`,
    a: `${name} is listed in the ${sourceLabel} directory.${r._all_sources && r._all_sources.length > 1 ? ` Also found in: ${r._all_sources.map(s => s.replace(/-/g, ' ')).join(', ')}.` : ''}`
  });

  return faqs;
}

// 6. Meta tag generation
function generateMeta(r) {
  const name = r.display_name || r.name;
  const method = r.methods?.[0] ? (METHOD_LABELS[r.methods[0]] || r.methods[0]) : '';
  const loc = r.city ? `${r.city}, ${r.state || r.country || ''}`.trim() : '';

  // display_name already includes credentials via buildDisplayName -- do not re-append
  let title = name;
  title += ' -- ';
  if (method) title += `${method} Provider`;
  else title += 'Provider';
  if (loc) title += ` in ${loc}`;
  title += ' | RRM Academy';

  const typeLabel = TYPE_LABELS[r.practitioner_type] || 'provider';
  const methods = r.methods?.map(m => METHOD_LABELS[m] || m).join(', ') || '';
  let desc = `${name} is a ${typeLabel}`;
  if (methods) desc += ` practicing ${methods}`;
  if (loc) desc += ` in ${loc}`;
  desc += '. Find contact info, credentials, and verification details.';
  if (desc.length > 155) desc = desc.slice(0, 152) + '...';

  return { title, description: desc };
}

// 7. Similar providers (build-time computation)
function computeSimilar(record, allRecords) {
  const scored = allRecords
    .filter(r => r.slug !== record.slug && r.practice_group_id !== record.practice_group_id)
    .map(r => {
      let score = 0;
      const sharedMethods = (record.methods || []).filter(m => (r.methods || []).includes(m));
      if (sharedMethods.length > 0) {
        score += sharedMethods.length * 10;
        if (record.methods?.[0] && r.methods?.includes(record.methods[0])) score += 20;
      }
      if (r.city && record.city && r.city === record.city) score += 15;
      else if (r.state && record.state && r.state === record.state) score += 10;
      else if (r.country && record.country && r.country === record.country) score += 5;
      if (r.practitioner_type && r.practitioner_type === record.practitioner_type) score += 5;
      return { slug: r.slug, score };
    })
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  if (scored.length < 3 && record.state) {
    const existing = new Set(scored.map(s => s.slug));
    const fallbacks = allRecords
      .filter(r => r.slug !== record.slug && r.state === record.state && !existing.has(r.slug))
      .slice(0, 3 - scored.length);
    scored.push(...fallbacks.map(r => ({ slug: r.slug, score: 1 })));
  }

  return scored.map(s => s.slug);
}

const METHOD_LABELS = {
  napro: 'NaPro', creighton: 'Creighton', femm: 'FEMM', neofertility: 'NeoFertility',
  marquette: 'Marquette', billings: 'Billings', 'sympto-thermal': 'Sympto-Thermal',
  'boston-crosscheck': 'Boston Crosscheck', lam: 'LAM', sensiplan: 'Sensiplan',
  'standard-days': 'Standard Days', other: 'Other'
};

const TYPE_LABELS = {
  medical: 'medical provider', educator: 'fertility awareness educator',
  mental_health: 'mental health provider', nurse_practitioner: 'nurse practitioner',
  pharmacist: 'pharmacist', chiropractor: 'chiropractor', naturopath: 'naturopath',
  physical_therapist: 'physical therapist', nutritionist: 'nutritionist',
  health_coach: 'health coach', doula: 'doula/lactation consultant'
};

function buildDisplayName(r) {
  let name = r.name || '';
  const hasDoctorate = /\b(MD|DO|MBBS|PhD|PsyD|DPT|PharmD|DC|ND|NMD|DNP)\b/.test(r.credentials || r.name);
  if (!hasDoctorate) name = name.replace(/^Dr\.?\s+/i, '');
  if (r.credentials && !name.includes(r.credentials)) name += `, ${r.credentials}`;
  return name;
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// --- Process all records ---
const processed = raw
  .map(applyNaproCreighton)
  .filter(passesThreshold);

console.log(`Input: ${raw.length} records. After threshold filter: ${processed.length}`);

// Build practice groups (2+ members only)
const practiceGroups = {};
for (const r of processed) {
  if (r.practice_group_id) {
    if (!practiceGroups[r.practice_group_id]) practiceGroups[r.practice_group_id] = [];
    practiceGroups[r.practice_group_id].push(r);
  }
}

// Resolve practice names and build practice entries
const practices = [];
for (const [groupId, members] of Object.entries(practiceGroups)) {
  if (members.length < 2) continue;
  const nameCounts = {};
  for (const m of members) {
    if (m.practice_name) nameCounts[m.practice_name] = (nameCounts[m.practice_name] || 0) + 1;
  }
  let practiceName = Object.entries(nameCounts).sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0]?.[0];
  if (!practiceName) {
    const first = members.sort((a, b) => (a.last_name || '').localeCompare(b.last_name || ''))[0];
    practiceName = `${first.first_name || ''} ${first.last_name || ''} Practice`.trim();
  }
  const city = members.find(m => m.city)?.city || '';
  const state = members.find(m => m.state)?.state || '';
  const phone = members.find(m => m.phone)?.phone || '';
  const website = members.find(m => m.website)?.website || '';
  const slug = slugify(`${practiceName}-${city}-${state}`) || `practice-${groupId}`;

  practices.push({
    slug, name: practiceName, group_id: groupId,
    city, state, phone, website,
    country: members.find(m => m.country)?.country || 'USA',
    member_slugs: members.map(m => m.slug),
    is_online_only: false
  });
}

// Enrich providers with computed fields
const providers = processed.map(r => {
  const display_name = buildDisplayName(r);
  return {
    ...r,
    display_name,
    accepting: mergeAccepting(r),
    verification_badge: verificationBadge(r),
    faqs: generateFAQs({ ...r, display_name }),
    meta: generateMeta({ ...r, display_name }),
    similar_slugs: [],
    practice_slug: null
  };
});

// Link providers to practice slugs
for (const practice of practices) {
  for (const memberSlug of practice.member_slugs) {
    const provider = providers.find(p => p.slug === memberSlug);
    if (provider) provider.practice_slug = practice.slug;
  }
}

// Compute similar providers
console.log('Computing similar providers (this may take a moment)...');
for (const provider of providers) {
  provider.similar_slugs = computeSimilar(provider, providers);
}

// Detect slug collisions and append suffixes
const slugCounts = {};
for (const p of providers) {
  slugCounts[p.slug] = (slugCounts[p.slug] || 0) + 1;
  if (slugCounts[p.slug] > 1) p.slug += `-${slugCounts[p.slug]}`;
}
const practiceSlugCounts = {};
for (const p of practices) {
  practiceSlugCounts[p.slug] = (practiceSlugCounts[p.slug] || 0) + 1;
  if (practiceSlugCounts[p.slug] > 1) p.slug += `-${practiceSlugCounts[p.slug]}`;
}

const output = { providers, practices };
writeFileSync(outputPath, JSON.stringify(output, null, 2));
console.log(`Wrote ${providers.length} providers and ${practices.length} practices to ${outputPath}`);
