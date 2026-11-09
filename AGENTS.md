# Agent instructions — Owli Avatar MVP

## Mission / current state
Build a local-first browser 3D owl avatar that listens/reads, sends text to an LLM, speaks TTS output and animates the beak. The local mock chat supports the separately supplied Vuena original model; a later Owli mascot should remain interchangeable. Optional local Ollama, Piper TTS and STT integrations are implemented; actual live/HTTPS behavior still requires independent environment-specific evidence (see README.md and Epic #23). Report only verified tests, assets, dependencies and deployment.

## Decisions (do not re-litigate casually)
- Browser: TypeScript + Three.js + Vite; no Unreal/React for MVP by default.
- Backend: Python + FastAPI with swappable LLM/TTS/STT providers. Existing Ollama is intended; initial tests run with mocks.
- Audio: use the Web Audio playback clock/envelope for MVP beak movement; distinguish amplitude sync from true viseme/phoneme lip sync.
- 3D asset import/inspection: Blender headless offline; runtime format GLB/glTF. Never couple app logic to vendor bone names. Support explicit capabilities and unavailable-control fallbacks.
- Server infrastructure belongs in the separate KI-Server repo; do not modify its services/config from here.
- No database, container platform, or real-time transport until a measured requirement justifies it.

## How to work
1. Execute **one approved, narrowly scoped issue** per implementation run. The separate web-chat Sol/high planner owns architecture, issue scope, dependencies and acceptance criteria. Start from that issue and current base SHA, not from a new autonomous roadmap; read other project docs only when relevant.
2. Terra (`gpt-6.1-terra` / medium) is the lean execution coordinator: assign work, integrate, verify and report. Do not redo the external planner's architecture or add requirements. Resolve ordinary local implementation details autonomously; document architectural/contractual conflicts rather than silently widening the scope.
3. Prefer Luna agents for substantial bounded work that **replaces Terra work**: `builder` (medium) for code and focused tests, `explorer` (low) for unknown code paths, `researcher` (medium) only for concrete documentation/licensing uncertainty, `reviewer` (high) for independent findings on a fixed diff. No mandatory exploration stage and no redundant re-reading of subagent work.
4. For each delegation provide issue/goal, base SHA, allowed files and temporary resources, acceptance criteria, checks, stop conditions and a concise <=12-line handoff. Max two open subagent threads, concurrent work only if independent, no recursive delegation or overlapping writers. Explorers/researchers/reviewers must not edit; prompts alone do **not** make their inherited sandbox technically read-only.
5. Once an issue is explicitly assigned, execute its in-scope implementation, tests, review triage and Draft PR **without intermediate user approvals**. Project `workspace-write` with `approval_policy = "never"` suppresses approval prompts, but never authorizes crossing the sandbox. On a genuinely inaccessible or out-of-scope step, do permitted work and return one clear `blocked/partial` handoff instead of looping on questions.
6. The independent reviewer is **advisory**: it reports only evidenced defects against the approved scope. No demands for new features, refactoring, architecture changes, fixes or repeat reviews. Terra decides `fix / reject / defer / blocked` with reasons. A reviewer suggestion alone is not a mandatory change; objective acceptance, security, licensing and real visual/audio gates still apply. Never claim a blocked PR is ready.
7. Use targeted reads, focused tests and a final check on the current SHA; keep the main context small. For visual changes Terra checks available images/motion and records actual human design approval separately. No mock test proves a live integration.
8. Final handoff: issue, base/head, changed files, executed checks, triaged findings, unresolved risks and next step. No next Epic issue without a separate assignment or an explicitly approved batch.

## Safety and approval boundaries
- Public repository: do not commit secrets, .env, private models/voices, audio recordings, personal data, private KI-Server metadata or downloaded third-party assets without licensing verification.
- Reading code/docs, editing the assigned workspace and running non-destructive scoped tests are permitted within the issue mandate and sandbox. Downloads/installations, extra dependencies, launching network-facing services and changes to other systems are not implicitly authorized.
- Do not autonomously deploy/start network-facing services, change SSH/firewall/network/boot/drivers/GPU settings, install system-wide packages, upgrade the OS, perform destructive cleanup, or write to KI-Server. Record the need for separate authorization in the final handoff without repeated interactive requests.
- No automatic deploy on commit/merge. GitHub Actions may run isolated tests but must not contact the home server.
- The browser should not call Ollama directly or expose inference endpoints/tokens; API validates requests, duration, size, rate/timeout limits; microphone only with permission in a secure context.

## Definition of done (per change)
- Approved scope and acceptance criteria verified to the extent possible; relevant tests added/executed, failures and blocked criteria reported honestly.
- Changed files are scoped; git diff checked for secrets/licenses/unrelated changes.
- Asset claims require real import and browser-side validation, not metadata alone.
- Live LLM/TTS/STT, visual quality and timing need separate server/browser evidence; without it, mark the corresponding acceptance as pending, not passed.


