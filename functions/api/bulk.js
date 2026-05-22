/**
 * GET /api/bulk?ids=a,b,c
 *
 * Top-level alias for /api/articles/bulk. Same shape, same behavior, same
 * rate-limit budget. Exists so URL-pattern scanners that look for /bulk at
 * the API root (not nested under /articles/) recognize the batch surface.
 *
 * Real handler is functions/api/articles/bulk.js; re-exported here.
 */
export { onRequestGet, onRequestOptions } from './articles/bulk.js';
