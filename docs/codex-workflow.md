# Codex-Workflow und Kontext-Hygiene

## Modellstrategie
- Hauptagent: `gpt-6.1-terra` / medium; verantwortlich fuer Sequenz, Architektur, Freigaben, Integration.
- Standard-Subagents: `gpt-6-luna` / low; Rollen `explorer` (low), `researcher` (medium), `builder` (medium), `reviewer` (high).
- Terra ist nicht automatisch staerker als jedes andere Modell bei umfassender Softwarearchitektur. Bei komplexen Entscheidungen schriftliche Annahmen, gezielte Tests und ggf. Modellvergleich statt unkritischem Vertrauen.
- Rollen/Modelle in der laufenden Codex-Session kontrollieren; keine stille Fallback-Auswahl bei einem nicht verfuegbaren Modell.

## Delegation
Nur delegieren, wenn eine begrenzte, unabhaengige Aufgabe das Kontextbudget schont. Maximal zwei aktive Subagents; vorzugsweise ein Builder und ein unabhaengiger, noch nicht reviewender Explorer/Researcher. Reviewer prueft erst einen stabilen Stand. Kleine sequentielle Tasks direkt erledigen.

### Verbindliche Rollen und Grenzen
- `explorer` und `researcher` sind read-only: sie liefern Befunde bzw. Quellen, aendern keine Dateien.
- `builder` schreibt nur in den ausdruecklich zugewiesenen Dateien/Bereich und ergaenzt nur direkt zugehoerige Tests. Keine Architektur- oder gemeinsamen Vertragsaenderungen ohne Entscheidung des Terra-Koordinators.
- `reviewer` ist read-only und prueft einen fixierten Stand unabhaengig; Findings werden an Terra zurueckgegeben, nicht selbst eingearbeitet.
- Terra verantwortet Aufgabenverteilung, Architekturentscheidungen, Integration, Freigaben und Abschlusspruefung. Rollen oder explizite Dateieigentuemerschaft muessen im Auftrag stehen.
- Auftrag stets auf konkreten Issue/Frage, erwartetes Ergebnis und kleinsten benoetigten Kontext begrenzen. Maximal zwei Subagents insgesamt; keine rekursive Delegation. Bei unklarer Ownership, ueberschneidenden Schreibbereichen oder unerwarteten fremden Aenderungen in zugewiesenen Dateien stoppen und Terra informieren.
- Isolation: parallele Builder erhalten disjunkte Schreibbereiche bzw. getrennte Worktrees. Ownership umfasst auch temporaere Symlinks, `node_modules`, virtuelle Environments, Browser-Caches, Renderartefakte und Build-Verzeichnisse. Cleanup nur im eigenen Bereich; gemeinsame Ressourcen verwaltet Terra. Keine gemeinsamen Dependencies veraendern oder fremde Prozesse ohne ausdrueckliche Freigabe beenden. Keine fremden Aenderungen zuruecksetzen. Vor Integration `git status`, `git diff` und tatsaechliche Artefaktpfade pruefen. Keine Dependencies installieren/aktualisieren, Lockfiles oder Umgebung ausserhalb des zugewiesenen Scopes aendern; wenn eine Abhaengigkeit noetig scheint, an Terra melden.

Auftrag an Subagent:
1. Ziel / Issue / konkrete Frage und erwartete Abnahme.
2. Start-SHA und relevante Dateien/Abschnitte; **kein kompletter Chat-Verlauf**.
3. Erlaubte Dateiaenderungen, Tests und No-go-Bereiche.
4. Rolle / Modell / Reasoning; moeglichst frischer Kontext, falls von CLI unterstuetzt.
5. Rueckgabe max. 12 Zeilen: Befund, Beleg, Tests, Unsicherheit, naechster Schritt.

Hauptagent verarbeitet nur entscheidungsrelevante Ergebnisse und prueft die tatsaechlichen Artefakte/Diffs. Keine gemeinsamen Schreibbereiche paralleler Agenten; bei Bedarf getrennte Git-Worktrees. Subagents geben keine Serverfreigaben weiter.

## PR- und Review-Schleife
- Arbeit in `feature/*` oder `chore/*`; `main` bleibt Integrationszweig.
- Ein PR enthaelt Ziel, Akzeptanzkriterien, betroffene Dateien, Testbelege, Lizenzen, offene Live-Pruefungen.
- Nach Builder-Commit den SHA fixieren und Luna-Reviewer gegen diesen Stand einsetzen.
- Blockierende Findings (P0/P1, funktionsrelevante P2, fehlende Pflichttests) beheben und erneut pruefen.
- Maximal drei **dokumentierte** Reviewdurchlaeufe je PR; danach eskalieren, nicht durch Agentenwechsel zuruecksetzen.
- Kein automatischer Merge und keine automatische Bereitstellung. Merge nur nach expliziter Entscheidung des Hauptagenten im Rahmen der Nutzerfreigabe.
- Code- und Mock-Abnahme sind strikt von Live-Integration (Server), visueller Eule und Mikrofonabnahme zu trennen.

## Wiederaufnahme
`docs/roadmap.md` als stabile Quelle fuer kommende Aufgaben. Bei laengeren PRs nur knappen Status im PR halten: Scope, Base/Head, Findings 0–3, Checks, noch offene reale Abnahmen. Agenten sollen nur notwendige Dateien lesen, statt gesamte Statushistorie bei jeder Aufgabe zu laden.

## Startpruefung auf Ubuntu
`codex --version`; `codex --strict-config` (sofern von installierter CLI unterstuetzt). Neue Session starten und `/model`, `/status`, `/permissions` kontrollieren. Verfuegbarkeit von Terra, Luna und benutzerdefinierten Rollen belegen; bei nicht unterstuetztem Setup offen anhalten statt automatisch auf teurere Modelle umzuschalten.

Quellen: https://developers.openai.com/codex/subagents und https://developers.openai.com/codex/config-reference


## Werkzeug-Handoff fuer Reviews
Review-Auftrag fixiert Base- und Head-SHA (bei uncommitteten Prototypen einen explizit fixierten Snapshot) sowie den vollstaendigen Ergebnisstatus
von `bash scripts/preflight.sh` und die tatsaechlich getesteten Kommandos. Bei
visuellen Aenderungen gehoeren vollstaendige, unveraenderte Bild- und
Videoartefakte samt Speicherorten dazu; Quellen/Nachweise (z.B. Logs,
Screenshots, Testausgaben und verwendete Asset-Referenzen) sind eindeutig
zugeordnet. Reviewer prueft genau diesen Stand und meldet nicht verfuegbare
Artefakte oder Werkzeuge als ungetestet. Befunde unterscheiden selbst Geprueftes, von Terra Berichtetes und Ungeprueftes. Nach Aenderungen nur einen neu fixierten Stand reviewen; die Grenze von drei Durchlaeufen bleibt bestehen. Einen festen Blender-Pfad (`BLENDER_BIN`), Browser-Cache
(`PLAYWRIGHT_BROWSERS_PATH`) und gegebenenfalls den expliziten Browserpfad
(`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`) sowie relevante PATH-Ergaenzungen
weitergeben. Nur gesetzte Werte weitergeben; Pfade und Verfuegbarkeit in der
Sandbox des Reviewers erneut pruefen. Fehlende oder nicht startbare Werkzeuge
als ungetestet melden, nicht durch eine Versionsausgabe als Test ersetzen.
Playwright startet seine eigenen localhost-Testserver und bricht bei belegten
Ports ab; laufende Dienste nicht automatisch beenden.

### Visuelles Abnahme-Gate
Visuelle Kriterien vor der Umsetzung festlegen und weitergeben. Fuer nicht
freigegebene Prototypen technische Kriterien (Geometrie, Kontinuitaet,
Durchdringungen, Uebergaenge, Wiederholbarkeit) und Gestaltung in realer
UI-Groesse getrennt beurteilen. Terra sieht selbst Einzelbilder und die gesamte
bewegte Sequenz; der Reviewer prueft den fixierten Stand unabhaengig. Tests,
Metadaten und einzelne Frames ersetzen keine Sichtung. Artefakte, Ergebnisse,
menschliche Freigabe und bewusst akzeptierte Einschraenkungen dokumentieren;
eine LLM-Bewertung ersetzt die menschliche Freigabe nicht. Die verworfenen
V2–V4-Schnabelkriterien gelten nur fuer diese Prototypen, nicht fuer das bereits
freigegebene Vuena-Original.

### Auftragsbeispiele
Builder: „Issue N; Start-SHA …; Ownership: `src/foo.ts` und direkt zugehoeriger
Test; Verhalten …; keine weiteren Dateien/Dependencies; pruefe …; stoppe bei
unklarer Ownership oder fremden Aenderungen. Rueckgabe: Pfade, Verhalten,
Kommandos/Ergebnisse, Risiken (max. 12 Zeilen).“

Reviewer: „Read-only Review von Base … bis Head …; Scope …; pruefe Diff und
Nachweise unter …, einschliesslich vollstaendigem Video und allen Bildern;
fuehre … aus. Keine Aenderungen. Rueckgabe: Findings nach Schweregrad mit
Datei/Beleg, Checks, ungesehenen Artefakten und Unsicherheit (max. 12 Zeilen).“
