# Owli Avatar MVP

Browserbasierter, lokal betreibbarer 3D-Eulenavatar mit Text-/Spracheingabe, LLM-Antwort und synchronisierter TTS-Schnabelbewegung. **Status: Mock-Chat mit lokal bereitgestelltem Vuena-Originalmodell und synthetischer Jaw-Bewegung; optionaler lokaler Ollama-Textdialog und optionale Piper-Sprachausgabe und optionales lokales STT; Phase 5 mit lokalem STT, Ollama, Piper und Windows-Mikrofon ueber SSH-Localhost-Forwarding vom Nutzer funktional abgenommen.**

## Ziel und Grenzen

- Webbrowser rendert den austauschbaren, geriggten Charakter (Three.js, TypeScript, Vite).
- Ein kleines Python/FastAPI-Backend orchestriert LLM (bestehendes Ollama), TTS (zunaechst Piper) und STT (faster-whisper).
- Blender headless validiert und bearbeitet Modelle **offline**, nicht im Request-Pfad.
- Vor jeder echten KI-Integration existiert ein deterministischer Mock fuer UI- und API-Tests.
- Keine Unreal Engine, keine Pflicht fuer Docker, keine neue Datenbank, keine automatische Serverbereitstellung.
- Externes 3D-Modell, TTS-Stimmen und Modellgewichte sind **nicht** Teil dieses Repositories.

## Start fuer Codex CLI

1. Repo auf dem Entwicklungsrechner/Ubuntu-Server klonen und ins Repo wechseln.
2. `codex --version` und `codex --strict-config` ausfuehren. Falls die CLI den Schalter nicht kennt: `codex --help` pruefen.
3. Neue Codex-Session starten; `/model`, `/status` und `/permissions` kontrollieren. Erwartung: Hauptagent `gpt-6.1-terra` / `medium`, Subagents standardmaessig `gpt-6-luna` / `low`.
4. `AGENTS.md` lesen. Mit `docs/roadmap.md` beginnen und den naechsten abgegrenzten Auftrag anhand des aktuellen Projektstands waehlen.
5. Nach gezielten Aenderungen: `python3 scripts/check_foundation.py`. Nach `bash scripts/bootstrap.sh`: `bash scripts/check.sh`; fuer Chromium nach `npx playwright install chromium` auch `bash scripts/check.sh --browser`.

Die Projektkonfiguration ist in `.codex/config.toml` und den Rollen unter `.codex/agents/` versioniert. **Verfuegbarkeit von Modellen und Konfigurationswirksamkeit muessen auf der tatsaechlichen Codex-CLI bestaetigt werden**; dieses Repo startet hier keine Codex-Session.

## Projektkarte

| Pfad | Zustaendigkeit |
| --- | --- |
| `AGENTS.md` | Kurze, bei jedem Task geladene Arbeitsregeln |
| `.codex/` | Hauptmodell, Delegation, Rollen |
| `docs/roadmap.md` | Umsetzungsreihenfolge mit Abnahmekriterien |
| `docs/architecture.md` | Grenzen zwischen Browser, Backend, Providern und Assetpipeline |
| `docs/contracts.md` | API- und Animationserwartungen |
| `docs/assets.md` | Modellkandidaten, Lizenz-/Importpruefung |
| `docs/ki-server.md` | Integration in den bestehenden Ubuntu-Server |
| `docs/codex-workflow.md` | Delegation, PR-Review und Kontext-Hygiene |
| `scripts/check_foundation.py` | Abhaengigkeitsfreier Check des vorbereiteten Grundgeruests |

## Repositories

- Dieses Repo: https://github.com/KreutzM/Owli-Avatar-MVP (oeffentlich).
- Betriebsdokumentation des Ubuntu-Servers: https://github.com/KreutzM/KI-Server (privat; nur fuer berechtigte lokale Agent-Sessions).
- Separates Owli-3D-Projekt: kein Build-/Laufzeit-Zwang.

## Lizenzen / Datenschutz

Die Lizenz fuer **eigenen Projektcode ist noch zu entscheiden**. Externe Modelle, Stimmen und Gewichte duerfen erst nach nachweisbarer Lizenz- und Herkunftspruefung eingecheckt oder verteilt werden. Keine .env-Dateien, Tokens, personenbezogenen Testmitschnitte oder internen Serveradressen ins oeffentliche Git. Live-Provider sind optional und muessen separat eingerichtet werden; Mock-CI belegt keine Live-Integration.


### Lokales Vuena-Originalmodell

Das Modell wird nicht mit dem Repository verteilt. Das vorhandene Sample-Archiv
`Cute-Pets-Wildlife-FREE-Sample-CC0.zip` unter `assets/downloads/` ablegen und
`python3 scripts/prepare-vuena.py` ausführen. Das Skript prüft Archiv und
Original-GLB per SHA-256 und extrahiert ausschließlich `GLB/animal_owl.glb`.
Ohne Modell bleibt der Textchat über einen Ladefehlerhinweis nutzbar. Das
Original-Idle und die Lider bleiben erhalten; der Jaw wird nach dem Mixer
absolut zwischen Ruhepose und maximaler Original-Call-Stellung interpoliert.
Die Bewegung beim Mock-Dialog ist synthetisch, ohne Audio oder Viseme. Eine
öffentliche Weitergabe des Assets erfordert eine gesonderte Rechteprüfung.

### Ollama-Textdialog

Standard ist `OWLI_MODE=mock`. Fuer einen bereits laufenden lokalen Ollama-Dienst
`OWLI_MODE=ollama`, `OLLAMA_BASE_URL=http://127.0.0.1:11434` und
`OLLAMA_MODEL` auf ein vorhandenes Modell setzen, bevor das Backend gestartet
wird. Vorhandene Modelle lassen sich mit `curl http://127.0.0.1:11434/api/tags`
auflisten; es erfolgt kein Modelldownload oder Fallback. Nur HTTP-Loopback ist
zulaessig. `OLLAMA_CONNECT_TIMEOUT` und `OLLAMA_TOTAL_TIMEOUT` konfigurieren
die Timeouts in Sekunden (Standard 3 bzw. 60). Der Browser wartet standardmaessig
65 Sekunden; `VITE_CHAT_TIMEOUT_MS` kann beim Webstart gesetzt werden.

`OLLAMA_THINK=auto` (Standard) ueberlaesst den Denkmodus dem Modell und sendet
keinen `think`-Parameter. `OLLAMA_THINK=true` bzw. `false` sendet den
entsprechenden Booleschen Wert; ungueltige Werte fuehren zu einem
Konfigurationsfehler. Die Unterstuetzung haengt vom jeweiligen Modell ab.
Fuer den lokalen Sprachtest wurden `OWLI_MODE=ollama`,
`OLLAMA_MODEL=gemma4:e2b` und `OLLAMA_THINK=false` verwendet; dies sind
Beispiele, keine neuen Defaults.

Sessions liegen begrenzt im Speicher eines einzelnen Backend-Prozesses und
gehen bei Neustart verloren. Die Bewegung beim Antworten bleibt eine
synthetische Simulation ohne Ton oder Viseme. Live-Ollama ist separat von
Mock-CI und Browserabnahme zu pruefen.

### Optionale lokale Sprachausgabe

Standard `OWLI_TTS_MODE=off`: Textchat funktioniert ohne TTS. Ein bereits
separat laufender Piper-HTTP-Prozess kann mit `OWLI_TTS_MODE=piper` und
`PIPER_BASE_URL=http://127.0.0.1:5000` beim API-Start konfiguriert werden.
Nur HTTP-Loopback wird akzeptiert. `PIPER_CONNECT_TIMEOUT` und
`PIPER_TOTAL_TIMEOUT` setzen Sekundenlimits (Standard 3 und 60; maximal 30 bzw. 60 Sekunden). Es werden keine
Dienste gestartet oder Stimmen heruntergeladen. Aktivierung im Browser erfolgt
ausdruecklich durch Nutzereingabe; Lautstaerke und Stop sind bedienbar.

Der Wiedergabepegel steuert die vorhandene originale Jaw-Steuerung per RMS,
Noise-Gate und Glaettung. Das ist amplitudenbasierte Bewegung, keine Phonem-
oder Visem-Synchronisation. Ohne Audio schliesst der Jaw.

Piper wird separat betrieben: [piper-tts](https://pypi.org/project/piper-tts/)
nennt GPL-3.0-or-later; Stimmen haben eigene Lizenzen. Bei Weitergabe sind
Paket- und Stimmrechte gesondert zu pruefen. Dieses Repository enthaelt keine
Piper-Stimme.

### Optionale Spracheingabe

Standard ist `OWLI_STT_MODE=off`. Fuer den optionalen STT-Modus werden
`faster-whisper` und PyAV in der Python-Umgebung des STT-Workers benoetigt (standardmaessig die API-Umgebung; eine vorhandene separate Umgebung kann mit absolutem STT_PYTHON-Pfad gewaehlt werden),
sowie ein explizit vorhandenes CTranslate2-Modellverzeichnis `STT_MODEL_PATH`
(absolut, mit `model.bin`, `config.json` und `tokenizer.json`). Erst nach
gesonderter Genehmigung installieren bzw. ein Modell herunterladen; der
Provider selbst laedt keine Modell- oder Tokenizer-Dateien herunter.
`OWLI_STT_MODE=faster-whisper` aktiviert die Erkennung, `STT_TIMEOUT` setzt
das Limit in Sekunden (Standard 60, Maximum 120). Inferenz laeuft fuer jeden
Auftrag in einem eigenen abbrechbaren CPU/INT8-Prozess auf Deutsch; das
wiederholte Laden kostet Zeit. Es wird kein Audio dauerhaft gespeichert.

Mikrofonzugriff erfolgt erst beim Klick in einem sicheren Browserkontext
(localhost oder HTTPS). Aufnahme beenden fuellt das editierbare Textfeld;
direktes Senden ist eine separate, standardmaessig ausgeschaltete Option.
Der Nutzer hat den durchgaengigen Sprachtest in Phase 5 ueber SSH-Forwarding abgenommen; neue Umgebungen sind separat zu pruefen. Textchat bleibt bei deaktiviertem STT verfuegbar.


### Betrieb und Windows-Zugriff

Start, Stop, opt-in Leistungsmessung, Voraussetzungen und der noch separat freizugebende HTTPS-LAN-Betrieb stehen in [docs/ki-server.md](docs/ki-server.md). Der HTTPS-Zugang ist fuer das konfigurierte Heimnetz ohne Passwort vorgesehen; er ist noch nicht dauerhaft eingerichtet. Der erprobte SSH-Localhost-Portforward bleibt als Fallback verfuegbar. Die Rechte an der lokalen Teststimme de_DE-thorsten-medium sind nicht abschliessend geklaert; produktive oder kommerzielle Weitergabe ist nicht freigegeben.
