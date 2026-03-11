/**
 * GET /api/courses/certificate?courseId=  — serve HTML certificate of completion
 *
 * Requirements:
 *   - Authenticated user
 *   - Enrolled and completed the course
 *   - Course has hasCertificate: true
 *   - Post-class quiz score >= 80%
 *
 * Lazy-issues: if eligible but certificate_issued_at is null, sets it now.
 * Returns a printable HTML page (not JSON).
 */
import {
  json, optionsResponse, getSessionIdFromCookie, validateSession,
} from '../auth/_shared.js';
import { log } from '../_log.js';
import { getCourse, getCertificateQuizId, CERTIFICATE_MIN_SCORE } from './_shared.js';

export async function onRequestOptions() {
  return optionsResponse();
}

export async function onRequestGet({ request, env, waitUntil }) {
  try {
    const db = env.DB;
    if (!db) return json({ ok: false, error: 'Server misconfigured' }, 500);

    const sessionId = getSessionIdFromCookie(request);
    const session = await validateSession(db, sessionId);
    if (!session) return htmlError('Please log in to view your certificate.', 401, '/login');

    const url = new URL(request.url);
    const courseId = url.searchParams.get('courseId');
    if (!courseId) return htmlError('Missing course ID.', 400);

    const course = getCourse(courseId);
    if (!course) return htmlError('Course not found.', 404);
    if (!course.hasCertificate) return htmlError('This course does not offer a certificate.', 400);

    const enrollment = await db.prepare(
      'SELECT id, completed_at, certificate_issued_at FROM enrollment WHERE user_id = ? AND course_id = ?'
    ).bind(session.userId, courseId).first();
    if (!enrollment) return htmlError('You are not enrolled in this course.', 403);
    if (!enrollment.completed_at) return htmlError('Course not yet completed.', 403);

    const quizStepId = getCertificateQuizId(courseId);
    if (quizStepId) {
      const quiz = await db.prepare(
        'SELECT score FROM step_progress WHERE user_id = ? AND course_id = ? AND step_id = ? AND completed = 1'
      ).bind(session.userId, courseId, quizStepId).first();
      if (!quiz || quiz.score < CERTIFICATE_MIN_SCORE) {
        return htmlError(`A quiz score of ${CERTIFICATE_MIN_SCORE}% or higher is required.`, 403);
      }
    }

    // Lazy-issue: set certificate_issued_at if not already set
    let issuedAt = enrollment.certificate_issued_at;
    if (!issuedAt) {
      await db.prepare(
        "UPDATE enrollment SET certificate_issued_at = datetime('now') WHERE user_id = ? AND course_id = ? AND certificate_issued_at IS NULL"
      ).bind(session.userId, courseId).run();
      const updated = await db.prepare(
        'SELECT certificate_issued_at FROM enrollment WHERE user_id = ? AND course_id = ?'
      ).bind(session.userId, courseId).first();
      issuedAt = updated?.certificate_issued_at;
    }

    // Get user name
    const user = await db.prepare('SELECT name, first_name, last_name, email FROM user WHERE id = ?')
      .bind(session.userId).first();
    const studentName = user.name
      || [user.first_name, user.last_name].filter(Boolean).join(' ')
      || user.email;

    // Format certificate number from enrollment ID (first 8 chars uppercase)
    const certNumber = `RRM-${enrollment.id.slice(0, 8).toUpperCase()}`;

    // Format dates
    const completedDate = formatDate(enrollment.completed_at);
    const issuedDate = formatDate(issuedAt);

    // Instructor from course data
    const instructor = course.instructors?.[0]?.name || 'RRM Academy';

    const html = renderCertificate({
      studentName,
      courseTitle: course.title,
      instructor,
      completedDate,
      issuedDate,
      certNumber,
    });

    return new Response(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html;charset=UTF-8',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
      },
    });
  } catch (err) {
    log(env, waitUntil, 'courses', 'certificate_error', 'error', err.message, 0, 500);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}

function htmlError(message, status, redirectUrl) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const redirect = redirectUrl
    ? `<p style="margin-top:1rem"><a href="${esc(redirectUrl)}" style="color:#725e7e">Go to login</a></p>`
    : '<p style="margin-top:1rem"><a href="javascript:history.back()" style="color:#725e7e">Go back</a></p>';
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Certificate Error</title></head><body style="font-family:Georgia,serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f5f0f0;color:#2c2c2c"><div style="text-align:center;max-width:480px;padding:2rem"><h1 style="color:#725e7e;font-size:1.5rem">Certificate Unavailable</h1><p>${esc(message)}</p>${redirect}</div></body></html>`;
  return new Response(html, { status, headers: { 'Content-Type': 'text/html;charset=UTF-8' } });
}

function formatDate(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function renderCertificate({ studentName, courseTitle, instructor, completedDate, issuedDate, certNumber }) {
  // Escape HTML to prevent XSS
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Certificate of Completion — ${esc(courseTitle)}</title>
<style>
  @page { size: landscape; margin: 0; }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { height: 100%; }
  body {
    font-family: Georgia, 'Times New Roman', serif;
    background: #f5f0f0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2rem;
    color: #2c2c2c;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .certificate {
    width: 100%;
    max-width: 960px;
    aspect-ratio: 1.414;
    background: #fff;
    position: relative;
    padding: 3rem;
    box-shadow: 0 4px 24px rgba(0,0,0,0.1);
  }
  .border-outer {
    border: 3px solid #725e7e;
    height: 100%;
    padding: 1.5rem;
  }
  .border-inner {
    border: 1px solid #c4b5cb;
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 2rem 3rem;
    text-align: center;
    gap: 0.5rem;
  }
  .org {
    font-size: 1rem;
    letter-spacing: 0.3em;
    text-transform: uppercase;
    color: #725e7e;
    margin-bottom: 0.25rem;
  }
  .heading {
    font-size: 2.25rem;
    font-weight: normal;
    color: #725e7e;
    letter-spacing: 0.05em;
    margin-bottom: 0.5rem;
  }
  .rule {
    width: 120px;
    height: 1px;
    background: #c4b5cb;
    margin: 0.5rem 0;
  }
  .presents {
    font-size: 0.95rem;
    font-style: italic;
    color: #666;
  }
  .student-name {
    font-size: 2rem;
    font-weight: normal;
    color: #2c2c2c;
    border-bottom: 1px solid #c4b5cb;
    padding: 0.25rem 2rem;
    margin: 0.25rem 0;
  }
  .for-text {
    font-size: 0.95rem;
    font-style: italic;
    color: #666;
  }
  .course-title {
    font-size: 1.35rem;
    font-weight: bold;
    color: #2c2c2c;
    margin: 0.25rem 0 0.5rem;
    max-width: 80%;
    line-height: 1.4;
  }
  .details {
    display: flex;
    gap: 3rem;
    margin-top: auto;
    padding-top: 1rem;
    font-size: 0.85rem;
    color: #666;
  }
  .details .col {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
  }
  .details .label {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.15em;
    color: #999;
  }
  .details .value {
    color: #2c2c2c;
  }
  .cert-id {
    font-size: 0.7rem;
    color: #aaa;
    letter-spacing: 0.1em;
    margin-top: 0.5rem;
  }
  .actions {
    margin-top: 1.5rem;
    display: flex;
    gap: 1rem;
  }
  .actions button {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 0.9rem;
    padding: 0.6rem 1.5rem;
    border: 1px solid #725e7e;
    background: #725e7e;
    color: #fff;
    border-radius: 4px;
    cursor: pointer;
  }
  .actions button:hover { background: #5e4d68; }
  .actions .secondary {
    background: #fff;
    color: #725e7e;
  }
  .actions .secondary:hover { background: #f5f0f5; }
  @media print {
    body { background: #fff; padding: 0; }
    .certificate { box-shadow: none; max-width: none; width: 100%; height: 100%; }
    .actions { display: none; }
  }
</style>
</head>
<body>
<div class="certificate">
  <div class="border-outer">
    <div class="border-inner">
      <p class="org">RRM Academy</p>
      <h1 class="heading">Certificate of Completion</h1>
      <div class="rule"></div>
      <p class="presents">This is to certify that</p>
      <p class="student-name">${esc(studentName)}</p>
      <p class="for-text">has successfully completed the course</p>
      <p class="course-title">${esc(courseTitle)}</p>
      <div class="rule"></div>
      <div class="details">
        <div class="col">
          <span class="label">Instructor</span>
          <span class="value">${esc(instructor)}</span>
        </div>
        <div class="col">
          <span class="label">Completed</span>
          <span class="value">${esc(completedDate)}</span>
        </div>
        <div class="col">
          <span class="label">Issued</span>
          <span class="value">${esc(issuedDate)}</span>
        </div>
      </div>
      <p class="cert-id">${esc(certNumber)}</p>
    </div>
  </div>
</div>
<div class="actions">
  <button onclick="window.print()">Print Certificate</button>
  <button class="secondary" onclick="window.history.back()">Back to Course</button>
</div>
</body>
</html>`;
}
