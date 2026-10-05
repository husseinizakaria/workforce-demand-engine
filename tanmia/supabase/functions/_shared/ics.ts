// RFC 5545 iCalendar builder: TEXT escaping, 75-octet line folding that never
// splits a UTF-8 sequence (Arabic text), CRLF line endings and UTC times.

export interface IcsEvent {
  uid: string;
  start: string | Date;
  end: string | Date;
  summary: string;
  description?: string | null;
  location?: string | null;
  url?: string | null;
  status?: 'CONFIRMED' | 'TENTATIVE' | 'CANCELLED';
  sequence?: number;
  lastModified?: string | Date | null;
  categories?: string[];
}

export function escapeText(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n');
}

/** 20261005T093000Z */
export function icsUtc(d: string | Date): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) throw new Error('invalid date for ICS');
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

const enc = new TextEncoder();

/** Folds a content line at 75 octets; continuation lines start with a single space. */
export function foldLine(line: string): string {
  if (enc.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = '';
  let currentBytes = 0;
  let limit = 75;
  for (const ch of line) { // iterates by code point
    const b = enc.encode(ch).length;
    if (currentBytes + b > limit) {
      parts.push(current);
      current = '';
      currentBytes = 0;
      limit = 74; // the leading space of a continuation line counts as one octet
    }
    current += ch;
    currentBytes += b;
  }
  if (current) parts.push(current);
  return parts.join('\r\n ');
}

function prop(name: string, value: string): string {
  return foldLine(`${name}:${value}`);
}

export function buildCalendar(opts: { name: string; events: IcsEvent[]; prodId?: string; now?: Date; refreshMinutes?: number }): string {
  const stamp = icsUtc(opts.now ?? new Date());
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    prop('PRODID', opts.prodId ?? '-//TANMIA//Program Platform//AR'),
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    prop('X-WR-CALNAME', escapeText(opts.name)),
    'X-WR-TIMEZONE:UTC',
  ];
  if (opts.refreshMinutes) {
    lines.push(`REFRESH-INTERVAL;VALUE=DURATION:PT${Math.max(15, Math.round(opts.refreshMinutes))}M`);
    lines.push(`X-PUBLISHED-TTL:PT${Math.max(15, Math.round(opts.refreshMinutes))}M`);
  }
  for (const e of opts.events) {
    lines.push('BEGIN:VEVENT');
    lines.push(prop('UID', e.uid));
    lines.push(`DTSTAMP:${stamp}`);
    lines.push(`DTSTART:${icsUtc(e.start)}`);
    lines.push(`DTEND:${icsUtc(e.end)}`);
    lines.push(prop('SUMMARY', escapeText(e.summary)));
    if (e.description) lines.push(prop('DESCRIPTION', escapeText(e.description)));
    if (e.location) lines.push(prop('LOCATION', escapeText(e.location)));
    if (e.url && /^https?:\/\//i.test(e.url)) lines.push(prop('URL', e.url));
    if (e.categories?.length) lines.push(prop('CATEGORIES', e.categories.map(escapeText).join(',')));
    lines.push(`STATUS:${e.status ?? 'CONFIRMED'}`);
    lines.push(`SEQUENCE:${Math.max(0, Math.floor(e.sequence ?? 0))}`);
    if (e.lastModified) lines.push(`LAST-MODIFIED:${icsUtc(e.lastModified)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

/** Session row → ICS event (shared by calendar-sync and calendar notifications). */
export function sessionToEvent(s: {
  id: string; code: string; title: string; starts_at: string; ends_at: string; status: string; location: string | null;
  meeting_url: string | null; agenda?: string | null; session_type?: string; delivery_mode?: string; updated_at?: string | null;
}, domain: string): IcsEvent {
  const desc = [
    `${s.code}`,
    s.agenda ? s.agenda : null,
    s.meeting_url ? `رابط الاجتماع / Meeting link: ${s.meeting_url}` : null,
  ].filter(Boolean).join('\n');
  const location = [s.location, s.delivery_mode === 'online' && !s.location ? 'Online' : null].filter(Boolean).join(' ') || null;
  const seq = s.updated_at ? Math.floor(new Date(s.updated_at).getTime() / 1000) % 2_000_000_000 : 0;
  return {
    uid: `${s.id}@${domain}`,
    start: s.starts_at,
    end: s.ends_at,
    summary: s.status === 'cancelled' ? `[ملغاة / Cancelled] ${s.title}` : s.title,
    description: desc,
    location,
    url: s.meeting_url,
    status: s.status === 'cancelled' ? 'CANCELLED' : s.status === 'draft' ? 'TENTATIVE' : 'CONFIRMED',
    sequence: seq,
    lastModified: s.updated_at ?? null,
    categories: s.session_type ? [s.session_type] : undefined,
  };
}
