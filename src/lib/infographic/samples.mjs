export const SAMPLES = [
  { template: 'single', eyebrow: 'Cumulative outcome', value: '62%', label: 'cumulative live-birth rate over 24 months', source: { label: 'Cohort 2024', doi: '10.1000/abc123' } },
  { template: 'single', eyebrow: 'Low rate', value: '32%', label: 'a low single renders a progress bar, not a sparse pictograph', source: { label: 'Cohort', pmid: '30109231' } },
  { template: 'single', eyebrow: 'Male factor', value: '88%', label: 'pictograph with male figures', icon: 'man', source: { label: 'Cohort', pmid: '30109231' } },
  { template: 'single', eyebrow: 'Humanized hero', value: '88%', headline: '9 in 10', label: '88% of women conceived within a year using the Creighton Model', source: { label: 'Stanford 2025', pmid: '40729325' } },
  { template: 'delta', eyebrow: 'Headline finding', value: '38%', direction: 'up', polarity: 'favorable', label: 'higher live-birth rate vs continued IVF', source: { label: 'Boyle 2018', pmid: '30109231' } },
  { template: 'bars', eyebrow: 'Live birth, matched cohort', unit: '%', caption: 'Restorative vs IVF', bars: [{ name: 'Restorative', value: 62, hero: true }, { name: 'IVF', value: 34 }], source: { label: 'Synopsis', pmid: '30109231' } },
  { template: 'ratio', eyebrow: 'Population burden', numerator: 1, denominator: 8, label: 'couples affected by infertility', icon: 'couple', source: { label: 'CDC', url: 'https://cdc.gov/art' } },
  { template: 'ratio', eyebrow: 'Male factor', numerator: 1, denominator: 3, label: 'couples conceived naturally without IVF', icon: 'man', source: { label: 'Grande 2025', pmid: '39930939' } },
  { template: 'correction', eyebrow: 'Unexplained infertility', was: '50%', value: '8%', label: 'remain unexplained after a thorough workup', source: { label: 'Grande 2025', pmid: '39930939' } },
];
