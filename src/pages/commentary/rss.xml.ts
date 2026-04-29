import { fetchAllPosts } from '../../lib/blog';
import { escapeCdata, escapeXml, toUtcString } from '../../lib/rss';

const FEED_ITEM_LIMIT = 50;

export async function GET() {
  const posts = await fetchAllPosts();

  const recent = posts.slice(0, FEED_ITEM_LIMIT);

  const lastBuildDate = (recent.length > 0 && recent[0].publishDate
    ? toUtcString(recent[0].publishDate)
    : '') || new Date().toUTCString();

  const items = recent.map(post => {
    const pubDate = post.publishDate ? toUtcString(post.publishDate) : '';
    if (post.publishDate && !pubDate) {
      console.warn('[rss-commentary] Invalid publishDate for post', post.id, post.publishDate);
    }

    return `    <item>
      <title><![CDATA[${escapeCdata(post.title)}]]></title>
      <link>https://rrmacademy.org/commentary/${escapeXml(post.slug)}/</link>
      <guid isPermaLink="true">https://rrmacademy.org/commentary/${escapeXml(post.slug)}/</guid>
      <description><![CDATA[${escapeCdata(post.excerpt || '')}]]></description>
      ${pubDate ? `<pubDate>${pubDate}</pubDate>` : ''}
      ${post.author ? `<dc:creator><![CDATA[${escapeCdata(post.author)}]]></dc:creator>` : ''}
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
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
  });
}
