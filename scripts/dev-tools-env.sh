#!/usr/bin/env bash
# Optional user-local tools; explicit environment settings take precedence.
if ! command -v uv >/dev/null 2>&1 && [[ -x "${HOME}/.local/share/owli-devtools/uv-0.9.17/bin/uv" ]]; then
  export PATH="${HOME}/.local/share/owli-devtools/uv-0.9.17/bin:${PATH}"
fi
if [[ ! ${PLAYWRIGHT_BROWSERS_PATH+x} && -d "${HOME}/.cache/ms-playwright" ]]; then
  export PLAYWRIGHT_BROWSERS_PATH="${HOME}/.cache/ms-playwright"
fi
