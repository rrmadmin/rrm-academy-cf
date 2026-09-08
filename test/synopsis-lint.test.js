import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { lintSynopsis, fkGrade } from '../src/lib/synopsis-lint.mjs';

const good = {
  title: 'Family doctor first meant less IVF and the same pregnancy rate',
  tldr: 'Women who started with a family doctor were about half as likely to go through IVF. About 51 out of 100 in each group got pregnant within 5 years.',
  key_findings: ['51.2% of 732 women in the generalist group got pregnant within 5 years.', '50.7% of 67 women in the specialist group did.', 'Adjusted odds ratio for IVF 0.48 (95% CI 0.28 to 0.82).'],
  clinical_implications: 'Starting with a doctor who looks for causes first did not cost these women time or pregnancies.',
  methodology: 'A cohort of 867 women in Utah was followed for up to 5 years.',
  rrm_context: 'Restorative care starts by finding the reason a couple cannot conceive.',
};
const rules = (r) => r.findings.map((f) => f.rule);

describe('lintSynopsis', () => {
  it('passes a compliant synopsis', () => {
    const r = lintSynopsis(good);
    assert.equal(r.ok, true, JSON.stringify(r.findings));
  });
  it('fails the legacy clinical_relevance key', () => {
    const { clinical_implications, ...rest } = good;
    const r = lintSynopsis({ ...rest, clinical_relevance: clinical_implications });
    assert.ok(rules(r).includes('unknown-key') && rules(r).includes('missing-key'));
  });
  it('fails em dash, leading Yes, absolutist, British spelling, lab value, funnel, surname-as-agent', () => {
    const r = lintSynopsis({
      ...good,
      tldr: 'Yes — this always works.',
      clinical_implications: 'Dr. Smith treated her with 25 mg letrozole and oestradiol was 40 pmol/l. Book a visit with Dr. Whittaker.',
    });
    for (const rule of ['em-dash', 'leading-yes', 'absolutist', 'british-spelling', 'lab-value-or-dose', 'patient-funnel', 'surname-as-agent']) {
      assert.ok(rules(r).includes(rule), `missing ${rule}: ${JSON.stringify(r.findings)}`);
    }
    assert.ok(r.findings.some((f) => f.rule === 'drug-name' && f.level === 'WARN'));
    assert.equal(r.ok, false);
  });
  it('fails a title number whose tldr has no denominator', () => {
    const r = lintSynopsis({ ...good, title: '88% of Creighton Model users got pregnant, new study finds', tldr: 'The rate was high. Most did well over time.' });
    assert.ok(rules(r).includes('title-number-needs-denominator'));
  });
  it('fails jargon in the tldr, warns elsewhere', () => {
    const r = lintSynopsis({ ...good, tldr: good.tldr + ' The cumulative pregnancy rate was high.', methodology: good.methodology + ' Idiopathic cases only.' });
    const j = r.findings.filter((f) => f.rule === 'jargon');
    assert.ok(j.some((f) => f.where === 'tldr' && f.level === 'FAIL'));
    assert.ok(j.some((f) => f.where === 'methodology' && f.level === 'WARN'));
  });
  it('fails oversize key findings and too many items', () => {
    const long = Array.from({ length: 40 }, () => 'word').join(' ');
    const r = lintSynopsis({ ...good, key_findings: [long, 'a', 'b', 'c', 'd', 'e'] });
    assert.ok(rules(r).includes('key-finding-length') && rules(r).includes('key-findings-count'));
  });
  it('warns when rrm_context restates the tldr', () => {
    const r = lintSynopsis({ ...good, rrm_context: good.tldr });
    assert.ok(rules(r).includes('rrm-context-restates-tldr'));
  });
  it('flags reading grade', () => {
    assert.ok(fkGrade('The cat sat on the mat.') < 5);
    const dense = 'Multidimensional physiological characterization of endocrinological heterogeneity necessitates comprehensive individualized interdisciplinary evaluation methodologies.';
    const r = lintSynopsis({ ...good, tldr: dense });
    assert.ok(rules(r).includes('reading-grade'));
  });
  it('warns when compared shares in the tldr use different denominators', () => {
    const r = lintSynopsis({ ...good, tldr: 'Without support, 10 out of 22 pregnancies were lost. With care, 7 out of 40 were lost.' });
    assert.ok(rules(r).includes('mixed-denominators'));
    const ok = lintSynopsis({ ...good, tldr: 'Without support, about 5 out of 10 pregnancies were lost. With care, fewer than 2 out of 10 were lost.' });
    assert.ok(!rules(ok).includes('mixed-denominators'));
  });
});
