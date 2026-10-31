# Validierungsstatus und offene Checks

Dieser Bootstrap ist ein **Mock-Startpunkt**, keine Live-TTS-/LLM-/STT-Abnahme.

## Soll-Checks auf einem frischen Ubuntu-Checkout
- `python3 scripts/check_foundation.py`: Dateiexistenz, TOML/JSON, Modellkonfiguration, Python-Syntax.
- `bash -n scripts/bootstrap.sh scripts/run-dev.sh scripts/check.sh`: Shell-Syntax.
- Voraussetzungen: Node.js 22+ und Python 3.12+; `uv==0.9.17` als vorhandenes lokales Tool (separat installieren, falls noetig).
- `bash scripts/bootstrap.sh`: `uv sync --frozen` und `npm ci` mit versionierten Lockfiles. Netz fuer den ersten Download benoetigt; nur lokale Projektpakete.
- `bash scripts/check.sh`: Foundation, API-Pytest und Web-Typecheck/Vite-Build.
- `bash scripts/run-dev.sh`: Mock-FastAPI localhost:8765 und Vite localhost:5173.
- `npx playwright install chromium` aus `apps/web` nur falls Browser nicht vorhanden; `bash scripts/check.sh --browser` fuehrt zusaetzliche Browser-Smokes aus. Diese starten Mock-API und Vite lokal.
- Browser: prozedurale Platzhalter-Eule, Textchat, WebGL-Fallback, API-Fehler/Timeout. **Kein importiertes Rig, keine echte Sprachausgabe**.

## CI
GitHub Actions prueft Foundation, Mock-API, Web-Build und Chromium-Playwright. Die CI benutzt **ausschliesslich Mocks** und kontaktiert KI-Server/Ollama nicht. Ein CI-Erfolg beweist weder Qualitaet realer 3D-Assets noch Latenz/Audio auf dem Ubuntu-Rechner.

## Vor Live- oder 3D-Abnahme
- Originalmodell, Lizenz und SHA pruefen. Blender/GLB und visuelle Three.js-Screenshots kontrollieren.
- Ollama / Piper / faster-whisper auf KI-Server separat freigeben und testen.
- Mikrofon und Browser-Secure-Context testen.
- Latenz, WebGL-Performance, Unterbrechungen, Browser-Geraeteabdeckung und Ressourcennutzung messen.

## Technische Grenzen
- Node-Lockfile: `apps/web/package-lock.json`; Python-Lockfile: `apps/api/uv.lock`. Beide werden nur nach expliziter Versionsentscheidung aktualisiert.
- TTS-/STT-Endpunkte melden absichtlich HTTP 501. Der Mock-"speaking"-Zustand ist eine **visuelle Simulation**, keine Audio-Synchronisation.
- Browser-Smoke deckt Standard-Canvas, deaktiviertes WebGL, HTTP-503-Fehler und einen abgebrochenen/langsamen Mock-Request ab. Er ersetzt keinen manuellen WebGL-Sichttest auf einem Zielgeraet.


## Entwicklungsumgebung und Sandbox (2026-10-31)

Die systemseitige Bubblewrap-Installation und das gezielte Ubuntu-AppArmor-Profil
wurden vor dieser Arbeit repariert. Der Nutzer meldete `codex sandbox -- /bin/true`
und `codex sandbox -- /bin/sh -c 'id; pwd'` jeweils mit Exit-Code 0. In dieser
Session liefen `id && pwd` sowohl beim Hauptagenten als auch beim Luna-Subagenten
in ihrer jeweiligen Sandbox mit Exit-Code 0. Die Projektkonfiguration setzt
`gpt-6.1-terra`/medium, `workspace-write`, `on-request` und Netzwerkzugriff;
die aktive Hauptmodellidentitaet ist hier nicht unabhaengig auslesbar.
Die bestehenden Grenzen fuer Deployments, Systemaenderungen, KI-Server und
Netzwerkdienste aus AGENTS.md bleiben unveraendert.

`bash scripts/preflight.sh` prueft ohne Installation die Werkzeuge einschliesslich
Blender-Headless und eines echten Playwright-Chromium-Starts. Ein Fehler ergibt
Exit-Code 1; alle Checks laufen trotzdem. Optional `BLENDER_BIN`,
`PLAYWRIGHT_BROWSERS_PATH` und `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` setzen.
Ein expliziter Browserpfad kann von der durch Playwright vorgesehenen Version
abweichen; Testergebnis und Version deshalb dokumentieren. Der Sandbox-Preflight
kann wegen Sandbox-Beschraenkungen fehlschlagen, selbst wenn ein Werkzeug
außerhalb funktioniert. Playwright startet seine Testserver selbst und bricht bei
bereits belegten Ports ab, statt fremde Server wiederzuverwenden.

### Ergebnis auf dem Entwicklungsrechner

`uv 0.9.17` wurde in einer benutzereigenen virtuellen Umgebung unter
`~/.local/share/owli-devtools/uv-0.9.17/bin` installiert; dieser Pfad muss fuer
Bootstrap/Preflight im `PATH` stehen. Playwright 1.55.0 installierte Chromium
140.0.7339.16 (Build 1187) nach `~/.cache/ms-playwright`. Der lokale Node-Wrapper
verwendet sonst einen anderen Cache; fuer diesen Test wurde
`PLAYWRIGHT_BROWSERS_PATH="$HOME/.cache/ms-playwright"` explizit gesetzt.

Mit diesen Einstellungen meldete der Preflight in der Codex-Sandbox alle Checks
bis auf Chromium erfolgreich (Python 3.12.3, API-Python 3.14.7, Node 24.22.0,
npm 11.19.1, Git 2.43.0, Blender 4.5.15 LTS headless). Chromium scheiterte mit
`shutdown: Operation not permitted`. Ein minimaler Python-Test mit
`socket.socketpair()` und `shutdown(SHUT_WR)` scheiterte ebenfalls mit `EPERM`;
`/proc/self/status` zeigte einen aktiven Seccomp-Filter. Die konkrete Filterregel
wurde nicht ausgelesen, `strace` war durch verweigertes `ptrace` nicht nutzbar.
Außerhalb der Codex-Sandbox funktionierten derselbe Socket-Test und der komplette
Preflight; der passende Chromium startete. Die eng begrenzte lokale Ausfuehrung
von `bash scripts/check.sh --browser` bestand mit 5 API- und 4 Browser-Tests
sowie Web-Build. Playwright startet Chromium standardmaessig mit `--no-sandbox`;
es wurde keine dauerhafte oder globale Sicherheitskonfiguration geaendert.
GitHub-CI bleibt der unabhaengige Browser-Test. Keine dieser Pruefungen ist eine
Live-LLM-/TTS-/STT-Abnahme.
