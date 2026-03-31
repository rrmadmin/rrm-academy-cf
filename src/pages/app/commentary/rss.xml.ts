import { fetchAllPosts } from '../../../lib/blog';

function escapeCdata(str: string): string {
  return str.replace(/]]>/g, ']]]]><![CDATA[>');
}

function escapeXml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function toUtcString(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  return isNaN(d.getTime()) ? '' : d.toUTCString();
}

export async function GET() {
  const posts = await fetchAllPosts();

  const lastBuildDate = (posts.length > 0 && posts[0].publishDate
    ? toUtcString(posts[0].publishDate)
    : '') || new Date().toUTCString();

  const items = posts.map(post => {
    const pubDate = post.publishDate ? toUtcString(post.publishDate) : '';

    return `    <item>
      <title><![CDATA[${escapeCdata(post.title)}]]></title>
      <link>https://rrmacademy.org/commentary/${escapeXml(post.slug)}</link>
      <guid isPermaLink="true">https://rrmacademy.org/commentary/${escapeXml(post.slug)}</guid>
      <description><![CDATA[${escapeCdata(post.excerpt || '')}]]></description>
      ${pubDate ? `<pubDate>${pubDate}</pubDate>` : ''}
      ${post.author ? `<dc:creator>${escapeXml(post.author)}</dc:creator>` : ''}
    </item>`;
  });

  const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>RRM Academy Commentary</title>
    <link>https://rrmacademy.org/commentary</link>
    <description>Expert clinical perspectives on restorative reproductive medicine from RRM Academy.</description>
    <language>en-us</language>
    <lastBuildDate>${lastBuildDate}</lastBuildDate>
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
