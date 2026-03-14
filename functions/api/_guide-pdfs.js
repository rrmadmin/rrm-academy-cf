// Per-guide PDF configuration.
// To activate a guide: set enabled: true, upload the PDF to R2, deploy.
// r2Key: path within the rrm-assets R2 bucket.
// pagePath: used by /api/pdf/redeem to redirect errors back to the guide page.
export const GUIDE_PDFS = {
  'naprotechnology': {
    enabled: false,
    r2Key: 'guide-pdfs/naprotechnology.pdf',
    title: 'The Complete NaProTechnology Guide',
    pagePath: '/naprotechnology/',
  },
  'what-is-rrm': {
    enabled: false,
    r2Key: 'guide-pdfs/what-is-rrm.pdf',
    title: 'What Is Restorative Reproductive Medicine?',
    pagePath: '/what-is-rrm/',
  },
};
