export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const query = url.searchParams.get('q');

  if (!query || query.length < 2) {
    return Response.json({ results: [] });
  }

  try {
    // Embed the user's query
    const embedding = await env.AI.run('@cf/baai/bge-base-en-v1.5', {
      text: [query],
    });
    const queryVector = embedding.data[0];

    // Find nearest neighbors
    const matches = await env.VECTORIZE.query(queryVector, {
      topK: 10,
      returnMetadata: 'all',
    });

    const results = matches.matches.map(m => ({
      slug: m.metadata.slug,
      title: m.metadata.title,
      year: m.metadata.year,
      authors: m.metadata.authors,
      type: m.metadata.type || 'Research',
      score: m.score,
      url: `/library/${m.metadata.slug}/`,
    }));

    return Response.json({ results }, {
      headers: {
        'Cache-Control': 'public, max-age=300',
      },
    });
  } catch (err) {
    console.error('Semantic search error:', err);
    return Response.json({ results: [], error: 'search_failed' }, { status: 500 });
  }
}
