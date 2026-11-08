# Roadmap / Abnahmekriterien

**Projektstatus:** Der Nutzer hat Phase 5 mit lokaler STT, Ollama, Piper und Vuena im Windows-Browser abgenommen; sicherer Zugriff ueber SSH-Localhost-Portforwarding. Die vorhandene, sehr subtile Jaw-Bewegung ist akzeptiert. Ein frueherer einzelner TTS-Fehler bleibt ohne gesicherte Ursache dokumentiert; die Rechte an der lokalen Thorsten-Teststimme sind nicht abschliessend geklaert. CI-Pruefung und Realbrowser-Abnahme bleiben getrennte Nachweise.

## Phase 1 — Mock End-to-End Grundgeruest
- Vite/TypeScript/Three.js, Python FastAPI, testbare Provider-Vertraege und deterministische Mocks anlegen.
- Browser zeigt eine klar als Platzhalter erkennbare 3D-Figur, Texteingabe/Mock-Antwort, explizite Zustaende und Fehlermeldungen.
- Minimaler Testlauf: Web-Build, API-Unit-Tests, Playwright-smoke in einem frischen Checkout; kein Cloud- oder Serverkontakt.
- Abnahme: `README` beschreibt getestete lokale Startbefehle. Optional `uv.lock` und `package-lock.json` versionieren, sobald echte Abhaengigkeiten definiert sind.

## Phase 2 — Reales Eulenmodell und Animationsadapter
- Vuena und Gobkit nur aus bestaetigten Quellen lizenzgeprueft beziehen. Download-URL, Hash und Versionsstand dokumentieren.
- Blender headless validiert Armature, Animationen, Texturen, Schnabel/Blink-Steuerung. Three.js Browserkontrolle mit Screenshots.
- Adapter testet Idle/Listening/Thinking/Speaking, kontrolliert Lip-Sync-Overlay auf Idle; degrade gracefully.
- Abnahme: mindestens ein reales, browserseitig korrekt dargestelltes und steuerbares Eulenmodell; echte Assetquelle/Rechte nachgewiesen.

## Phase 3 — Ollama-LLM Textdialog
- Lokaler Backend-Provider mit Timeouts, Abbruch, begrenzter Sitzungsverlauf-/Tokenlaenge; nur Server-seitig.
- Mocks bleiben CI-Standard; separate Live-Smokes gegen vorhandenes Ollama nach Freigabe.
- Abnahme: schriftlicher Browserdialog und unterscheidbare Mock-/Live-Belege.

## Phase 4 — Piper-TTS + Schnabelsync
- Deutsche Stimme pruefen/lizenzieren; Audio aus Backend ausgeben, Browser playback-Clock/Envelope koppeln.
- UI steuert Sprechen/Unterbrechen, verifiziert Schnabelbewegung waehrend echter Wiedergabe.
- Abnahme: Audio und sichtbare Bewegung bei fester Testphrase; Latenz dokumentiert.

## Phase 5 — Spracheingabe
- Push-to-talk, Audioformat/-groessenlimits, faster-whisper CPU-Provider mit datensparsamem Ablauf.
- Sicherheitskontext (localhost oder HTTPS) testen und Mikrofonfehler sauber behandeln.
- Abnahme: sprachliche Frage -> erkannter Text -> LLM -> TTS -> Avatar bei realem Browser-Test.
- Nutzerabnahme: Mikrofon, editierbares Transkript, Direktversand, Stop/Abbruch, hoerbare Antwort und Idle-Rueckkehr persoenlich bestaetigt. Die geschaetzten drei Sekunden bis zur Antwort sind eine subjektive Beobachtung, keine praezise Messung bis zum ersten Ton. Die technische Jaw-Rotation wurde gemessen; ihre subtile optische Auspraegung am Originalmodell ist akzeptiert.

## Phase 6 — Integration und Leistungsbewertung
- Reproduzierbarer Serverstart erst nach expliziter Freigabe; keine Systemdienste still aendern.
- Messwerte: First-response/TTFA, TTS-s/Audio-s, Peak RAM, Browser FPS, Audio-Video-Sync und Fehlerfaelle.
- Abnahme: Nutzerseitige Sicht-/Hoerprobe + dokumentierter Rueckweg.

**Arbeitsmodus:** Eine klar abgegrenzte Phase/PR zuerst. Phasen nicht als implementiert markieren, bevor Check und Live-Beleg vorliegen.

