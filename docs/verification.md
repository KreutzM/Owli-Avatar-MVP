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
- Browser: Gobkit-Eule mit Idle und simuliertem Schnabel, prozeduraler Fallback, Textchat, WebGL-Fallback, API-Fehler/Timeout. **Keine echte Sprachausgabe**. Siehe [Issue-3-Prüfbericht](verification-issue-3.md).

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

