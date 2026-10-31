# Validierungsstatus und offene Checks

Dieser Bootstrap ist ein **Quellcode- und Mock-Startpunkt**, keine Live-Abnahme.

## Soll-Checks auf einem frischen Ubuntu-Checkout
- `python3 scripts/check_foundation.py`: Dateiexistenz, TOML-/JSON-Parsing, Modellkonfiguration und Python-Syntax.
- `bash -n scripts/bootstrap.sh scripts/run-dev.sh scripts/check.sh`: Shell-Syntax.
- `bash scripts/bootstrap.sh`: projektlokale virtuelle Umgebung + NPM-Installation (**mit Internet, ausdruecklicher manueller Ausfuehrung**).
- `bash scripts/check.sh`: Mock-API-Pytest und Web-Typecheck/Vite-Build.
- `bash scripts/run-dev.sh`: FastAPI localhost:8765 und Vite localhost:5173.
- Browser: Platzhalter 3D-Eule, textbasierter Mock-Chat, Status-/Fehlerzustaende; **kein echtes Model, kein echter Ton**.

## Vor Live- oder 3D-Abnahme
- Modellquelle, Lizenz und SHA nachweisen. Blender/GLB + Browser-Screenshots pruefen.
- Ollama / Piper / faster-whisper auf KI-Server separat freigeben und pruefen.
- Audio-Mikrofon und Browser HTTPS-Kontext testen.
- Latenz, WebGL-Leistung, Absturzverhalten, Unterbrechung und Ressourcen protokollieren.

## Bestehende Grenzen des Bootstraps
- `package-lock.json` noch nicht eingecheckt: beim ersten genehmigten `npm install` Lockdatei erstellen/pruefen/einchecken, dann CI auf `npm ci` umstellen.
- Keine `uv.lock`; Python-Abhaengigkeiten sind in `pyproject.toml` nach Versionsbereichen spezifiziert, noch nicht reproduzierbar gelockt.
- Der Mock-TTS/STT-Endpunkt meldet absichtlich HTTP 501. Der Mock-"speaking"-Zustand ist nur eine kurze **visuelle Simulation** und keine Sprach-/Lippensynchronisation.
- GitHub CI kann Offline-/Build-Pruefungen liefern, ist aber kein Beleg eines Serverdeployments.

