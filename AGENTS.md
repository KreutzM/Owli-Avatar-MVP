# Agent instructions — Owli Avatar MVP

## Mission / current state
Build a local-first browser 3D owl avatar that listens/reads, sends text to an LLM, speaks TTS output and animates the beak. Eventually replace the test owl with the Owli mascot without rewriting the application. The repository currently contains **scaffolding only**; never report a working app, tested model, installed dependency, or server deployment until actually verified.

## Decisions (do not re-litigate casually)
- Browser: TypeScript + Three.js + Vite; no Unreal/React for MVP by default.
- Backend: Python + FastAPI with swappable LLM/TTS/STT providers. Existing Ollama is intended; initial tests run with mocks.
- Audio: use the Web Audio playback clock/envelope for MVP beak movement; distinguish amplitude sync from true viseme/phoneme lip sync.
- 3D asset import/inspection: Blender headless offline; runtime format GLB/glTF. Never couple app logic to vendor bone names. Support explicit capabilities and unavailable-control fallbacks.
- Server infrastructure belongs in the separate KI-Server repo; do not modify its services/config from here.
- No database, container platform, or real-time transport until a measured requirement justifies it.

## How to work
1. First identify the narrow task and relevant files. Read `docs/roadmap.md` for milestone scope; consult architecture/contracts/assets/server docs **only when involved**. Avoid whole-repo dumps and unrelated history.
2. Terra (`gpt-6.1-terra`) is the coordinator/integrator. Delegate bounded reconnaissance, docs/source verification, isolated minor edits and independent review to `gpt-6-luna` agents when that saves main-agent context. For tiny tasks, work directly.
3. Give subagents a self-contained question, exact file ownership, constraints, expected checks, and a short return format. Max two unfinished subagent threads; do not recursively delegate; do not let agents write the same file concurrently.
4. Main agent owns architecture decisions, integration, PRs and final verification. A Luna reviewer is advisory; treat complex cross-component/security concerns as requiring additional main-agent verification. No agent's confidence substitutes for a test.
5. Prefer focused diffs, executable tests and reproducible evidence. One functional concern per PR when practical. Read `docs/codex-workflow.md` for larger work, review cap and handoffs.
6. Progress reports: concise facts, exact tested/unverified scope, commit/PR links, blockers and next action. Never fabricate output or say a mock proved a live integration.

## Safety and approval boundaries
- Public repository: do not commit secrets, .env, private models/voices, audio recordings, personal data, private KI-Server metadata or downloaded third-party assets without licensing verification.
- Reading code/docs and running non-destructive local tests in this checkout is permitted. Download/install dependencies, launch workloads or modify other systems only within the user's applicable approval scope.
- Ask for explicit approval before deploying/starting network-facing services, changing SSH/firewall/network/boot/drivers/GPU settings, system-wide package installs, operating-system upgrades, destructive cleanup or writing to KI-Server.
- No automatic deploy on commit/merge. GitHub Actions may run isolated tests but must not contact the home server.
- The browser should not call Ollama directly or expose inference endpoints/tokens; API validates requests, duration, size, rate/timeout limits; microphone only with permission in a secure context.

## Definition of done (per change)
- Contract and behavior updated when needed, relevant tests added/executed, failures reported honestly.
- Changed files are scoped; git diff checked for secrets/licenses/unrelated changes.
- Asset claims require real import and browser-side validation, not metadata alone.
- Live LLM/TTS/STT, visual quality and timing need separate server/browser evidence.

