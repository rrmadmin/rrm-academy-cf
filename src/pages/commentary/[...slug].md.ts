/**
 * Per-page Markdown source endpoint for commentary posts.
 * Output URLs: /commentary/<slug>.md
 *
 * Mirrors the published-post logic in src/pages/commentary/[...slug].astro
 * (fetchAllPosts returns only published posts from posts.json). Returns a
 * clean text/markdown twin of the post body so AI agents fetch source
 * instead of parsing rendered HTML.
 */
import type { APIRoute, GetStaticPaths } from 'astro';
import { fetchAllPosts, type BlogPost } from '../../lib/blog';
import { buildMarkdownTwin, MARKDOWN_HEADERS } from '../../lib/markdown-twin';

export const prerender = true;

export const getStaticPaths: GetStaticPaths = async () => {
  const posts = await fetchAllPosts();
  return posts.map((post) => ({
    params: { slug: post.slug },
    props: { post },
  }));
};

interface Props {
  post: BlogPost;
}

export const GET: APIRoute = async ({ props }) => {
  const { post } = props as Props;

  const markdown = await buildMarkdownTwin({
    title: post.title,
    canonicalUrl: `https://rrmacademy.org/commentary/${post.slug}/`,
    body: post.content || '',
    bodyFormat: 'markdown',
    author: post.author,
    date: post.publishDate,
    dateLabel: 'Published',
  });

  return new Response(markdown, { headers: MARKDOWN_HEADERS });
};
