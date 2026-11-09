# Vuena visual comparison (local only)

This deterministic Playwright harness compares the unchanged original camera with two reversible runtime-only variants: closer/lower framing, and closer framing plus a 1.25 jaw gain. It does not edit the GLB or Rig. All API paths are intercepted; the test Vite config has no API proxy.

Prerequisites: provide the ignored `public/models/vuena-owl.glb`, and make the existing web `node_modules` available in this worktree. Chromium and ffmpeg must be present; set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` and `PLAYWRIGHT_BROWSERS_PATH` to local existing paths.

From `apps/web`, run:

```sh
./node_modules/.bin/playwright test tests/visual26/variants.spec.ts --config playwright.visual26.config.ts
```

Artifacts and metrics are written only to `/tmp/owli-visual26`. The captured video is silent: it records deterministic jaw poses, not physical or synthesized speech. Real Windows HTTPS visual/audio acceptance is still required.
