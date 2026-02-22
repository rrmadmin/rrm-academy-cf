import { fetchAllPosts } from '../../lib/blog';

export async function GET() {
  const posts = await fetchAllPosts();

  const items = posts.map(post => {
    const pubDate = post.publishDate
      ? new Date(post.publishDate + 'T00:00:00').toUTCString()
      : '';

    return `    <item>
      <title><![CDATA[${post.title}]]></title>
      <link>https://rrmacademy.org/commentary/${post.slug}</link>
      <guid isPermaLink="true">https://rrmacademy.org/commentary/${post.slug}</guid>
      <description><![CDATA[${post.excerpt || ''}]]></description>
      ${pubDate ? `<pubDate>${pubDate}</pubDate>` : ''}
      ${post.author ? `<author>${post.author}</author>` : ''}
    </item>`;
  });

  const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>RRM Academy Commentary</title>
    <link>https://rrmacademy.org/commentary</link>
    <description>Expert clinical perspectives on restorative reproductive medicine from RRM Academy.</description>
    <language>en-us</language>
    <atom:link href="https://rrmacademy.org/commentary/rss.xml" rel="self" type="application/rss+xml" />
${items.join('\n')}
  </channel>
</rss>`;

  return new Response(rss.trim(), {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
    },
  });
}
