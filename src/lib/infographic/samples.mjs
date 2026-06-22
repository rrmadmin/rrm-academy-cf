export const SAMPLES = [
  { template: 'single', eyebrow: 'Cumulative outcome', value: '62%', label: 'cumulative live-birth rate over 24 months', source: { label: 'Cohort 2024', doi: '10.1000/abc123' } },
  { template: 'delta', eyebrow: 'Headline finding', value: '38%', direction: 'up', polarity: 'favorable', label: 'higher live-birth rate vs continued IVF', source: { label: 'Boyle 2018', pmid: '30109231' } },
  { template: 'bars', eyebrow: 'Live birth, matched cohort', unit: '%', caption: 'Restorative vs IVF', bars: [{ name: 'Restorative', value: 62, hero: true }, { name: 'IVF', value: 34 }], source: { label: 'Synopsis', pmid: '30109231' } },
  { template: 'ratio', eyebrow: 'Population burden', numerator: 1, denominator: 8, label: 'couples affected by infertility', source: { label: 'CDC', url: 'https://cdc.gov/art' } },
];
