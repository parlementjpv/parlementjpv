import type { APIRoute } from 'astro';
import data from '../data/events.json';

const ics = (d: string) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const esc = (s: string) => s.replace(/[\;,]/g, (c) => '\\' + c);

export const GET: APIRoute = () => {
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Parlement JPV//Agenda//FR', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Parlement JPV',
    ...data.events.flatMap((e, i) => [
      'BEGIN:VEVENT',
      `UID:jpv-${i}-${ics(e.start)}@parlementjpv`,
      `DTSTAMP:${ics(new Date().toISOString())}`,
      `DTSTART:${ics(e.start)}`,
      `DTEND:${ics(e.end || e.start)}`,
      `SUMMARY:${esc(`[${e.type}] ${e.title}`)}`,
      `LOCATION:${esc(e.location)}`,
      'END:VEVENT',
    ]),
    'END:VCALENDAR',
  ];
  return new Response(lines.join('\r\n'), { headers: { 'Content-Type': 'text/calendar; charset=utf-8' } });
};
