# Phase 7: Vorschlag fuer dauerhaften Heimnetzbetrieb

Status: Nutzer hat einen passwortfreien, einfachen Heimnetzzugang als
Architekturrichtung freigegeben. Kein Dienst ist eingerichtet,
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
  Web-Build und leitet /api an Loopback weiter. Der Nutzer hat entschieden,
  fuer Owli kein Passwort einzurichten; alle PCs im Heimnetz sollen Zugriff
  haben.
- Ollama ist aktiv und das gewaehlte Modell vorhanden. Die vorgeschlagenen
  Owli-Unit- und Dienstkonto-Namen waren bei der lesenden Pruefung frei.
  Das vorhandene Benutzerkonto ist Mitglied der sudo-Gruppe; User-Units
  desselben Kontos waeren deshalb keine ausreichende Privilegtrennung.
  User-Lingering ist bereits aktiv und muss nicht geaendert werden.
  UFW war inaktiv und die lesbaren nftables-Regeln waren leer. Der Router
  wurde nicht geprueft; daraus folgt keine Aussage ueber Internetfreigaben.
- Das Windows-Vertrauen wurde vom Nutzer als zu bewahren bezeichnet; es wurde
  nicht erneut direkt auf Windows inspiziert.

## Architekturvorschlag

Der Nutzer wuenscht fuer Owli keine Passwoerter; alle PCs im privaten
Heimnetz sollen den Zugang nutzen koennen. Der HTTPS-Eingang verwendet daher
keine Anmeldung und keine Client-Zertifikate. Fuer den Dauerbetrieb wird
vorgeschlagen, den Zugang auf das vor Ort explizit konfigurierte private
Heimnetz-Subnetz zu begrenzen. Die Entscheidung verwendet ausschliesslich die
direkte Netzwerk-Quelladresse der Verbindung, niemals vom Client gesetzte
Forwarded-Header; eine fehlende oder fehlerhafte Subnetzkonfiguration
verhindert den Start. Der Schutz muss vor statischen Dateien und API-Endpunkten
greifen und automatisiert auf zulaessige und abgelehnte Quelladressen
geprueft werden. Die tatsaechliche Durchsetzung wird spaeter im Heimnetz
ueberprueft. Kein Eingriff in die Host-Firewall ist dafuer vorgesehen.

Diese Begrenzung ist keine Authentifizierung: Jedes Geraet im zugelassenen
Netz kann die Oberflaeche und API verwenden und Ressourcen ausloesen.
Insbesondere schuetzt sie nicht vor anderen oder kompromittierten Geraeten
im Heimnetz. Damit wird die fruehere Issue-19-Vorgabe, beliebige LAN-Nutzer
durch Anmeldung auszuschliessen, auf ausdruecklichen Wunsch des Nutzers
geaendert. HTTPS schuetzt den Transport und ermoeglicht Mikrofonzugriff;
es identifiziert keine Benutzer.

Zustandsaendernde API-Anfragen muessen unabhaengig von einer Anmeldung
gegen Cross-Site-Requests geschuetzt werden: zulaessige Origin exakt pruefen,
einen projektspezifischen Request-Header verlangen und CORS-Anfragen fremder
Origins ablehnen. DNS-Rebinding, Subnetzgrenzen, Anfragelimits und
Fehlermeldungen sind vor einer LAN-Freigabe unabhaengig zu testen.
Die Diagnostik bleibt im Normalbetrieb aus und ihr Endpunkt am LAN-Eingang
gesperrt. Es werden keine Texte, Audioinhalte, Tokens oder Session-IDs geloggt.

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
`/var/lib/owli/` mit Modus 0700 fuer das eigene Dienstkonto anlegen;
vorhandenes Serverzertifikat und seinen Schluessel in einen eigenen
TLS-Unterordner mit 0600 kopieren,
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
Wheelhouse ist bislang nicht nachgewiesen. Auf dem untersuchten Rechner
wurden aus vorhandenen Paketen neue isolierte temporaere Python-Umgebungen
fuer STT und Piper erstellt: eine STT-Probe mit vorhandenem Modell und das
Laden der vorhandenen Piper-Teststimme waren offline erfolgreich. Auch eine
aus vorhandenem Interpreter und Paketen neu erstellte API-Umgebung bestand
Importpruefungen. Diese Proben belegen weder einen anderen Rechner noch die
endgueltigen Rechte des Dienstkontos; die API-venv muss nach dem Kopieren des
Interpreters am endgueltigen Zielort neu erstellt werden, da ihre Pfade
absolut sind. Keine Modell-/Stimm-Downloads,
keine private Stimme oder Modellgewichte ins Git. Reicht der vorhandene
Offline-Bestand nicht aus, wird die Aktivierung gestoppt und die Luecke
gemeldet. Die Thorsten-Teststimme bleibt auf lokale nichtkommerzielle Tests
beschraenkt.

## Prozessbetrieb und Eingriffe

Vorschlag: drei eigene systemd-System-Units `owli-piper.service`,
`owli-api.service` und `owli-https.service` mit einem eigens angelegten
Dienstkonto `owli-avatar` ohne interaktiven Login und ohne sudo- oder
Ollama-Gruppenmitgliedschaft. Die Wahl eines Systemdienstes erfordert
bewusst eine gesonderte Host-Freigabe. Es werden keine fremden Dienstdateien
oder Ollama-/Hermes-Units veraendert. Die Units nutzen explizite absolute
Pfade, private Konfiguration, begrenzte Neustartversuche und kurze Health-
bzw. Bereitschaftspruefungen. Das Dienstkonto liest nur die fuer den Betrieb
noetigen, dafuer bereitgestellten Kopien; es benoetigt keinen Zugriff auf
den CA-Privatschluessel. Die Dienste erhalten `NoNewPrivileges`, wo
funktionsfaehig Dateisystem- und Temporaerverzeichnis-Isolation, und nur
erforderliche Schreibrechte. Sandboxing und dessen Kernel-/systemd-Support
muessen vor Aktivierung nachgewiesen werden; gleiche UID oder eine
ungetestete Sandbox sind keine Isolation.

Reihenfolge allein beweist keine Bereitschaft: API und Eingang pruefen ihre
jeweiligen Voraussetzungen mit zeitlicher Grenze. Bei belegten Ports,
fehlenden Dateien, ungueltiger Netzbegrenzung oder Zertifikaten wird der
eigene Start abgebrochen. Ollama bleibt eine externe Abhaengigkeit; weder Start, Restart,
Stop noch Konfiguration des Ollama-Dienstes sind Teil des Owli-Betriebs.
Ausfall fuehrt zu nachvollziehbaren Fehlern und manuellem oder begrenztem
Retry, nicht zu unbegrenzten Neustartschleifen.

Die Serverinfrastruktur und ihre Dokumentation gehoeren in das private
KI-Server-Repository. Dessen Vorgehen verlangt kleine, nachvollziehbare,
idempotente Ansible-Schritte, explizite Freigabe und kein automatisches
Deployment. Das Owli-Repository darf dieses Repository nicht ohne gesonderte
Freigabe veraendern. Uncommittete fremde Aenderungen dort bleiben erhalten.

Die geplanten Host-Aenderungen muessen nach fertig vorbereitetem und
reviewtem Stand einzeln freigegeben werden:

1. Ein dediziertes Dienstkonto ohne Login und ohne administrative Gruppen
   und ausschliesslich eigene private Konfiguration, kopierte vorhandene
   Zertifikate, gepruefte STT-Umgebung und Build unter `/var/lib/owli/`
   anlegen. Rechte fuer das Dienstkonto pruefen; bestehende Dateien,
   /tmp-Originale und Backups bleiben erhalten.
2. Ausschliesslich die drei neuen Unit-Dateien unter
   `/etc/systemd/system/` installieren, `systemctl daemon-reload` und
   nach gesonderter Deployment-Freigabe gezielt diese Units aktivieren und
   starten. Bestehendes User-Lingering bleibt unveraendert. Ein eventuell
   vorhandener Konto- oder Namenskonflikt stoppt die Aktion.
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
eigenen Units mit `systemctl disable --now` gezielt stoppen und
deaktivieren, nur ihre eigenen Unit-Dateien nach Pruefung entfernen und
`systemctl daemon-reload` ausfuehren. Das Dienstkonto und private
Dateien bleiben bis zur separaten Entscheidung erhalten. Keine anderen
Dienste, Lingering, Netzregeln, Zertifikate, Windows-Vertrauen, Modellkopien
oder Backups veraendern. Rollback eines Updates erfolgt durch dokumentierten
Wechsel auf den vorher gesicherten Projektstand nach erneuter Freigabe.
SSH-Localhost-Forwarding bleibt der Fallback.

## Nachweise vor Freigabe

- Mock-CI und unabhängiger Review: Schutz statischer Dateien und der API
  durch die konfigurierte Netzgrenze, Rate-Limit, Cross-Site-Request-Schutz,
  ungueltige oder fehlende Netzkonfiguration, Timeouts, keine Secret-Leaks,
  Loopback-Upstreams, Portkonflikte und kontrolliertes Stop-/Restart-Verhalten.
  Keine Behauptung, dass damit einzelne LAN-Geraete authentifiziert werden.
- In isolierter lokaler Umgebung ohne echte Modelle: reproduzierbarer
  Build, explizite Betriebskonfiguration, Dienstdatei-Syntax und Fehlerszenarien.
- Erst nach gesonderter Aktivierungsfreigabe: mehrere eigene Start-/Stop- und
  Neustartlaeufe, Ollama/Hermes vorher/nachher unveraendert, lokale und
  Windows-HTTPS-Zertifikatspruefung, Mic/Transkript/Stop/TTS/Idle und
  Nutzerabnahme. Der vorhandene Phase-6-Nachweis ersetzt diese neue Abnahme nicht.
