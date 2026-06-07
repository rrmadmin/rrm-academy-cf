import { test, expect } from '@playwright/test';

// Phase 0 surface: logged-out behavior of the new rendition endpoints and
// the unchanged quiz endpoint (rollback posture: nothing learner-visible
// changed). Authenticated-path E2E lands with Phase 1.

test('rendition endpoint 401s logged out', async ({ request }) => {
  const res = await request.get('/api/courses/rendition?stepId=mc-intro-3&format=reading');
  expect(res.status()).toBe(401);
  const body = await res.json();
  expect(body.ok).toBe(false);
});

test('rendition endpoint 401s before leaking format validation', async ({ request }) => {
  const res = await request.get('/api/courses/rendition?stepId=mc-intro-3&format=bogus');
  expect(res.status()).toBe(401);
});

test('admin renditions endpoint 401s logged out', async ({ request }) => {
  const res = await request.get('/api/admin/courses/masterclass-endo-surgery/steps/mc-intro-3/renditions');
  expect(res.status()).toBe(401);
});

test('quiz endpoint still 401s logged out (dual-read no regression)', async ({ request }) => {
  const res = await request.get('/api/courses/quiz?courseId=masterclass-endo-surgery&stepId=mc-intro-3');
  expect(res.status()).toBe(401);
});
