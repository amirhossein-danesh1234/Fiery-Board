# Fiery Board — Admin MVP

Self-hosted Persian RTL admin panel for a synchronized group rating game. This repository currently implements **the admin page only**; voter login, live voting and results screens are future pages. The application is deployable as-is and does not pretend that voting is already implemented.

## Features
- Single responsive, sidebar-free dashboard matching the approved design.
- Create a game with variable participants, weighted questions and named voters (1–500 of each).
- Cryptographically random voter access codes shown **once** after creation; only SHA-256 hashes are stored in SQLite. Export them to CSV before closing the modal.
- Persist created games and their related participants/questions/voters in a server-side SQLite volume.
- Search and filter game history; view details. New games are saved as `draft` until the future live voting flow exists.
- Password-protected admin session via secure HttpOnly cookie. State-changing endpoints enforce `Origin` matching.
- Built-in Node.js HTTP server; no frontend build, npm install, third-party runtime dependency or code generation required.

## Local start
Node.js >= 22.13:

```bash
export ADMIN_PASSWORD='your-strong-unique-password'
export PUBLIC_ORIGIN='http://localhost:3108'
export DB_PATH='./data/fiery-board.sqlite'
node server.mjs
# http://localhost:3108
```

`node --test` runs unit and HTTP integration tests.

## Production deployment (existing Linux server + Nginx)
1. Point the DNS `A`/`AAAA` record for `fb-admin.amirhossein-danesh.ir` to the server's public IP (only add AAAA if IPv6 works).
2. Clone this repo on the server and set a strong `ADMIN_PASSWORD` in a local `.env` file (see `.env.example`, **do not commit it**).
3. Run `docker compose up -d --build`. The container listens only at `127.0.0.1:3108` on the host, avoiding conflicts with existing services; the SQLite database lives in the persistent Docker volume `fiery_board_data`.
4. For a host running Nginx, copy `deploy/nginx.conf` to `/etc/nginx/sites-available/fb-admin.amirhossein-danesh.ir`, link it under `sites-enabled`, run `nginx -t && systemctl reload nginx`, then `certbot --nginx -d fb-admin.amirhossein-danesh.ir` to provision/enable HTTPS. Certbot must complete successfully; keep HTTPS enabled before production use.
5. Check `https://fb-admin.amirhossein-danesh.ir/healthz` for `{ "ok": true }`, then open the dashboard and log in.

No source-code changes are required. DNS, TLS and a suitable reverse-proxy route are **external deployment steps**, not things a GitHub commit can configure on its own. If host ports 80/443 are already handled by another proxy, add a route to `127.0.0.1:3108` to that proxy instead of installing a second listener. Never expose port 3108 publicly.

### Deployment acceptance checks
- `docker compose config` and `docker compose up -d --build` succeed.
- `/healthz` returns HTTP 200, access to `/api/games` without login returns 401.
- Login with `ADMIN_PASSWORD`, create a game with different counts of participants/questions/voters, export codes, then refresh and confirm history persists.
- Check browser at 1440px and 390px; RTL and all cards should be usable.
- Test a restart (`docker compose restart`) and verify the saved game remains visible.

## Security and product limitations
- **Access code ≠ hash:** The person receives a random bearer access code; only its hash is stored. It is not sufficient to prevent one human receiving multiple different codes. Distribute exactly one code per authorized voter; the future voting backend must enforce one active voter session per code and unique vote constraints.
- Codes are shown only at game creation, so export and distribute them securely. The admin cannot retrieve their plaintext from game history. Lost codes require a future rotation flow.
- Sessions expire after 12 hours; passwords are configured on the server, not baked into the container.
- The data model reserves a `votes` table with a unique `(game, voter, participant, question)` constraint for future implementation, but **no voting APIs or results computation** are shipped in this phase.
- Back up the Docker volume, including SQLite WAL data. Avoid manually editing the database while the app is running.
