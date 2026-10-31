# ADR 0002 — Codex-Hauptagent Terra, Subagents Luna

Status: accepted for bootstrap · 2026-10-31

## Context
Ein Hauptagent soll Architektur- und Integrationskontext behalten. Unteraufgaben sollen in frischem, engem Kontext durch weniger kostspielige Agenten bearbeitet werden.

## Decision
- Hauptagent `gpt-6.1-terra` / medium.
- Standarddelegation `gpt-6-luna` / low; rollenbezogen medium/high nur bei Bedarf.
- Vier Rollen: Explorer (lesend), Researcher (lesend), Builder (gezielte Edits), Reviewer (lesend). Maximal zwei unerledigte Subagent-Threads.
- Hauptagent integriert, kontrolliert Diffs/Tests und entscheidet. Keine rekursive Delegation, kein stiller Modell-Fallback, keine parallelen Edits derselben Datei.

## Cautions
Terra wird offiziell besonders fuer Computer Use, Visual Reasoning und kleine Codefixes empfohlen; anspruchsvolle Gesamtarchitektur erfordert objektive Tests und ggf. eine spaetere, explizite Modellwahl-Revision. Subagents sind Anweisungs-/Kontextgrenzen, keine harten Dateisystem-Sandboxes. Modellzugang und tatsaechlich wirksame CLI-Konfiguration sind lokal zu bestaetigen.

## Sources
- https://developers.openai.com/api/docs/models/gpt-6.1-terra
- https://developers.openai.com/api/docs/models/gpt-6-luna
- https://developers.openai.com/codex/subagents
- https://developers.openai.com/codex/config-reference

