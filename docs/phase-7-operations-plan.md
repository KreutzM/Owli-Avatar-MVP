# Phase 7: Vorschlag fuer dauerhaften Heimnetzbetrieb

Status: Architekturvorschlag zu Issue #19. Kein Dienst ist eingerichtet,
aktiviert oder bereitgestellt. Angaben zu internen Adressen, privaten Dateien,
Passwoertern und Zertifikats-Fingerabdruecken gehoeren nicht ins oeffentliche
Repository. Bestehende Testzertifikate und das Windows-Vertrauen bleiben
erhalten.

## Verifizierter Ausgangspunkt

- Die vorhandene Test-CA und das zugehoerige Serverzertifikat sind bis zum
  8. Dezember 2026 gueltig; die Zertifikatskette wurde lokal geprueft.
  Beide privaten Schluessel liegen weiterhin im bestehenden Testverzeichnis
  unter /tmp, das Verzeichnis ist 0700, die Schluessel sind 0600.
- Die STT-Workerumgebung und das Modell liegen ebenfalls unter /tmp und
  sind nicht gegen Neustart oder Betriebssystembereinigung abgesichert.
  Der Runner startet API und Vite, aber keinen Piper-Dienst.
- Node und OpenSSL sind vorhanden. Der getestete HTTPS-Proxy liefert einen
  Web-Build und leitet /api an Loopback weiter, hat aber keinen Login.
  Fuer Dauerbetrieb darf dieser ungeschuetzte Testmodus nicht verwendet werden.
- Ollama ist aktiv und das gewaehlte Modell vorhanden. Es gibt keine
  eingerichteten Owli-/Piper-User-Units. User-Lingering ist bereits aktiv.
  UFW war inaktiv und die lesbaren nftables-Regeln waren leer. Der Router
  wurde nicht geprueft; daraus folgt keine Aussage ueber Internetfreigaben.
- Das Windows-Vertrauen wurde vom Nutzer als zu bewahren bezeichnet; es wurde
  nicht erneut direkt auf Windows inspiziert.

## Architekturvorschlag

Ein gemeinsames, starkes Owli-Passwort fuer alle gewuenschten Heimnetz-PCs,
einmal je Browser eingeben und auf Wunsch dort speichern. HTTPS und eine
Anmeldung schuetzen alle Inhalte und API-Endpunkte. Keine einzelnen
Client-Zertifikate und keine starren Client-IP-Listen. Die Zugangsdaten werden
nicht an FastAPI oder Piper weitergeleitet und nicht protokolliert. Ohne
korrekt konfigurierte Authentifizierung startet kein LAN-Eingang. Es gibt
keinen automatischen Gast- oder ungeschuetzten Fallback.

Die bevorzugte Umsetzung ist HTTPS-Basic-Auth im vorhandenen Node-Eingang,
mit starkem, zufaelligem Passwort, gesalzenem Passwortverifier in einer
privaten 0600-Datei, gleichfoermiger Vergleichspruefung und Begrenzung
fehlgeschlagener Anmeldungen. Ein gemeinsam genutztes Passwort identifiziert
keine einzelnen Personen; Browser koennen es zwischenspeichern. Das ist ein
bewusster Kompromiss fuer einfachen Heimnetzzugang, kein Mehrbenutzerkonzept.
Weil Browser Basic-Zugangsdaten automatisch mitsenden koennen, muessen
zustandsaendernde API-Anfragen zusaetzlich gegen Cross-Site-Requests
abgesichert werden: zulässige Origin exakt pruefen und einen projektspezifischen
Request-Header verlangen; CORS-Anfragen fremder Origins ablehnen. Das
Zusammenspiel von Login, Browser, CSRF-Schutz und Fehlermeldungen wird mit
unabhaengigen Tests nachgewiesen, bevor LAN-Betrieb freigegeben wird.
Die Diagnostik bleibt im Normalbetrieb aus und ihr Endpunkt am LAN-Eingang
gesperrt. Es werden keine Texte, Audioinhalte, Tokens oder Auth-Header geloggt.
Weiterhin gilt: ein kompromittiertes Heimnetzgeraet oder gemeinsam bekanntes
Passwort kann die Anwendung verwenden; TLS schuetzt keine kompromittierten
Endgeraete.

Der einzige externe Einstieg bindet an die bestaetigte private IPv4-Adresse
und Port 8443; keine Wildcard-Adresse. FastAPI und der eigene Piper-Prozess
binden an 127.0.0.1; STT bleibt ein eigener begrenzter Workerprozess.
Die API spricht ausschliesslich mit dem bestehenden Ollama auf Loopback.
Ein statischer, privat gebauter Web-Build wird vom HTTPS-Eingang ausgeliefert;
Vite ist fuer den Dauerbetrieb nicht erforderlich. Keine Routerfreigabe
einrichten. Vor einem echten Start muessen vorhandene Router-/NAT-Regeln
durch den berechtigten Betreiber kontrolliert werden; lokales Binden allein
beweist nicht, dass keine Weiterleitung aus dem Internet existiert.

## Zertifikate und Daten

Die bereits benutzte CA, ihr privater Schluessel, das Serverzertifikat,
dessen privater Schluessel und das Windows-Vertrauen werden weder geloescht
noch ueberschrieben. Vorgeschlagene Uebernahme nach ausdruecklicher
Host-Freigabe: ein neues privates Verzeichnis unter
`~/.local/share/owli/` mit Modus 0700 anlegen; vorhandenes Serverzertifikat
und seinen Schluessel in einen eigenen TLS-Unterordner mit 0600 kopieren,
Datei- und Zertifikats-Fingerabdruecke sowie Zuordnung von Schluessel und
Zertifikat vor und nach dem Kopieren pruefen. Die bisherige Kopie bleibt
unveraendert. Vor Aktivierung werden Ablaufzeit und IP-SAN mit der tatsaechlichen
Bindung geprueft; bei Abweichung kein Start.

Ein verschluesseltes Offline-Backup des CA-Schluessels ist separat mit dem
Nutzer zu planen und auf Wiederherstellbarkeit zu pruefen. Der Proxy braucht
den CA-Privatschluessel nicht. Das Original im /tmp-Testverzeichnis wird
bis zu gesonderter Entscheidung nicht entfernt; damit ist der Schluessel
trotz Dateirechten weiterhin auf dem Host vorhanden. Eine Abschottung des
Dienstes gegen dieses Verzeichnis ist zu testen; ohne verifizierte
Abschottung darf keine Offline-Schluesselhaltung behauptet werden.

Die vorhandene CA endet am 8. Dezember 2026. Auch ein laenger ausgestelltes
Serverzertifikat kann das Ende der CA-Vertrauenskette nicht beheben.
Vor Ablauf wird eine neue, laengerfristige CA samt Serverzertifikat und
zusaetzlichem Windows-Vertrauen technisch noetig; Verfahren, Backup,
Ueberlappungszeit und Windows-Aenderung erfordern eine eigene ausdrueckliche
Freigabe. Bis dahin die bestehende Kette unveraendert nutzen; keine ungefragte
Neuerstellung und kein automatischer Eingriff in Windows.

STT-Modell, Workerumgebung und privater Web-Build muessen aus /tmp an einen
dauerhaften, privaten Ort uebernommen bzw. reproduzierbar erstellt werden.
Die vorhandene Python-venv darf nicht unbesehen als portabel vorausgesetzt
werden: Kopier-/Offline-Rebuild-Verfahren, Abhaengigkeiten, native Bibliotheken,
Importe und Modellhashes werden vor einem Dienststart geprueft. Ein lokales
Wheelhouse ist bislang nicht nachgewiesen. Keine Modell-/Stimm-Downloads,
keine private Stimme oder Modellgewichte ins Git. Reicht der vorhandene
Offline-Bestand nicht aus, wird die Aktivierung gestoppt und die Luecke
gemeldet. Die Thorsten-Teststimme bleibt auf lokale nichtkommerzielle Tests
beschraenkt.

## Prozessbetrieb und Eingriffe

Vorschlag: drei eigene systemd-User-Units `owli-piper.service`,
`owli-api.service` und `owli-https.service`, unter dem bestehenden
unprivilegierten Benutzer. Es werden keine fremden Dienstdateien oder
Ollama-/Hermes-Units veraendert. Die Units nutzen explizite absolute Pfade,
private Konfiguration, begrenzte Neustartversuche und kurze Health- bzw.
Bereitschaftspruefungen. Reihenfolge allein beweist keine Bereitschaft:
API und Eingang pruefen ihre jeweiligen Voraussetzungen mit zeitlicher Grenze.
Bei belegten Ports, fehlenden Dateien, ungueltiger Auth oder Zertifikaten
wird der eigene Start abgebrochen. Ollama bleibt eine externe Abhaengigkeit;
weder Start, Restart, Stop noch Konfiguration des Ollama-Dienstes sind Teil
des Owli-Betriebs. Ausfall fuehrt zu nachvollziehbaren Fehlern und manuellem
oder begrenztem Retry, nicht zu unbegrenzten Neustartschleifen.

Die geplanten Host-Aenderungen muessen nach fertig vorbereitetem und
reviewtem Stand einzeln freigegeben werden:

1. Ausschliesslich eigene private Konfiguration, kopierte vorhandene
   Zertifikate, geprüfte STT-Umgebung und Build unter dem Nutzerkonto
   anlegen. Vorhandene Dateien, /tmp-Originale und Backups bleiben erhalten.
2. Ausschliesslich die drei neuen Unit-Dateien unter
   `~/.config/systemd/user/` installieren, `systemctl --user daemon-reload`
   und nach gesonderter Deployment-Freigabe gezielt diese Units aktivieren
   und starten. Bestehendes Lingering bleibt unveraendert. Ein eventuell
   vorhandener Namenskonflikt stoppt die Aktion.
3. Keine Firewall-, Router-, DNS-, SSH-, Windows-Trust- oder globalen
   systemd-Aenderungen als Teil dieser Schritte. Eine eventuell dennoch
   erforderliche Aenderung wird vorab gesondert vorgelegt.

Logs enthalten Betriebsstatus und begrenzte Fehlermeldungen, aber keine
Eingaben, Audio, Passwoerter, Tokens oder Session-IDs. Journaleinstellungen
des Hosts werden nicht global geaendert. Ein Upgrade erfolgt nur nach
geprueftem Release, Tests und ausdruecklicher Freigabe; kein automatisches
Update. Alte Releases/Artefakte bleiben bis zur gesonderten Entscheidung
erhalten.

Rueckbau nach einer genehmigten Installation: nur die drei oben genannten
eigenen Units mit `systemctl --user disable --now` gezielt stoppen und
deaktivieren, nur ihre eigenen Unit-Dateien nach Pruefung entfernen und
`systemctl --user daemon-reload` ausfuehren. Keine anderen Dienste,
Lingering, Netzregeln, Zertifikate, Windows-Vertrauen, Modellkopien oder
Backups veraendern. Rollback eines Updates erfolgt durch dokumentierten
Wechsel auf den vorher gesicherten Projektstand nach erneuter Freigabe.
SSH-Localhost-Forwarding bleibt der Fallback.

## Nachweise vor Freigabe

- Mock-CI und unabhängiger Review: Authentifizierung fuer statische Dateien
  und API, Rate-Limit, Cross-Site-Request-Schutz, fehlende/ungueltige Secrets,
  Timeouts, keine Secret-Leaks, Loopback-Upstreams, Portkonflikte und kontrolliertes
  Stop-/Restart-Verhalten.
- In isolierter lokaler Umgebung ohne echte Modelle: reproduzierbarer
  Build, explizite Betriebskonfiguration, Dienstdatei-Syntax und Fehlerszenarien.
- Erst nach gesonderter Aktivierungsfreigabe: mehrere eigene Start-/Stop- und
  Neustartlaeufe, Ollama/Hermes vorher/nachher unveraendert, lokale und
  Windows-HTTPS-Zertifikatspruefung, Mic/Transkript/Stop/TTS/Idle und
  Nutzerabnahme. Der vorhandene Phase-6-Nachweis ersetzt diese neue Abnahme nicht.
