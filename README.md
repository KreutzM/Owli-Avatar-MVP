# Owli Avatar MVP

Browserbasierter, lokal betreibbarer 3D-Eulenavatar mit Text-/Spracheingabe, LLM-Antwort und synchronisierter TTS-Schnabelbewegung. **Status: Mock-Chat mit geriggter Gobkit-Eule und prozeduralem Fallback; keine Live-Sprache.** Der Schnabel wird vorerst zeitbasiert simuliert. Herkunft und Prüfungen: [Issue-3-Bericht](docs/verification-issue-3.md).

## Ziel und Grenzen

- Webbrowser rendert den austauschbaren, geriggten Charakter (Three.js, TypeScript, Vite).
- Ein kleines Python/FastAPI-Backend orchestriert LLM (bestehendes Ollama), TTS (zunaechst Piper) und spaeter STT (faster-whisper).
- Blender headless validiert und bearbeitet Modelle **offline**, nicht im Request-Pfad.
- Vor jeder echten KI-Integration existiert ein deterministischer Mock fuer UI- und API-Tests.
- Keine Unreal Engine, keine Pflicht fuer Docker, keine neue Datenbank, keine automatische Serverbereitstellung.
- Externes 3D-Modell, TTS-Stimmen und Modellgewichte sind **nicht** Teil dieses Repositories.

## Start fuer Codex CLI

1. Repo auf dem Entwicklungsrechner/Ubuntu-Server klonen und ins Repo wechseln.
2. `codex --version` und `codex --strict-config` ausfuehren. Falls die CLI den Schalter nicht kennt: `codex --help` pruefen.
3. Neue Codex-Session starten; `/model`, `/status` und `/permissions` kontrollieren. Erwartung: Hauptagent `gpt-6.1-terra` / `medium`, Subagents standardmaessig `gpt-6-luna` / `low`.
4. `AGENTS.md` lesen. Mit `docs/roadmap.md` beginnen und **nur Phase 1** als ersten Umsetzungsauftrag starten.
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

Die Lizenz fuer **eigenen Projektcode ist noch zu entscheiden**. Externe Modelle, Stimmen und Gewichte duerfen erst nach nachweisbarer Lizenz- und Herkunftspruefung eingecheckt oder verteilt werden. Keine .env-Dateien, Tokens, personenbezogenen Testmitschnitte oder internen Serveradressen ins oeffentliche Git. Lokale LLM-/Audio-Nutzung ist Ziel, nicht bereits implementierter Ist-Zustand.

