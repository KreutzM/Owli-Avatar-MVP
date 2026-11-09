# Vuena visual comparison (local only)

This deterministic Playwright harness compares the unchanged app framing with an oblique camera and a theoretical threefold jaw gain. The latter reaches the model's sampled `Call` clip maximum at half input, but visual inspection still did not show a clearly legible beak opening at the normal UI size. No runtime change is retained in `main.ts`; geometry or rig changes may be needed and require separate approval. The GLB and rig are untouched. All API paths are intercepted; the test Vite config has no API proxy.

Prerequisites: provide the ignored `public/models/vuena-owl.glb`, and make the existing web `node_modules` available in this worktree. Chromium and ffmpeg must be present; set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` and `PLAYWRIGHT_BROWSERS_PATH` to local existing paths.

From `apps/web`, run:

```sh
./node_modules/.bin/playwright test tests/visual26/variants.spec.ts --config playwright.visual26.config.ts
```

Screenshots and metrics are written only to `/tmp/owli-visual26`. The captured video is silent: it records deterministic jaw poses, not physical or synthesized speech. Real Windows HTTPS visual/audio acceptance is still required.
