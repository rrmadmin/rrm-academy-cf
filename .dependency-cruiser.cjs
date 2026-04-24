/**
 * dependency-cruiser rules for src/lib/.
 * Seed ruleset — we'll expand coverage to the whole repo in a later pass.
 */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'warn',
      comment: 'Cycles between src/lib modules indicate tangled responsibilities.',
      from: { path: '^src/lib' },
      to: { circular: true },
    },
    {
      name: 'ts-must-not-import-fetchers',
      severity: 'error',
      comment: 'TS utilities are runtime; fetch-*.mjs scripts are build-time only.',
      from: { path: '^src/lib/.+\\.ts$' },
      to: { path: '^src/lib/fetch-.+\\.mjs$' },
    },
    {
      name: 'no-orphans',
      severity: 'warn',
      comment: 'File is neither imported nor imports anything. Probably dead code.',
      from: {
        orphan: true,
        pathNot: [
          'src/lib/fetch-.+\\.mjs$', // entry-point fetchers are expected orphans
          '\\.d\\.ts$',
          'src/lib/airtable-config\\.mjs$', // config-only module
        ],
      },
      to: {},
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    includeOnly: { path: '^src/lib' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      extensions: ['.js', '.mjs', '.cjs', '.ts', '.tsx'],
    },
    reporterOptions: {},
  },
};
