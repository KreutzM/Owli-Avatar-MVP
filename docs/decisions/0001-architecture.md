# ADR 0001 — Browser-Avatar statt Game-Engine

Status: accepted for MVP · 2026-10-31

## Context
Ziel ist eine im Browser interaktive, sprechende 3D-Eule. KI/TTS/STT laufen auf dem vorhandenen headless Ubuntu-KI-Server. Die reale Marken-Eule ist noch nicht fertig rigged.

## Decision
Three.js mit TypeScript/Vite rendert GLB direkt im Browser. FastAPI kapselt lokal gestartete Provider, Blender headless dient nur offline der Assetvorbereitung. Mocks vor Live-Providern. Charakter-Anbindung nur ueber semantische Adapter/Capabilities.

## Consequences
Kein Unreal-/GPU-Streaming-Stack oder externes Rendering erforderlich. Browser-WebGL- und Asset-Qualitaet muessen gesondert getestet werden. Echte Lippen-/Visemsynchronisierung ist keine MVP-Voraussetzung; Audio-Pegelsteuerung ist als erste Naeherung erlaubt.

## Revisit if
Messungen zeigen, dass das Browser-Rendering unzureichend ist oder vertraglich geforderte 3D-/VFX-Funktionen fehlen.

