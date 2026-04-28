import { fetchAllArticles, type Article } from '../../lib/airtable';
import { escapeCdata, escapeXml, toUtcString, dateCompareKey, truncate } from '../../lib/rss';

const FEED_ITEM_LIMIT = 50;
const DESCRIPTION_MAX_CHARS = 500;

function buildDescription(article: Article): string {
  const parts: string[] = [];
  if (article.authors) parts.push(article.authors);
  if (article.journal) {
    parts.push(article.year ? `${article.journal} (${article.year})` : article.journal);
  } else if (article.year) {
    parts.push(String(article.year));
  }
  const header = parts.join(' -- ');
  const abstract = article.abstract ? truncate(article.abstract, DESCRIPTION_MAX_CHARS) : '';
  if (header && abstract) return `${header}\n\n${abstract}`;
  return header || abstract;
}

export async function GET() {
  const articles = await fetchAllArticles();

  const sorted = [...articles].sort((a, b) => {
    const da = a.dateAddedToLibrary;
    const db = b.dateAddedToLibrary;
    if (!da && !db) return 0;
    if (!da) return 1;
    if (!db) return -1;
    return dateCompareKey(b.dateAddedToLibrary) - dateCompareKey(a.dateAddedToLibrary);
  });

  const recent = sorted.slice(0, FEED_ITEM_LIMIT);

  const lastBuildDate =
    (recent.length > 0 && toUtcString(recent[0].dateAddedToLibrary)) ||
    new Date().toUTCString();

  const items = recent.map(article => {
    const url = new URL(`/library/${article.slug}/`, 'https://rrmacademy.org').href;
    const pubDate = toUtcString(article.dateAddedToLibrary);
    if (article.dateAddedToLibrary && !pubDate) {
      console.warn('[rss-library] Invalid dateAddedToLibrary for article', article.id, article.dateAddedToLibrary);
    }
    const description = buildDescription(article);

    return `    <item>
      <title><![CDATA[${escapeCdata(article.title)}]]></title>
      <link>${escapeXml(url)}</link>
      <guid isPermaLink="true">${escapeXml(url)}</guid>
      <description><![CDATA[${escapeCdata(description)}]]></description>
      ${pubDate ? `<pubDate>${pubDate}</pubDate>` : ''}
      ${article.authors ? `<dc:creator><![CDATA[${escapeCdata(article.authors)}]]></dc:creator>` : ''}
      ${article.domain ? `<category>${escapeXml(article.domain)}</category>` : ''}
    </item>`;
  });

  const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>RRM Academy Research Library</title>
    <link>https://rrmacademy.org/library/</link>
    <description>The latest additions to the RRM Academy Research Library: curated research on restorative reproductive medicine, NaProTechnology, fertility awareness-based methods, endometriosis, PCOS, and reproductive surgery.</description>
    <language>en-us</language>
    <lastBuildDate>${lastBuildDate}</lastBuildDate>
    <atom:link href="https://rrmacademy.org/library/rss.xml" rel="self" type="application/rss+xml" />
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
