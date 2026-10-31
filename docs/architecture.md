# Architektur und Schnittstellen

## Laufzeit
Browser (TypeScript/Three.js/Vite) rendert GLB und UI. Web Audio spielt TTS ab und liefert Audio-Pegel ueber die **Playback**-Zeitachse. Ein Python/FastAPI-Backend validiert Eingaben und orchestriert Provider (LLM Ollama, TTS Piper, STT spaeter faster-whisper). Browser sieht weder Ollama-Port noch TTS-Prozess direkt. REST/HTTP fuer den MVP; SSE/WebSocket nur mit nachgewiesenem Vorteil.

## Pakete (bei Implementierung anlegen)
- `apps/web/src/avatar`: CharacterAdapter, AnimationController, LipSyncController; keine provider-/vendor-spezifischen Bone-Namen im Chatmodul.
- `apps/web/src/audio`: AudioPlayer, Mikrofon/Push-to-talk; AudioContext-Zugriff erst nach Nutzerinteraktion.
- `apps/web/src/chat`: Dialogzustand; Lade-/Fehler-/Abbruchzustaende.
- `apps/api/src/owli_avatar`: FastAPI-Routen, Provider-Protokolle und Konfiguration aus der Umgebung.
- `tools/blender`: einmalige GLB-Inspektion/Export in isolierten Prozessen, **nicht** in Webrequests.
- `assets/manifests`: Downloads, Pruefsummen, Lizenznachweise und verifizierte Rig-/Animation-Capabilities.

## Prinzipien
1. **Provider austauschbar**: Mock zuerst; lokale Live-Provider nur konfiguriert und geprueft.
2. **Character austauschbar**: semantische Aktionen, faehigkeitsbasierter Adapter und Mapping pro Modell.
3. **Zustandsmaschine**: `idle -> listening -> thinking -> speaking -> idle`; Fehler/Abbruch kehren kontrolliert zu idle zurueck.
4. **Audio-Kopplung**: bei `speaking` Pegel mit Attack/Release glatten, beak-open normiert 0..1. Achte auf Mischkonflikte mit Idle-Clips, Basistransforms und drei.js Mixer.
5. **Ressourcen**: Browser zeichnet; Server hat moeglicherweise nur integrierte Radeon Vega 7; keine GPU fuer Browser-Rendering auf Server voraussetzen.
6. **Datenschutz/Sicherheit**: keine persistenten Audio-Rohdaten per Default, keine geheimen Provider-Endpunkte im Frontend. Limits, Timeouts und kontrollierte Fehlerrueckgaben.

## Nichtziele der ersten Version
Kein autonomer Agent, kein Gesichts-Tracking, keine perfekte Visem-Lip-Sync, keine RAG-/Account-Datenbank, keine Unreal-/Cloud-Rendering-Infrastruktur, kein Produktionsbetrieb im Internet.

Siehe `docs/contracts.md` fuer API und Animationszustand.

