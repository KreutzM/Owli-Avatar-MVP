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
# Optional, nur bei separater bereits vorhandener STT-Umgebung:
export STT_PYTHON='<absoluter Pfad zum Worker-Python>'
bash scripts/run-dev.sh
```

STT braucht die lokal vorhandenen Python-Pakete faster-whisper und
PyAV und die drei in README beschriebenen Modelldateien. Optional kann
STT_PYTHON ein absolutes Python-Executable einer separaten vorhandenen
Worker-Umgebung benennen; ohne diese Angabe nutzt STT das API-Python. Ein Modell unter
`/tmp` kann beim Neustart oder durch das Betriebssystem entfernt werden;
einen dauerhaften privaten Speicherort und freien Platz vorab selbst pruefen.
Keine Gewichte, Stimmen oder lokalen Pfade ins Git aufnehmen. Der hier fuer
den lokalen Test verwendete Piper-HTTP-Prozess behaelt die letzte Synthese
inklusive Text temporaer im eigenen Speicher und macht sie auf seinem
Loopback-Infoendpunkt verfuegbar; Prozess nach dem Test beenden. Debug-Logging
darf fuer diese Messung nicht aktiviert werden.

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

Ein direkter Zugang ist nicht eingerichtet oder auf Windows getestet. Fuer
einen separat freizugebenden, zeitlich begrenzten Test dient
`scripts/lan-https-proxy.mjs` als projektlokaler Node-HTTPS-Server: Er liefert
einen eigenen Web-Build aus und leitet `/api` ausschliesslich an FastAPI auf
Loopback weiter. Node und OpenSSL sind auf dem untersuchten Ubuntu-Host
vorhanden; ein etablierter Reverse-Proxy ist dort nicht vorhanden. Ein
isolierter Loopback-Test pruefte TLS, die Weiterleitung und Dateigrenzen;
dies belegt keinen LAN- oder Windows-Test.

Geplant ist ein unprivilegierter Port 8443 auf genau der zuvor lokal
geprueften privaten LAN-IPv4-Adresse, nicht auf einer Wildcard-Adresse.
Kein Login und keine Client-IP-Filterung: Alle Geraete, die den Endpunkt
erreichen, koennen Owli und seine API verwenden. Das schliesst das Ausloesen
von Inferenz und die Einsicht in die eigene Sitzung ein. Die Firewall war zum
Pruefzeitpunkt nicht aktiv; der Zugriff auf den Port ist daher nicht durch
eine Host-Firewall auf bestimmte Geraete eingeschraenkt. Keine Routerfreigabe
einrichten; vorhandene Routerregeln wurden hier nicht geprueft. Der private
Schluessel der Test-CA muss privat bleiben. Eine kompromittierte CA koennte
fuer weitere Zertifikate missbraucht werden.

Nach gesonderter Freigabe, mit bereits gestarteter API und in einem eigenen
Terminal (keine Platzhalterwerte ins Git eintragen):

```sh
umask 077
OWLI_TEST_DIR=$(mktemp -d /tmp/owli-https-test.XXXXXXXX)
printf 'Testverzeichnis: %s\n' "$OWLI_TEST_DIR"
OWLI_LAN_IPV4='<zuvor gepruefte LAN-IPv4 des Servers>'
openssl req -x509 -newkey rsa:3072 -nodes -sha256 -days 30 \
  -keyout "$OWLI_TEST_DIR/ca.key" -out "$OWLI_TEST_DIR/ca.crt" \
  -subj '/CN=Owli lokaler Test CA' \
  -addext 'basicConstraints=critical,CA:TRUE' \
  -addext 'keyUsage=critical,keyCertSign,cRLSign'
openssl req -new -newkey rsa:2048 -nodes -sha256 \
  -keyout "$OWLI_TEST_DIR/server.key" -out "$OWLI_TEST_DIR/server.csr" \
  -subj '/CN=Owli lokaler Test'
printf 'subjectAltName=IP:%s\nextendedKeyUsage=serverAuth\nbasicConstraints=critical,CA:FALSE\n' "$OWLI_LAN_IPV4" > "$OWLI_TEST_DIR/server.ext"
openssl x509 -req -in "$OWLI_TEST_DIR/server.csr" -CA "$OWLI_TEST_DIR/ca.crt" \
  -CAkey "$OWLI_TEST_DIR/ca.key" -CAcreateserial -days 30 -sha256 \
  -extfile "$OWLI_TEST_DIR/server.ext" -out "$OWLI_TEST_DIR/server.crt"
(cd apps/web && npm run build -- --outDir "$OWLI_TEST_DIR/web")
OWLI_HTTPS_BIND="$OWLI_LAN_IPV4" OWLI_HTTPS_PORT=8443 \
  OWLI_HTTPS_CERT="$OWLI_TEST_DIR/server.crt" OWLI_HTTPS_KEY="$OWLI_TEST_DIR/server.key" \
  OWLI_WEB_DIST="$OWLI_TEST_DIR/web" node scripts/lan-https-proxy.mjs
```

Nur `ca.crt` per bestehendem SSH/SCP zum Windows-PC kopieren. Die Ausgabe von
`sha256sum "$OWLI_TEST_DIR/ca.crt"` mit `certutil -hashfile <ca.crt> SHA256`
auf Windows vergleichen und den Hash ueber einen getrennten vertrauten Kanal
bestaetigen. Nach
Freigabe im Benutzerkonto vertrauen: `certutil -user -addstore Root <ca.crt>`.
CA-Fingerabdruck davor mit `certutil -dump <ca.crt>` notieren. Browser unter
`https://<LAN-IP>:8443/` oeffnen und Zertifikatswarnungsfreiheit,
`window.isSecureContext` sowie Mikrofonfreigabe pruefen; Browser koennen eigene
Zertifikatsspeicher nutzen. HTTPS alleine ist keine Zugriffskontrolle.
Rueckbau: im Proxy-Terminal Ctrl-C; auf jedem betroffenen Windows-Konto
`certutil -user -delstore Root <exakter-CA-Fingerabdruck>`; nur das eigene
`OWLI_TEST_DIR` nach Pruefung seines Inhalts entfernen. Danach ggf. den
abgenommenen SSH-Tunnel nutzen. Keine Firewall-, DNS-, SSH-, systemd- oder
globale Proxy-Konfiguration aendern. Der Schritt ist erst nach Freigabe
auszufuehren.

## Messung

Die Messung ist standardmaessig aus. Fuer eine ausdrueckliche lokale
Testsession beim Runner-Start `OWLI_DIAGNOSTICS=1` und
`VITE_OWLI_DIAGNOSTICS=1` setzen. Im Browser sowohl Sprachausgabe als auch
direktes Senden aktivieren. Fuer erfolgreiche Sprachdialoge schreibt die API
eine Zeile `OWLI_METRICS` mit ausschliesslich numerischen Werten in die
Standardausgabe. Keine Texte, Audioinhalte oder Session-IDs werden in diesen
Messdaten erfasst. Die Diagnose-API ist ohne Opt-in deaktiviert, auf zehn Anfragen pro Minute
begrenzt und ueber den HTTPS-LAN-Eingang nicht erreichbar.

Browserzeiten verwenden `performance.now()`: Beginn ist der Aufruf von
`MediaRecorder.stop()`, nicht der (asynchrone) Eingang der letzten Audiodaten.
`capture_to_upload_ms` endet bei Fetch-Aufruf. Die serverseitige `upload_ms` misst das Einlesen
des Request-Bodys ab Eintritt in den STT-Guard; vor dem Guard bereits
uebertragene Netzwerkdaten sind darin nicht enthalten. Die STT-Requestdauer
umfasst Upload, Serververarbeitung und Antwort. Chat- und
TTS-Requestdauern umfassen ebenfalls Transport und Antwort. Das Ende der
Gesamtdauer ist der Aufruf von `AudioBufferSourceNode.start()`, also der
Web-Audio-Planungszeitpunkt, nicht eine am Lautsprecher gemessene Ausgabe.
STT-, Ollama- und Piper-Dauern werden separat auf dem Server mit
`time.perf_counter()` um den jeweiligen Provideraufruf gemessen; STT umfasst
den Workerstart. Server- und Browseruhren werden nicht miteinander verrechnet.
FPS ist die letzte einsekundige requestAnimationFrame-Rate, falls verfuegbar.

`python3 scripts/measure-processes.py --pid <runner-pid> --pid <piper-pid>`
protokolliert Stichproben der Prozessbaeume als JSON-Zeilen. CPU-Prozent
bezieht sich auf einen logischen Kern und kann ueber 100 liegen. RSS ist die
Summe der residenten Speicherwerte und kann geteilte Seiten mehrfach zaehlen;
kurzlebige Prozesse und Spitzen zwischen Stichproben koennen verpasst werden.
Ollama separat messen und als gemeinsam genutzten Dienst kennzeichnen.
Ausgaben sind privat und koennen nach expliziter Pruefung zusammengefasst
werden; keine Rohaufnahmen oder persoenlichen Inhalte ins Git uebernehmen.

## Messstand

Drei gesprochene Dialoge ueber den bestehenden Windows-SSH-Tunnel wurden
mit aktivierter Diagnostik erfasst. Messung vom 8. November 2026; vorhandenes
Ollama-Modell gemma4:e2b mit `OLLAMA_THINK=false`, lokaler faster-whisper
CPU/INT8-Worker und lokale Piper-Teststimme. Eine separate technische
Vorabprobe ist nicht enthalten. Werte sind Minimum / Median / Maximum:

| Messgroesse | Minimum | Median | Maximum |
| --- | ---: | ---: | ---: |
| Aufnahme-Stopp bis Web-Audio-Startaufruf | 2795,9 ms | 3946,4 ms | 4280,2 ms |
| Stopp bis STT-Fetch | 12,1 ms | 12,8 ms | 16,2 ms |
| Serverseitiges Einlesen des STT-Bodys | 0,17 ms | 0,19 ms | 0,19 ms |
| STT-Provider inklusive Workerstart | 1109,52 ms | 1121,18 ms | 2055,17 ms |
| STT-Request und Antwort im Browser | 1122,1 ms | 1133,8 ms | 2068,0 ms |
| Ollama-Provider | 556,70 ms | 2404,99 ms | 2779,16 ms |
| Chat-Request und Antwort im Browser | 561,9 ms | 2410,1 ms | 2784,4 ms |
| Piper-Provider | 140,74 ms | 330,16 ms | 378,74 ms |
| TTS-Request und Antwort im Browser | 147,6 ms | 339,6 ms | 388,3 ms |
| Browser-FPS | 59,99 | 59,99 | 60,00 |

Die beschriebenen Browser- und Servergrenzen gelten; die serverseitige
Uploadzeit ist nicht die gesamte Ende-zu-Ende-Netzzeit, Web-Audio-Start ist
kein akustischer Lautsprecherzeitpunkt. Browser- und Serverzeiten nicht
unkalibriert addieren. Die Werte sind drei Einzelmessungen und keine
allgemeine Leistungszusage.

In 172 Stichproben im Abstand von ca. 0,5 s erreichten Runner/API/Vite,
STT-Kinder und eigener Piper zusammen maximal 462,95 % CPU bezogen auf einen
logischen Kern und 879,4 MiB summiertes RSS. Der separat beobachtete,
gemeinsam genutzte Ollama-Prozessbaum erreichte 333,66 % und 554,6 MiB
summiertes RSS. Diese maxima koennen zu verschiedenen Zeitpunkten auftreten,
enthalten geteilte Speicherseiten mehrfach und koennen kurze Spitzen
verpassen. Andere Nutzer des gemeinsam betriebenen Ollama-Dienstes waeren
nicht von dieser Messung unterscheidbar. Browser-CPU und Browser-RAM auf
Windows wurden nicht gemessen. Private Messdateien und Audio verbleiben
ausserhalb des Repositories.
