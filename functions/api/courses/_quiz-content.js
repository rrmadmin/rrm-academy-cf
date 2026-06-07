/**
 * Dual-read quiz content (spec 8.2.4b): D1 step_rendition (format='quiz',
 * status='published') first, static quizzes.json fallback. The fallback and
 * its static import are retired in 8.2.4e AFTER the soak; until then a D1
 * read failure degrades to exactly today's behavior instead of 404ing all
 * quizzes (including the cert quiz). Static data is a parameter so this
 * module stays importable under node:test.
 */
export async function getQuizContent(db, stepId, staticQuizData) {
  try {
    const row = await db.prepare(
      "SELECT content_json FROM step_rendition WHERE step_id = ? AND format = 'quiz' AND status = 'published'"
    ).bind(stepId).first();
    if (row?.content_json) {
      const parsed = JSON.parse(row.content_json);
      if (parsed && Array.isArray(parsed.questions)) return parsed;
    }
  } catch (err) {
    // Fallback IS the handling, but the soak needs a signal when D1 reads fail.
    console.error(`quiz dual-read D1 fallback for ${stepId}: ${err.message}`);
  }
  return staticQuizData[stepId] || null;
}
