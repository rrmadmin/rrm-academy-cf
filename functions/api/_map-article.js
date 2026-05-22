const SITE_BASE = 'https://rrmacademy.org';

export function mapArticle(a) {
  return {
    id: a.id,
    slug: a.slug,
    url: `${SITE_BASE}/library/${a.slug}/`,
    title: a.title,
    authors: a.authors,
    year: a.year,
    journal: a.journal,
    doi: a.doi,
    pmid: a.pmid,
    abstract: a.abstract,
    topics: Array.isArray(a.topics) ? a.topics : [],
    is_open_access: a.isOpenAccess === true,
    date_added: a.dateAddedToLibrary ? a.dateAddedToLibrary.slice(0, 10) : null,
  };
}
