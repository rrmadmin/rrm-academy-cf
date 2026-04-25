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
      name: 'fetchers-are-build-time-only',
      severity: 'error',
      comment: 'Build-time fetch-*.mjs scripts must not be imported by runtime modules (build-time vs runtime, not .ts vs .mjs).',
      from: { path: '^src/lib/', pathNot: '^src/lib/fetch-' },
      to: { path: '^src/lib/fetch-' },
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
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      extensions: ['.js', '.mjs', '.cjs', '.ts', '.tsx'],
    },
    reporterOptions: {},
  },
};
