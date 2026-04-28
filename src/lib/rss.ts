export function escapeCdata(str: string): string {
  return str.replace(/]]>/g, ']]]]><![CDATA[>');
}

export function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function toUtcString(value: string | undefined): string {
  if (!value) return '';
  const normalized = value.includes('T') ? value : value.replace(' ', 'T');
  const withZ = /[Zz]|[+\-]\d\d:?\d\d$/.test(normalized) ? normalized : normalized + 'Z';
  const d = new Date(withZ);
  return isNaN(d.getTime()) ? '' : d.toUTCString();
}

export function dateCompareKey(value: string | undefined): number {
  if (!value) return 0;
  const normalized = value.includes('T') ? value : value.replace(' ', 'T');
  const withZ = /[Zz]|[+\-]\d\d:?\d\d$/.test(normalized) ? normalized : normalized + 'Z';
  const d = new Date(withZ);
  const t = d.getTime();
  return isNaN(t) ? 0 : t;
}

export function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  const sliced = Array.from(str).slice(0, max).join('');
  return sliced.replace(/\s+\S*$/, '') + '…';
}
