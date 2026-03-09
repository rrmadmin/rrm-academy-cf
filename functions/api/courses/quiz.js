/**
 * GET  /api/courses/quiz?courseId=&stepId=  — get quiz/questionnaire questions
 * POST /api/courses/quiz                    — submit answers, get score
 *
 * Quiz types:
 *   "quiz"          — multiple-choice with correct answers, scored 0-100
 *   "questionnaire" — Likert scale / feedback, always scores 100 on completion
 *
 * Quiz question format (in quizzes.json):
 *   { id, text, options: string[], correctIndex: number }
 *
 * Questionnaire question formats:
 *   { id, text, type: "likert", scale: { min, max, labels: string[] }, prefix?: string }
 *   { id, text, type: "freetext" }
 *   { id, text, type: "multiselect", options: string[] }
 */
import {
  json, optionsResponse, getSessionIdFromCookie, validateSession,
} from '../auth/_shared.js';
import { log } from '../_log.js';
import { getCourse, isValidStep, getPreviousStepId, autoEnrollAdmin } from './_shared.js';
import quizData from '../../../src/data/quizzes.json';

export async function onRequestOptions() {
  return optionsResponse();
}

// --- GET: fetch quiz questions ---

export async function onRequestGet({ request, env, waitUntil }) {
  try {
    const db = env.DB;
    if (!db) return json({ ok: false, error: 'Server misconfigured' }, 500);

    const sessionId = getSessionIdFromCookie(request);
    const session = await validateSession(db, sessionId);
    if (!session) return json({ ok: false, error: 'Not authenticated' }, 401);

    const url = new URL(request.url);
    const courseId = url.searchParams.get('courseId');
    const stepId = url.searchParams.get('stepId');
    if (!courseId || !stepId) return json({ ok: false, error: 'courseId and stepId required' }, 400);

    const course = getCourse(courseId);
    if (!course) return json({ ok: false, error: 'Course not found' }, 404);
    if (!isValidStep(courseId, stepId)) return json({ ok: false, error: 'Invalid step' }, 400);

    // Superadmin: auto-enroll on first access (mirrors progress.js)
    await autoEnrollAdmin(db, session.userId, courseId);

    // Verify enrolled
    const enrollment = await db.prepare(
      'SELECT id FROM enrollment WHERE user_id = ? AND course_id = ?'
    ).bind(session.userId, courseId).first();
    if (!enrollment) return json({ ok: false, error: 'Not enrolled' }, 403);

    // Step locking
    if (course.settings?.stepOrder === 'fixed') {
      const prevStepId = getPreviousStepId(courseId, stepId);
      if (prevStepId) {
        const prev = await db.prepare(
          'SELECT completed FROM step_progress WHERE user_id = ? AND course_id = ? AND step_id = ?'
        ).bind(session.userId, courseId, prevStepId).first();
        if (!prev?.completed) {
          return json({ ok: false, error: 'Previous step not completed' }, 403);
        }
      }
    }

    const quiz = quizData[stepId];
    if (!quiz) return json({ ok: false, error: 'No quiz data for this step' }, 404);
    if (quiz.questions.length === 0) return json({ ok: false, error: 'Quiz content not yet available' }, 404);

    // Strip correct answers before sending to client
    const safeQuestions = quiz.questions.map(q => {
      if (quiz.type === 'quiz') {
        const { correctIndex: _correctIndex, ...rest } = q;
        return rest;
      }
      return q;
    });

    return json({
      ok: true,
      type: quiz.type,
      title: quiz.title,
      description: quiz.description,
      passingScore: quiz.passingScore,
      questions: safeQuestions,
    });
  } catch (err) {
    log(env, waitUntil, 'courses', 'quiz_error', 'error', `GET: ${err.message}`, 0, 500);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}

// --- POST: submit quiz answers ---

export async function onRequestPost({ request, env, waitUntil }) {
  try {
    return await handleQuizSubmit(request, env);
  } catch (err) {
    log(env, waitUntil, 'courses', 'quiz_error', 'error', `POST: ${err.message}`, 0, 500);
    return json({ ok: false, error: 'Internal error' }, 500);
  }
}

async function handleQuizSubmit(request, env) {
  const db = env.DB;
  if (!db) return json({ ok: false, error: 'Server misconfigured' }, 500);

  const sessionId = getSessionIdFromCookie(request);
  const session = await validateSession(db, sessionId);
  if (!session) return json({ ok: false, error: 'Not authenticated' }, 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Invalid JSON' }, 400);
  }

  const { courseId, stepId, answers } = body;
  if (!courseId || !stepId) return json({ ok: false, error: 'courseId and stepId required' }, 400);
  if (!Array.isArray(answers)) return json({ ok: false, error: 'answers must be an array' }, 400);

  const course = getCourse(courseId);
  if (!course) return json({ ok: false, error: 'Course not found' }, 404);
  if (!isValidStep(courseId, stepId)) return json({ ok: false, error: 'Invalid step' }, 400);

  // Superadmin: auto-enroll on first access (mirrors progress.js)
  await autoEnrollAdmin(db, session.userId, courseId);

  // Verify enrolled
  const enrollment = await db.prepare(
    'SELECT id FROM enrollment WHERE user_id = ? AND course_id = ?'
  ).bind(session.userId, courseId).first();
  if (!enrollment) return json({ ok: false, error: 'Not enrolled' }, 403);

  // Step locking
  if (course.settings?.stepOrder === 'fixed') {
    const prevStepId = getPreviousStepId(courseId, stepId);
    if (prevStepId) {
      const prev = await db.prepare(
        'SELECT completed FROM step_progress WHERE user_id = ? AND course_id = ? AND step_id = ?'
      ).bind(session.userId, courseId, prevStepId).first();
      if (!prev?.completed) {
        return json({ ok: false, error: 'Previous step not completed' }, 403);
      }
    }
  }

  const quiz = quizData[stepId];
  if (!quiz) return json({ ok: false, error: 'No quiz data for this step' }, 404);
  if (quiz.questions.length === 0) return json({ ok: false, error: 'Quiz content not yet available' }, 404);

  if (answers.length !== quiz.questions.length) {
    return json({ ok: false, error: `Expected ${quiz.questions.length} answers, got ${answers.length}` }, 400);
  }

  // Score the submission
  let score;
  let results = null;

  if (quiz.type === 'quiz') {
    // Multiple-choice: each answer is an index (0-based)
    let correct = 0;
    results = [];
    for (let i = 0; i < quiz.questions.length; i++) {
      const q = quiz.questions[i];
      const answer = answers[i];
      if (typeof answer !== 'number' || answer < 0 || answer >= q.options.length) {
        return json({ ok: false, error: `Invalid answer for question ${i + 1}` }, 400);
      }
      const isCorrect = answer === q.correctIndex;
      if (isCorrect) correct++;
      results.push({
        questionId: q.id,
        correct: isCorrect,
        selected: answer,
        correctIndex: q.correctIndex,
      });
    }
    score = Math.round((correct / quiz.questions.length) * 100);
  } else {
    // Questionnaire: any response = completed, score 100
    score = 100;
  }

  const passed = quiz.passingScore ? score >= quiz.passingScore : true;

  // Save to step_progress (completed=1, score updates on retake)
  await db.prepare(`
    INSERT INTO step_progress (user_id, course_id, step_id, completed, score, last_position_seconds, updated_at)
    VALUES (?1, ?2, ?3, 1, ?4, 0, datetime('now'))
    ON CONFLICT(user_id, course_id, step_id) DO UPDATE SET
      completed = 1,
      score = MAX(step_progress.score, ?4),
      updated_at = datetime('now')
  `).bind(session.userId, courseId, stepId, score).run();

  // Determine attempt number
  const attemptRow = await db.prepare(
    'SELECT COALESCE(MAX(attempt), 0) AS max_attempt FROM quiz_response WHERE user_id = ? AND course_id = ? AND step_id = ?'
  ).bind(session.userId, courseId, stepId).first();
  const attempt = (attemptRow?.max_attempt || 0) + 1;

  // Save individual responses
  const stmts = quiz.questions.map((q, i) => {
    const answerValue = String(answers[i]);
    const isCorrect = quiz.type === 'quiz' ? (answers[i] === q.correctIndex ? 1 : 0) : null;
    return db.prepare(
      'INSERT INTO quiz_response (user_id, course_id, step_id, attempt, question_id, answer_value, is_correct) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(session.userId, courseId, stepId, attempt, q.id, answerValue, isCorrect);
  });
  await db.batch(stmts);

  const response = { ok: true, score, passed, attempt };
  if (results) response.results = results;
  return json(response);
}
