# 3D-Assets — Import, Lizenz, Reproduzierbarkeit

**Issue 3:** Die Gobkit-Eule wurde als CC0-Derivat integriert und in Blender sowie Chromium geprüft. Details und Grenzen stehen im [Manifest](../assets/manifests/gobkit-owl.json) und [Prüfbericht](verification-issue-3.md). Kandidaten:
- Vuena Cute Pets v3.0 (Anbieterbeschreibung: Bird-Rig, 12 Clips, Schnabel/Blink); Produkt-/Versions-/Lizenzstatus vor Download erneut pruefen: https://vuena.itch.io/blocky-pets-free
- Gobkit Owl GLB als leichter technischer Fallback: https://gobkit.com/freebies/animalB/Owl.glb (Lizenz/Version am Downloadzeitpunkt nachpruefen).

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

