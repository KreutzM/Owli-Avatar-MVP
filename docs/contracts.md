# API-Vertraege und geplante Erweiterungen

## REST API — v1 Entwurf
Alle Serverendpunkte unter `/api`, JSON ausser Audio-Binary. Versionsbrueche bewusst versionieren; TypeScript- und Python-Vertraege gemeinsam testen.

- `GET /api/health`: `{"status":"ok","mode":"mock"}` bzw. `mode: "ollama"` oder eine Fehlerantwort. Keine internen Ports/Secrets preisgeben.
- `POST /api/chat`: Eingabe `{"session_id":"optional","message":"..."}`; Ausgabe `{"reply":"...","session_id":"..."}`. Antwort enthaelt zusaetzlich `mode: "mock" | "ollama"`. Eingabe maximal 1000 Zeichen und 16 KiB Roh-Request und fuenf Sekunden fuer dessen Eingang; hoechstens acht parallele Body-Lesevorgaenge; pro Prozess maximal 60 Chat-Anfragen pro Minute und vier parallele Ollama-Anfragen; Ollama-Sessions sind zufaellig, pro Prozess und im Speicher, maximal 100 Sessions, 30 Minuten TTL, 12 Verlaufsnachrichten bzw. 12000 Zeichen. Unbekannte oder abgelaufene IDs liefern 404. Je Session nur eine laufende Anfrage. Bei Fehler oder Abbruch wird kein Turn gespeichert. Ollama-Antworten maximal 4000 Zeichen.
- `POST /api/tts`: `{"text":"..."}` (1–4000 Zeichen) -> PCM-WAV mit `audio/wav` und `Cache-Control: no-store`; maximal 10 MiB und 30 s Audio. Standard `OWLI_TTS_MODE=off` liefert 501. `GET /api/tts/status` meldet nur `enabled`. Der TTS-Request teilt Body-, Zeit- und Rate-Limits mit Chat; maximal zwei parallele Synthesen pro Prozess. Timeout, Abbruch und Providerfehler geben Ressourcen frei und legen keine Rohdaten ab.
- `POST /api/stt`: Browser-Aufnahme (zugelassenes Audioformat; max. Dauer/Bytes) -> `{"text":"..."}`.
- `GET /api/avatar/config`: semantische Modell-ID und Features/Capabilities, keine sensitiven Dateipfade.

Fehlerform: `{"error":{"code":"...","message":"..."}}` mit passendem HTTP-Status. Ollama-Fehler und Timeouts werden ohne interne Details ausgegeben; Browserabbruch bricht die ausstehende Provideranfrage ab.

## Avatar-Contract — semantisch
Interface (TS-Konzept; noch kein Quelltext):

    type AvatarState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error';

    interface AvatarCapabilities {
      mouth: boolean;
      blink: boolean;
      gaze: boolean;
      clips: string[];
    }

    interface CharacterAdapter {
      load(): Promise<void>;
      capabilities(): AvatarCapabilities;
      setState(state: AvatarState): void;
      setMouthOpen(amount: number): void; // clamp [0, 1]
      setBlink(amount: number): void;     // clamp [0, 1]
      lookAt(x: number, y: number): void;
      dispose(): void;
    }

Die konkreten Animation-Clips/Bones kommen aus dem geprueften Assetmanifest. Nicht unterstellen, dass jeder Vogel ein separates Schnabel-Shape-Key hat. Viseme sind optional, Audio-Envelope ist erste Ausbaustufe. Keine konkurrierenden Mixer-Tracks sollen Mundkontrolle unbemerkt ueberschreiben.

## Qualitaetsmerkmale
- Bedienbar mit Maus/Tastatur; schreibbare Textalternative ohne Mikrofon.
- Audio niemals automatisch ohne Nutzeraktivierung.
- Deterministische Mock-Antworten fuer Tests; Live-Abnahmen gesondert.
- Abbruch/Network-Failure/TTS-Failure kehren in steuerbaren Zustand zurueck.

