# Codex-Workflow und Kontext-Hygiene

## Modellstrategie
- Hauptagent: `gpt-6.1-terra` / medium; verantwortlich fuer Sequenz, Architektur, Freigaben, Integration.
- Standard-Subagents: `gpt-6-luna` / low; Rollen `explorer` (low), `researcher` (medium), `builder` (medium), `reviewer` (high).
- Terra ist nicht automatisch staerker als jedes andere Modell bei umfassender Softwarearchitektur. Bei komplexen Entscheidungen schriftliche Annahmen, gezielte Tests und ggf. Modellvergleich statt unkritischem Vertrauen.
- Rollen/Modelle in der laufenden Codex-Session kontrollieren; keine stille Fallback-Auswahl bei einem nicht verfuegbaren Modell.

## Delegation
Nur delegieren, wenn eine begrenzte, unabhaengige Aufgabe das Kontextbudget schont. Maximal zwei aktive Subagents; vorzugsweise ein Builder und ein unabhaengiger, noch nicht reviewender Explorer/Researcher. Reviewer prueft erst einen stabilen Stand. Kleine sequentielle Tasks direkt erledigen.

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
Vor einem Review `bash scripts/preflight.sh` ausfuehren und den vollstaendigen
Ergebnisstatus sowie die getesteten Kommandos im Auftrag nennen. Einen festen
Base-/Head-SHA, den Blender-Pfad (`BLENDER_BIN`), Browser-Cache
(`PLAYWRIGHT_BROWSERS_PATH`) und gegebenenfalls den expliziten Browserpfad
(`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`) sowie relevante PATH-Ergaenzungen
weitergeben. Nur gesetzte Werte weitergeben; Pfade und Verfuegbarkeit in der
Sandbox des Reviewers erneut pruefen. Fehlende oder nicht startbare Werkzeuge
als ungetestet melden, nicht durch eine Versionsausgabe als Test ersetzen.
Playwright startet seine eigenen localhost-Testserver und bricht bei belegten
Ports ab; laufende Dienste nicht automatisch beenden.
