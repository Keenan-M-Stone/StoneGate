# Docker install mode

This mode builds images from a *source-included bundle* (or a repo checkout) and runs them via docker-compose.

From the bundle root:

```bash
./bin/install.sh --mode docker --docker full
```

Or backend only:

```bash
./bin/install.sh --mode docker --docker backend
```

Ports are configured via `docker/.env`.

Notes:
- The UI expects the backend at `ws://localhost:8080/status` by default.
- This flow builds the backend/frontend inside containers (no native toolchain required on the host).
