# Isthmocele commentary: FAQ schema addition

> Generated 2026-05-11.
> Adds 5 patient-focused FAQ entries to the highest-AEO commentary on the site (504 Bing AI citations / 27.5% of all AI citations on rrmacademy.org).

## What changes

### 1. Append an FAQ section to the post body in D1

Post: `rrm-auth.posts` where `id='rec7aQ4iRUufWOLFR'` and `slug='uterine-isthmocele-c-section-scar-restorative-solutions'`.

Insert this section AFTER the existing "A Restorative Path Forward for Patients and Providers" H2 and BEFORE the "**Sources:**" block:

```markdown
## Frequently Asked Questions

### What is a uterine isthmocele?

A uterine isthmocele, also called a cesarean scar defect or niche, is a pouch-like indentation on the inner wall of the uterus at the site of a previous C-section scar. Instead of healing flush, the scar forms a small cavity in the lower uterine segment where menstrual blood and fluid collect. Isthmoceles are common: approximately 20% of women who have had a C-section develop one, though many remain asymptomatic. When symptoms do appear, they typically include prolonged post-menstrual brown spotting, pelvic discomfort, and secondary infertility (difficulty conceiving after a previous pregnancy).

### What are the symptoms of an isthmocele?

The most distinctive symptom is post-menstrual brown bleeding: several days of brown or dark spotting that continues after a period seems to have ended. This happens because blood pools in the scar niche and drains slowly. Other patterns include spotting between periods, spotting after intercourse or exercise, chronic pelvic pain, painful periods, and painful intercourse. Secondary infertility is a common presenting symptom. Some women have no symptoms at all, and the niche is discovered incidentally during imaging for other reasons. Women who chart their cycles using a fertility awareness method such as the Creighton Model often notice the abnormal bleeding pattern earlier than women who are not closely monitoring their cycles.

### How is a uterine isthmocele diagnosed?

The most accurate way to diagnose an isthmocele is with a saline infusion sonohysterogram (SIS), an ultrasound procedure in which sterile fluid is gently infused into the uterine cavity so the defect becomes clearly visible. SIS can both confirm the presence of a niche at the C-section scar and measure the remaining thickness of the muscle wall above the defect, a measurement that directly informs treatment choice. A standard transvaginal ultrasound can detect many isthmoceles but may miss smaller defects. MRI provides the highest-resolution view and is sometimes used for surgical planning. The diagnosis is frequently delayed in routine OB/GYN care because many physicians are unfamiliar with the condition and the symptoms are often attributed to other causes.

### Can an isthmocele cause infertility?

Yes, an isthmocele can cause secondary infertility through several distinct mechanisms. First, blood trapped in the niche creates chronic inflammation of the uterine lining, which can kill sperm as they travel through the uterus toward the egg. Second, the inflammatory environment is hostile to embryo implantation. Third, retained fluid can leak into the uterine cavity at the time of ovulation and around implantation, further disrupting the conditions a healthy pregnancy needs. If pregnancy does occur with an untreated isthmocele, the abnormally thinned muscle wall at the C-section scar carries a higher risk of miscarriage and, rarely, uterine rupture. Surgical repair of the defect can restore fertility: published series report subsequent pregnancy in 56% of previously infertile women within a year of repair, and experienced restorative surgical centers report 75-80% subsequent pregnancy rates.

### How is an isthmocele repaired?

There are two main restorative surgical approaches, and the choice depends on the thickness of the muscle wall above the defect and whether the patient wants future pregnancy.

**Hysteroscopic repair** shaves or cauterizes the rim of the niche from inside the uterus, so menstrual blood no longer pools. It is appropriate for women with abnormal bleeding when the remaining muscle wall is greater than 5 mm thick and who do not intend to get pregnant again. The procedure is short, with a 2-3 day recovery. Hysteroscopic repair does not thicken the muscle wall, so it is not the preferred approach for women who want future pregnancy.

**Laparoscopic or robotic repair** completely excises the scar defect and reconstructs the uterine wall in 2-3 layers of absorbable suture. It is the preferred approach when the remaining muscle wall is less than 5 mm thick or when the patient wants future pregnancy, because it restores wall thickness and substantially lowers the risk of miscarriage and uterine rupture in subsequent pregnancies. Recovery is 1-2 weeks, and patients are advised to wait approximately 4 months before attempting pregnancy to allow full healing.

The restorative reproductive medicine approach is to diagnose and repair the underlying defect rather than bypassing it with IVF. Many women who undergo repair go on to conceive naturally.
```

### 2. Patch the commentary template to emit FAQPage JSON-LD

File: `src/pages/commentary/[...slug].astro`.

Insert this block AFTER the existing `glossaryTermNodes` block (around line 190, after the closing brace) and BEFORE `const { '@context': _ctx, ...blogPostingNode } = jsonLd;`:

```typescript
// FAQ schema for any commentary with a "Frequently Asked Questions" section.
// Detects markdown H2 "Frequently Asked Questions" followed by H3 Q + paragraph A,
// emits FAQPage @graph node so Bing/Google can surface Q&A in AI grounding.
const faqMainEntity: any[] = [];
if (post.content) {
  const faqSection = post.content.match(/##\s+Frequently\s+Asked\s+Questions\b[\s\S]*?(?=\n##\s|\n\*\*Sources|$)/i);
  if (faqSection) {
    const qPattern = /###\s+(.+?)\n+([\s\S]+?)(?=\n###\s+|$)/g;
    let m;
    while ((m = qPattern.exec(faqSection[0])) !== null) {
      const q = m[1].trim();
      const a = m[2]
        .trim()
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')  // strip markdown links
        .replace(/\*\*([^*]+)\*\*/g, '$1')         // strip bold
        .replace(/\*([^*]+)\*/g, '$1')             // strip italic
        .replace(/\s+/g, ' ');                      // collapse whitespace
      if (q && a && a.length >= 40 && a.length <= 1500) {
        faqMainEntity.push({
          '@type': 'Question',
          name: q,
          acceptedAnswer: { '@type': 'Answer', text: a },
        });
      }
    }
  }
}
```

And in the `graphNodes` assembly (around line 193-203), add:

```typescript
if (faqMainEntity.length >= 2) {
  graphNodes.push({
    '@type': 'FAQPage',
    mainEntity: faqMainEntity,
  });
}
```

The detection is generic across every commentary post — any post that adds an "## Frequently Asked Questions" section with `### question` + paragraph answer pattern automatically gets FAQPage schema. No per-post config needed.

## Verify

After deploying:

```bash
curl -sL https://rrmacademy.org/commentary/uterine-isthmocele-c-section-scar-restorative-solutions/ \
  | grep -oE '"@type":"FAQPage"[^}]*' | head -5
# Expect: a "FAQPage" entry with 5 questions
```

Then Google's Rich Results Test (URL: https://search.google.com/test/rich-results) against the live URL should report FAQPage detected.

## Deploy steps

1. Branch `claude/2026-05-11-isthmocele-faq-aeo` in `rrm-academy-cf`.
2. Commit:
   - `src/pages/commentary/[...slug].astro` — FAQ regex + FAQPage emission
3. SQL UPDATE for post body (via wrangler against `rrm-auth`, one-time, AFTER PR auto-merges):
   ```sql
   UPDATE posts
   SET content = ?,  -- new body with FAQ appended
       updated_at = datetime('now')
   WHERE id = 'rec7aQ4iRUufWOLFR';
   ```
4. Single-record dispatch:
   ```bash
   gh workflow run deploy.yml --ref main \
     -f post_id=rec7aQ4iRUufWOLFR
   # OR via repository_dispatch with record_id
   ```
5. After dispatch deploys, IndexNow ping (single URL):
   ```bash
   INDEXNOW_SINGLE_URL="https://rrmacademy.org/commentary/uterine-isthmocele-c-section-scar-restorative-solutions/" \
     INDEXNOW_KEY="b8afc8c2e9b698654fff259a02fe1b51" \
     node scripts/submit-indexnow.mjs
   ```

## Why this works for AEO

The isthmocele commentary already pulls 504 Bing AI citations on the strength of its content alone. FAQPage schema tells AI engines exactly which Q&A pairs are quotable — a structured signal Bing and Google specifically reward for AI grounding. The 5 questions cover the canonical patient-intent queries that match how patients search for this condition. Expected lift: 10-20% additional AI citations within 30-60 days post-deploy.

## Reusability

The template patch is **post-agnostic**. After this ships, any future commentary post can add an "## Frequently Asked Questions" section and the FAQPage schema emits automatically. No code change per post. This is the same pattern as the existing `glossaryTermNodes` DefinedTerm detection in the same template.
