// Vorabcheck vor jedem Commit: Tests, Check und Datenschutz-Prüfung nacheinander.
// Aufruf: npm run vorab            (vor jedem Commit)
//         npm run vorab -- --browser (vor einem Release, zusätzlich der Browser-Durchlauf)
// Bewertet wird der Exit-Code jedes Schritts, nicht die Ausgabe. Nur wenn alle bestehen,
// steht am Ende die Zeile „VORABCHECK BESTANDEN“. Erst danach committen (Lesson X19 im Vault).
import { spawnSync } from 'node:child_process';

const steps = [['Tests', 'test'], ['Check', 'check'], ['Datenschutz', 'privacy']];
if (process.argv.includes('--browser')) steps.push(['Browser', 'test:browser']);

const results = [];
for (const [name, script] of steps) {
  console.log(`\n=== ${name} (npm run ${script}) ===`);
  const r = spawnSync(`npm run --silent ${script}`, { stdio: 'inherit', shell: true });
  results.push([name, r.status]);
}

console.log('\n=== Ergebnis ===');
for (const [name, status] of results) console.log(`${status === 0 ? 'ok    ' : 'FEHLER'} ${name}${status === 0 ? '' : ` (Exit ${status})`}`);
if (results.every(([, s]) => s === 0)) {
  console.log('VORABCHECK BESTANDEN');
} else {
  console.log('Vorabcheck NICHT bestanden – nicht committen.');
  process.exit(1);
}
