# StoneGate Convenience Scripts

These scripts wrap the repo’s common workflows (docs generation, SDK generation, building, launching).

They are intentionally written to be runnable without executable bits:
- Use `bash scripts/<name> ...`

## Quick start (first time)

- One command setup + launch (sim backend + frontend preview):
  - `bash scripts/setup_and_launch`

Common tweaks:
- Use a different backend port:
  - `bash scripts/setup_and_launch --port 8082`
- Use the frontend dev server (HMR) instead of preview:
  - `bash scripts/setup_and_launch --frontend-mode dev --frontend-port 5173`
- Skip steps you already did:
  - `bash scripts/setup_and_launch --skip-venv --skip-plugins --skip-docs`

## Regeneration scripts

- Clean generated outputs:
  - `bash scripts/makeclean`
  - `bash scripts/makeclean --deep` (also removes `node_modules/`)

- Regenerate docs (Error_Messages.md):
  - `bash scripts/makedocs`

- Regenerate SDKs + Live Transform C++ helper build:
  - `bash scripts/makeplugins`
  - `bash scripts/makeplugins --skip-cpp` (SDKs only)

- Python environment setup:
  - Create `.venv`, install deps + install the generated python SDK:
    - `bash scripts/makevenv`
  - Install into the current environment instead of a venv:
    - `bash scripts/makevenv --current-env`
  - If you want the venv to remain active in *your current shell*:
    - `source scripts/makevenv`

- Run everything:
  - `bash scripts/makeall`

## Run scripts

- Build + start simulator backend (nohup) + build + launch frontend:
  - `bash scripts/run_sim_stack`

### Stopping / cleanup

If you started the backend via `run_sim_stack`, it runs under `nohup` and writes:
- pid: `/tmp/StoneGate.pid`
- log: `/tmp/StoneGate.log`

Stop it cleanly:
- `bash scripts/stop_sim_backend`

Check status:
- `bash scripts/status_sim_backend`

Tail backend logs:
- `tail -f /tmp/StoneGate.log`

If you launched the frontend in the foreground (default), just `Ctrl+C` it.
If you launched it with `--background-frontend`, tail its log at:
- `/tmp/StoneGate_frontend.log`

This supports skip flags for iterative dev:
- `bash scripts/run_sim_stack --skip-backend-build`
- `bash scripts/run_sim_stack --skip-frontend-install`
- `bash scripts/run_sim_stack --skip-frontend-build --frontend-mode dev`

## Notes

- Backend logs/pid defaults:
  - log: `/tmp/StoneGate.log`
  - pid: `/tmp/StoneGate.pid`
- If you already use conda (or another env manager), prefer `--current-env` over creating `.venv`.
