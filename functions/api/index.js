/**
 * /api - API discovery root.
 *
 * Pages Functions routing: index.js in functions/api/ handles the bare /api
 * path only (never subpaths). Every method except OPTIONS returns a Bearer 401
 * whose WWW-Authenticate header points agent clients at the protected-resource
 * metadata document, with a body of human/agent-readable pointers.
 */
import { optionsResponse, bearerUnauthorized } from './auth/_shared.js';

export function onRequestOptions() {
  return optionsResponse();
}

export function onRequest() {
  return bearerUnauthorized({
    error: 'unauthorized',
    hint: 'This is the RRM Academy API root. See /openapi.json for the API reference, /.well-known/oauth-protected-resource for auth metadata, and /api/ask/sandbox for the no-auth test endpoint.',
    openapi: 'https://rrmacademy.org/openapi.json',
  });
}
