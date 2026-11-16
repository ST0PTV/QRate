// Kalendereintrag als .ics-Datei: Termin am Erinnerungstag um 9 Uhr mit Alarm.
// Kein Server nötig; iOS bietet die Datei direkt zum Übernehmen in den Kalender an.
const pad = n => String(n).padStart(2, '0');
const stamp = d => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
// Kommas, Semikolons, Backslashes und Zeilenumbrüche nach RFC 5545 maskieren
const text = s => String(s ?? '').replace(/[\\;,]/g, c => '\\' + c).replace(/\r?\n/g, '\\n');

export function reminderIcs({ title, date, description, uid }) {
  const day = date.replaceAll('-', '');
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//QRate//Ausleihen//DE', 'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${uid}@qrate`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${day}T090000`,
    `DTEND:${day}T091500`,
    `SUMMARY:${text(title)}`,
    `DESCRIPTION:${text(description)}`,
    'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${text(title)}`, 'TRIGGER:PT0M', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR', ''
  ].join('\r\n');
}

export function downloadIcs(ics, filename = 'qrate-erinnerung.ics') {
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// Datum in n Tagen als YYYY-MM-DD (lokal)
export function inDays(n, from = new Date()) {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
