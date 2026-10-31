# Ubuntu KI-Server – Integrationsgrenzen

Bestands-Repo (privat, fuer berechtigte Nutzer): https://github.com/KreutzM/KI-Server

Laut dessen Dokumentationsstand Oktober 2026: Ubuntu 24.04 headless, Ryzen 5 5600G, 32 GB, Vega 7, Ollama lokal/Loopback, Blender 4.5.15 LTS headless, Node 24, Browser-/Playwright-Toolchain. Die tatsaechliche Verfuegbarkeit **bei Projektstart erneut lesend pruefen**; insbesondere keine RTX 3060 auf diesem Server voraussetzen. Ein experimenteller Qwen3-TTS-Aufbau ist dokumentiert, aber nicht als interaktiver Dienst freigegeben.

## Trennung
- Owli-Avatar-MVP verwaltet Quellcode, Mock-/Live-Adapter, Assets-Manifeste und Tests.
- KI-Server bleibt Autoritaet fuer Host-Konfiguration, Ollama, GPU, Dienstkonten, Firewall und systemd.
- Keine KI-Server-Pfade, Zugangsdaten, LAN-Adressen oder interne Messprotokolle in dieses oeffentliche Repo kopieren.
- Serverzugriff (falls notwendig) ueber die **bestehenden** sicheren Mechanismen aus KI-Server; keine neuen SSH-Schluessel erzeugen.

## Sicherer Ablauf
1. Lokal ohne Live-Provider entwickeln; CI verwendet ausschliesslich Mocks.
2. Read-only Pruefung auf KI-Server (Versionen, Ports, RAM/GPU, freie Ressourcen) und moegliche Konflikte.
3. Nur mit expliziter Genehmigung gezielte projektbezogene Dependencies installieren, Start/Stop und Konfig aendern; Rollback dokumentieren.
4. Ollama bleibt Loopback-only. FastAPI spricht auf dem Server direkt, Browser niemals direkt.
5. Mikrofon ueber LAN erfordert HTTPS/secure context; zunaechst localhost oder genehmigten Reverse Proxy.
6. Vor langfristigem Dienstbetrieb: Ressourcen-/Sicherheitslimits, Restart- und Logkonzept. Keine Secrets im Git.

## Performance
Browser-Hardware rendert GLB; serverseitige Vega 7 ist fuer LLM/TTS/STT relevant, nicht fuer Three.js im Browser. Qwen3-TTS bleibt spaetere Option; fuer niedrige Latenz Piper separat evaluieren, gemessene Werte statt Annahmen.

