#!/bin/sh
# Scannt das Repo vor einem Push nach persönlichen Strings.
# 1) Generische Muster: E-Mail-Adressen, Telefonnummern, Backup-Dateien.
# 2) Eigene Begriffe (Namen, Orte, ...) in .privacy-terms.local, ein Begriff pro Zeile.
# vendor/ ist ausgenommen: dort liegen nur unveränderte Fremdbibliotheken. Adressen @example.org sind Testdaten.
# Übernommen aus The Tracker (ST0PTV, MIT).
#    Diese Datei ist per .gitignore ausgeschlossen und gehört nie ins Repo.
cd "$(dirname "$0")/.." || exit 2
status=0
FILES=$(find . -type f \
  -not -path './.git/*' -not -path './node_modules/*' -not -path './icons/*' -not -path './vendor/*' \
  -not -name '.privacy-terms.local' -not -name 'privacy-scan.sh')

echo "== Backup-Dateien =="
found=$(find . -type f -name '*backup*.json' -not -path './.git/*' -not -path './node_modules/*')
if [ -n "$found" ]; then echo "$found"; status=1; else echo "keine"; fi

echo "== E-Mail-Adressen =="
hits=$(echo "$FILES" | xargs grep -nEI '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' 2>/dev/null | grep -v 'noreply' | grep -vE '@example.(org|com)')
if [ -n "$hits" ]; then echo "$hits"; status=1; else echo "keine"; fi

echo "== Telefonnummern =="
# Zeilen mit DOIs (10.xxxx/...) und das Code-Alphabet ausnehmen, sonst Fehlalarme
hits=$(echo "$FILES" | xargs grep -nEI '(\+49|0049|\b0[1-9][0-9]{2,4}[ /-]?[0-9]{5,9})' 2>/dev/null | grep -vE '10\.[0-9]{4,5}/|0123456789ABCDEFGHJKMNPQRSTVWXYZ')
if [ -n "$hits" ]; then echo "$hits"; status=1; else echo "keine"; fi

echo "== Eigene Begriffe (.privacy-terms.local) =="
if [ -f .privacy-terms.local ]; then
  hits=$(echo "$FILES" | xargs grep -nIiF -f .privacy-terms.local 2>/dev/null)
  if [ -n "$hits" ]; then echo "$hits"; status=1; else echo "keine"; fi
else
  echo "Datei fehlt: lege .privacy-terms.local mit Namen/Orten an (ein Begriff pro Zeile)."
  status=3
fi

[ "$status" -eq 0 ] && echo "OK: nichts gefunden." || echo "Prüfung nicht sauber (Status $status)."
exit $status
