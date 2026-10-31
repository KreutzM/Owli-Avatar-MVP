# Entwurfsvertraege (noch nicht implementiert)

## REST API — v1 Entwurf
Alle Serverendpunkte unter `/api`, JSON ausser Audio-Binary. Versionsbrueche bewusst versionieren; TypeScript- und Python-Vertraege gemeinsam testen.

- `GET /api/health`: `{"status":"ok","mode":"mock"}` oder sinnvoll eingeschraenkte Degraded-Antwort. Keine internen Ports/Secrets preisgeben.
- `POST /api/chat`: Eingabe `{"session_id":"optional","message":"..."}`; Ausgabe `{"reply":"...","session_id":"..."}`. Serverseitige Nutzereingabe-/Verlaufslimits, standardisierte Fehlerform.
- `POST /api/tts`: `{"text":"..."}` -> Audio (WAV fuer MVP) mit richtigem Content-Type. Dauer/Byte-Limit; nicht durch lange Texte blockieren.
- `POST /api/stt`: Browser-Aufnahme (zugelassenes Audioformat; max. Dauer/Bytes) -> `{"text":"..."}`.
- `GET /api/avatar/config`: semantische Modell-ID und Features/Capabilities, keine sensitiven Dateipfade.

Fehlerform: `{"error":{"code":"...","message":"..."}}` mit passendem HTTP-Status. Von Anfang an ausstehende Anfrage, Timeout, Unterbrechung und den ausgeschalteten Provider beruecksichtigen.

## Avatar-Contract — semantisch
Semantisches Interface (die implementierten Namen und Laufzeitmethoden stehen in `apps/web/src/avatar/character.ts`):

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

