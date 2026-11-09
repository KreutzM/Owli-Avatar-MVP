# Codex-Workflow und Kontext-Hygiene

## Ziel und Rollen
- **Externer Web-Chat-Planer** (Sol/high): Spezifikation, Architektur, Abhaengigkeiten und Akzeptanzkriterien der Issues. Kein automatischer Zugriff auf die lokale Codex-Session.
- **Terra** (`gpt-6.1-terra` / medium): schlanker Execution-Koordinator fuer **ein freigegebenes Issue**: aufteilen, integrieren, pruefen, PR/Handoff. Keine erneute Gesamtplanung und keine selbst erfundenen Features.
- **Luna**: `builder` / medium implementiert; `explorer` / low kartiert nur benoetigte Pfade; `researcher` / medium prueft konkrete Quellenfragen; `reviewer` / high findet unabhaengig Maengel eines fixierten Diffs. Die TOML-Rollen ueberschreiben den Default-Subagent-Effort.
- Optimiert wird **Verbrauch pro akzeptiertem, gleichwertigem Issue**, vor allem eingesparte Terra-Arbeit; nicht die reine Zahl an Luna-Aufrufen. Luna-Agents nur starten, wenn sie Terra-Arbeit ersetzen oder unabhaengige Qualitaet beisteuern. Kein unbelegtes Einsparversprechen.

## Autonomer Einzelissue-Lauf
1. Ein Auftrag enthaelt Issue-ID, freigegebenen Plan/Version, aktuelles Base-SHA, Scope/No-go, Akzeptanzkriterien, relevante Dateien/Vertraege, Tests und spaetere reale Abnahme. Nur relevante Dokumente lesen, keine komplette Chat-/Repository-Historie.
2. Innerhalb dieses Mandats **ohne Zwischenfragen** implementieren, delegieren, fokussiert testen, unabhaengigen Review einholen, Findings selbst beurteilen, berechtigte Korrekturen ausfuehren und moeglichst einen Draft-PR erstellen. Interne Phasen-/Verbrauchscheckpoints sind keine Nutzerfreigaben.
3. `sandbox_mode = "workspace-write"` und projektlokales `approval_policy = "never"` erlauben keine Eskalation ueber die Sandbox. Geschuetzte Git-/Codex-Pfade, Netzwerk- oder externe Aktionen koennen scheitern. Keine `--yolo`, `danger-full-access`, globalen Freigabeaenderungen oder Umgehungen. Wenn eine notwendige Aktion nicht erlaubt ist: restliche sichere Arbeit abschliessen, einmaligen `blocked/partial`-Handoff liefern, **nicht** um wiederholte Freigabe bitten.
4. Genehmigte Routineentscheidungen liegen bei Terra. Bei Architektur-, API-Vertrags-, Feature- oder Scope-Konflikten nichts eigenmaechtig umplanen: den Konflikt dokumentieren und dem externen Planer/Nutzer **im Endbericht** zur Entscheidung geben. Kein eigenstaendiger Epic-Dauerlauf ueber #24–#30.
5. Automatisches Merge, Deployment, Host-/Service-Eingriffe und naechste Issues bleiben ausserhalb eines einzelnen Auftrags. Dazu ist eine separate Nutzerfreigabe erforderlich.

## Delegation und Isolation
- Maximal **zwei offene Subagent-Threads** (technisches Parallelitaetslimit, kein Token-/Kontingentbudget); beide Slots nutzen, wenn tatsaechlich unabhaengige Luna-Arbeit Terra entlastet. Kein Pflicht-Spawn und keine rekursive Delegation.
- Explorer/Researcher: nur erforderliche Pfade/Quellen und Belege; Builder: klar zugewiesener Dateibereich plus unmittelbar notwendige Tests; Reviewer: Bericht, kein Edit. Ein Prompt mit `read-only` ist **keine technische Schreibsperre**, da Custom Agents die Sandbox des Hauptagenten erben; fuer erzwungene Read-only-Isolation ggf. eigene Read-only-Session verwenden.
- Keine ueberlappenden Schreibbereiche. Parallele Builder nur mit disjunkten Worktrees/Dateien und getrennten Temp-/Build-/Cachepfaden. Keine fremden Prozesse beenden, Dependencies installieren, Lockfiles ohne Scope aendern oder fremde Aenderungen resetten; ungeplante Konflikte melden.
- Jeder Auftrag: Ziel, Base-SHA, Ownership, erlaubte Tests/Tools, Ausschluesse, Stopkriterien. Ergebnis **maximal ca. 12 Zeilen** mit Artefakten, Belegen, Tests, Unsicherheit. Terra kontrolliert nur entscheidende Diffs/Integrationsstellen, statt alle Daten doppelt zu lesen.

## Tests und unabhaengiger, beratender Review
- Testtrichter: kleinster aussagekraeftiger Test nach Aenderung; betroffene Modul-/Browser-Regressionen; kompletter Preflight/CI auf finalem Head. Volltests auf **unveraendertem** SHA nicht grundlos wiederholen. Nicht durch Testeinsparung Sicherheits-/Funktions-Gates umgehen.
- Nach reviewfaehigem Builder-Commit Base-/Head-SHA fixieren. Luna-Reviewer bekommt genehmigtes Issue, Diff, relevante Vertraege, ausgefuehrte Tests und Artefakte; es prueft **nur belegte Fehler, Sicherheits-/Lizenzrisiken, Regressionen und notwendige Pflichttestluecken im Scope**.
- Reviewer darf **keine** neuen Features, nicht angeforderte Refactorings, Aesthetik-Wuensche, Architekturwechsel, neue Akzeptanzkriterien oder zusaetzliche Reviewrunden **fordern**. Auch konkrete Maengel sind **Hinweise**, keine bindenden Arbeitsauftraege.
- Terra triagiert relevante Findings mit Beleg als **fix / reject / defer / blocked** und entscheidet ueber die minimale In-Scope-Korrektur. Kein Review-Finding allein erzwingt Reparatur; allerdings verhindern tatsaechlich unerfuellte Issue-Pflichten, Sicherheits- oder Lizenzprobleme die Deklaration `ready`. Ein solcher PR bleibt Draft/blocked und wird ehrlich dokumentiert.
- Standard ist **ein** unabhaengiger Review. Gezielter erneuter Review nur bei wesentlichem Fix nach Terras Entscheidung; hoechstens drei dokumentierte Reviewdurchlaeufe als Obergrenze, **kein** Pflichtziel und keine Reviewer-gesteuerte Endlosschleife. Fehlende Live-/visuelle Abnahmen als `pending`, nicht als CI-Erfolg interpretieren.
- Merge ausschliesslich nach separater Nutzerfreigabe; keine automatische Bereitstellung.

## Kontext-Hygiene, Handoff und Messung
- Gezielt `rg`/Dateien und relevante Docs statt Whole-Repo-Dumps lesen; bekannte Pfade/Tests aus Issue/Builder-Handoff verwenden, nicht mit Terra nochmals alles rekonstruieren.
- Nach grosser Phase oder Unterbrechung kompakte Uebergabe: Issue, Base/Head-SHA, geaenderte Pfade, ausgefuehrte Checks, Review-Triage, offene Akzeptanz und naechster Schritt. Bei sehr langen Sitzungen mit dieser Uebergabe neu beginnen, wenn eine frische Session sinnvoll ist; keine behaupteten Cache-Vorteile ohne Daten.
- Nach Explore/Build/Review verfuegbare `/status`-/Usage-Information intern ansehen. **Organisatorische** Checkpoints sind keine automatische 5h-Sperre; ein ggf. verfuegbares Goal-Tokenbudget gilt nur fuer Goals, nicht fuer alle Codex-Sessions. Bei Kontingentende oder irreparabler Blockade sicheren Stand plus Handoff schreiben; keine Rueckfrage-Dauerschleife.
- Pilot **nach diesem Config-/Doku-PR**: zuerst kleines #25, dann getrennt komplexes #24 oder #28/#29. Pro Issue nur vorhandene, zulassige aggregierte Daten lokal dokumentieren: Codex-Version/Auth, Modell/Effort, Zeit/Usage-Messgrenzen, Anzahl/Art Luna-Auftraege, ersetzte Terra-Arbeit, Neulesen, Checks/Review-/Repair-Runden, Ergebnis, reale Abnahme. Fruehere 1,5h-Nutzung ohne Attribution bleibt `Ursache nicht messbar`. Kein Doppelimplementieren nur fuer A/B und keine Einsparquoten aus unterschiedlichen 5h-Fenstern.
- Sieben Teilissues des Epics #23 sind separat zu implementieren/integrieren (je Branch/PR/Review/Entscheid auf aktuellem main); erst danach gemeinsames API-/Mock-/Browser- und Windows-HTTPS-/Audio-/Avatar-Integrationsgate. #22 bleibt unabhaengig priorisiert.

## Startpruefung auf Ubuntu (muss lokal erfolgen)
- `codex --version`, `codex --help`, `codex --strict-config` **nur sofern angeboten**.
- Frische vertrauenswuerdige Projekt-Session: `/model`, `/status`, `/permissions`, `/subagents`, `/debug-config` nur soweit verfuegbar; tatsaechlich geladene Projekt-Config, Modell-/Effort-Stufen, Sandbox und Approval-Policy pruefen. CLI-Flag-/Global-Overrides und verwaltete Policies koennen Vorrang haben; keine stillen Fallbacks.
- Sicherer, begrenzter Testlauf ohne Zwischenfreigabe mit normalem Datei-Edit, fokussiertem Test und optionaler Draft-PR-Vorbereitung. Wenn `approval_policy = "never"` fuer eine notwendige Aktion keine Berechtigung bereitstellt, **nicht** Full Access einschalten. Unterschied zwischen technisch moeglichen Schritten und offline/unklaren Checks berichten.
- **Hier** ueber GitHub-Connector koennen nur Repository-Dateien und PR-Zustand kontrolliert werden; dadurch wird weder die installierte Ubuntu-Codex-Version noch die echte Kontingentwirkung lokal validiert.

Quellen: https://developers.openai.com/codex/config-reference ; https://developers.openai.com/codex/subagents ; https://learn.chatgpt.com/docs/sandboxing

## Werkzeug-Handoff fuer Reviews
Review-Auftrag fixiert Base- und Head-SHA (bei uncommitteten Prototypen einen explizit fixierten Snapshot) sowie den vollstaendigen Ergebnisstatus
von `bash scripts/preflight.sh` und die tatsaechlich getesteten Kommandos. Bei
visuellen Aenderungen gehoeren vollstaendige, unveraenderte Bild- und
Videoartefakte samt Speicherorten dazu; Quellen/Nachweise (z.B. Logs,
Screenshots, Testausgaben und verwendete Asset-Referenzen) sind eindeutig
zugeordnet. Reviewer prueft genau diesen Stand und meldet nicht verfuegbare
Artefakte oder Werkzeuge als ungetestet. Befunde unterscheiden selbst Geprueftes, von Terra Berichtetes und Ungeprueftes. Nach wesentlichen Aenderungen nur auf Terras Entscheidung einen neuen fixierten Stand reviewen; drei Durchlaeufe sind eine Obergrenze, keine Pflicht. Einen festen Blender-Pfad (`BLENDER_BIN`), Browser-Cache
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

Reviewer: „Unabhaengiger, nur beratender Read-only Review von Base … bis Head …; Scope …; pruefe Diff und
Nachweise unter …, einschliesslich vollstaendigem Video und allen Bildern;
fuehre … aus. Keine Aenderungen. Rueckgabe: Findings nach Schweregrad mit
Datei/Beleg, Checks, ungesehenen Artefakten und Unsicherheit (max. 12 Zeilen).“

