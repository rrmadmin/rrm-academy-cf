import { sendEmail, logEmailFailure } from '../_ses.js';
import { log } from '../_log.js';

export async function notifyAdminEnrollment(env, { studentEmail, studentName, courseTitle, courseId, isFree }) {
  if (!env.AWS_ACCESS_KEY_ID) {
    log(env, () => {}, 'courses', 'admin_notify_skipped', 'skipped', `${courseId} (SES not configured)`);
    return;
  }

  const timestamp = new Date().toISOString();
  const enrollmentType = isFree ? 'Free' : 'Paid';
  const subject = `New enrollment: ${studentName || studentEmail} - ${courseTitle}`;
  const text = [
    'New course enrollment',
    '',
    `Student name:  ${studentName || '(not set)'}`,
    `Student email: ${studentEmail}`,
    `Course:        ${courseTitle}`,
    `Course ID:     ${courseId}`,
    `Type:          ${enrollmentType}`,
    `Timestamp:     ${timestamp}`,
  ].join('\n');

  try {
    await sendEmail(env, {
      from: 'RRM Academy <accounts@mail.rrmacademy.org>',
      to: 'administrator@rrmacademy.org',
      subject,
      text,
      log: { db: env.DB, source: 'courses/admin-notify', category: 'transactional' },
    });
  } catch (err) {
    await logEmailFailure(env.DB, {
      email: 'administrator@rrmacademy.org',
      category: 'transactional',
      source: 'courses/admin-notify',
      subject,
      detail: err.message,
    });
  }
}
