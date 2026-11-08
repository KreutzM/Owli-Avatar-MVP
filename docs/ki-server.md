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


## Projektbezogener Start und Stop

Voraussetzungen sind die bereits vorhandene API-Umgebung und Web-Abhaengigkeiten
(siehe `scripts/bootstrap.sh`; Installation und Downloads nur nach Freigabe).
Das Skript liest keine `.env` automatisch. Es startet weder Ollama noch Piper
und installiert oder laedt keine Modelle. Fuer einen Mock-Start:

```sh
OWLI_MODE=mock OWLI_TTS_MODE=off OWLI_STT_MODE=off bash scripts/run-dev.sh
```

Fuer den Live-Betrieb vorhandenes Ollama und einen separat gestarteten
Piper-HTTP-Provider voraussetzen. In derselben Shell explizit konfigurieren:

```sh
export OWLI_MODE=ollama OLLAMA_MODEL='<vorhandenes Modell>' OLLAMA_THINK=false
export OLLAMA_BASE_URL=http://127.0.0.1:11434
export OWLI_TTS_MODE=piper PIPER_BASE_URL=http://127.0.0.1:5000
export OWLI_STT_MODE=faster-whisper STT_MODEL_PATH='<absolutes lokales Modellverzeichnis>'
bash scripts/run-dev.sh
```

STT braucht die zusaetzlich installierten Python-Pakete faster-whisper und
PyAV und die drei in README beschriebenen Modelldateien. Ein Modell unter
`/tmp` kann beim Neustart oder durch das Betriebssystem entfernt werden;
einen dauerhaften privaten Speicherort und freien Platz vorab selbst pruefen.
Keine Gewichte, Stimmen oder lokalen Pfade ins Git aufnehmen.

Das Skript prueft Modi, lokale Origins, Modelldateien und bindbare Ports 8765
und 5173 sowie STT-Imports, den Ollama-Modellkatalog und die TCP-Erreichbarkeit von Piper. Die Portpruefung ist keine Reservierung; bei einem Startkonflikt
bricht der jeweilige Prozess ab. Sie prueft weder eine Piper-Synthese noch die Rechte externer Modelle oder Stimmen. API und Vite laufen auf Loopback.
Im Terminal Ctrl-C beendet die vom Skript gestarteten Prozesse. Bereits
laufende Piper- und Ollama-Dienste werden nicht beendet. Ausgaben verbleiben
im Terminal; private Eingaben und Aufnahmen nicht in Betriebsprotokolle kopieren.
Ein Absturz oder SIGKILL kann eine manuelle Pruefung erfordern: nur eindeutig
diesem Start zugeordnete Prozesse beenden, niemals pauschal nach Namen.

Bei Fehlern zuerst Konfiguration, Modelldateien, Paketverfuegbarkeit und
Portbelegung pruefen; belegte Ports nicht durch Beenden fremder Prozesse
freimachen. Ein erfolgreicher Preflight belegt keine Inferenz oder Tonwiedergabe.

## Windows und geplanter HTTPS-LAN-Test

Der funktional abgenommene Weg bleibt ein bestehender SSH-Localhost-Tunnel
vom Windows-Rechner zum Loopback-Webport 5173; der Windows-Browser oeffnet
`http://localhost:5173`. Vite leitet `/api` auf die Loopback-API weiter.
SSH-Einstellungen und Zugangsdaten stammen aus der bestehenden privaten
Host-Dokumentation. Browser-Mikrofonzugriff braucht eine Nutzerfreigabe und
einen sicheren Kontext; localhost erfuellt diese Bedingung.

Ein direkter Zugang ist noch nicht eingerichtet oder getestet. Vorschlag:
temporarer Reverse-Proxy auf einer ausgewaehlten privaten LAN-Schnittstelle
und einem unprivilegierten Port, Weiterleitung nur an Vite auf Loopback,
Client-IP eingeschraenkt, ohne Routerfreigabe. Ein lokal erzeugtes Zertifikat
muss zum verwendeten Namen oder zur Adresse passen und auf dem Windows-Client
gezielt vertraut werden. TLS schuetzt den Transport; IP-Filter sind keine
starke Client-Authentifizierung. Ohne weitere Authentifizierung ist ein
vertrauenswuerdiges Heimnetz erforderlich. Zertifikatsschluessel privat halten.
Nach dem Test Proxy beenden und das gezielt installierte Vertrauen sowie die
Testschluessel entfernen. Konkrete Software, Bindung und Zertifikatsverfahren
sind vor Ausfuehrung zu pruefen; LAN-Listener und Windows-Zertifikatsspeicher
erfordern gesonderte Freigabe. Firewall, DNS, SSH und systemd bleiben unveraendert.
Die tatsaechliche Zertifikatspruefung, `window.isSecureContext` und
Mikrofonfreigabe auf Windows sind noch nicht nachgewiesen.

## Messstand

Fuer Phase 6 liegen in diesem Stand keine neuen Messungen von STT, Ollama,
Piper, Browser-Wiedergabestart, Gesamtantwortlatenz, CPU, Peak-RAM oder FPS
vor. Die subjektive Phase-5-Schaetzung ist kein instrumentierter Messwert.
Drei vergleichbare gesprochene Dialoge und ihre Median-/Spannweiten sowie
klar definierte Messgrenzen bleiben offen; Server- und Browserzeiten ohne
synchronisierte Uhren nicht addieren. Standardbetrieb protokolliert keine
eigens aktivierten Timingdaten.
