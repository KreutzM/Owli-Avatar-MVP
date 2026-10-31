# 3D-Assets — Import, Lizenz, Reproduzierbarkeit

Das freigegebene Modell ist das unveränderte Vuena-Sample `GLB/animal_owl.glb`.
Die lokale Bereitstellung aus dem vorhandenen Archiv ist im README beschrieben;
das GLB wird nicht mit Git verteilt. Original-GLB SHA-256:
`0c445b7364fcf88b81c8300e4b953947bc911ee4dff2d51bb6a81fa7ceda0a22`.
Eine öffentliche Weitergabe des Assets erfordert separate Rechteprüfung.

## Vor einem Import
1. Originalseite, Rechteinhaber, exakte Datei/Version, Erwerbs-/Lizenzbedingungen, Download-Datum, SHA-256 und Quellen-URL in `assets/manifests/*.json` dokumentieren.
2. Kostenfrei bedeutet **nicht** zwingend frei weiterverteilbar; CC0-Angaben anhand Original-Lizenztext verifizieren. Keine moeglichweise geschuetzten Dateien unbesehen in das **oeffentliche** Repo laden.
3. Heruntergeladene Quellen lokal in `assets/downloads/` (gitignored), prozessierte GLB in `assets/processed/` (gitignored). Pruefberichte und kleine nicht-sensitive Screenshots erst nach Sichtpruefung einchecken.
4. Blender 4.5 LTS headless: Mesh, Armature, Bones, Actions/Clips, Texturverweise, UV, Koordinaten, Massstab, Beak und Blink inspizieren; Export-GLB validieren.
5. GLB in Three.js laden: Animation, Farben, Ausrichtung, Skins, Schnabelsteuerung, Konsolenausgaben und Frame-Time visuell/browsertest pruefen.
6. Namen von Bones/Clips nur im **modellbezogenen Adapter/Manifest** verwenden. Unabhaengige Mundbewegung gegen laufende Idle-Animation testen.

## Manifest-Felder (Vorlage)
`id`, `source_url`, `license_url`, `license_identifier`, `downloaded_at`, `source_version`, `original_filename`, `sha256`, `files`, `animation_clips`, `rig_controls`, `validation`. Keine fingierten Werte eintragen; fehlende Fakten als unbekannt notieren.

## Rechtshinweis
Modellassets, Sprachmodelle, Stimmgewichte und generierte LoRA-Dateien besitzen eigenstaendige Lizenzen und ggf. persoenlichkeitsrechtliche Einschraenkungen; separat pruefen. Auch Piper-Core-Paketwahl/-Lizenz vor Redistribution klären.

