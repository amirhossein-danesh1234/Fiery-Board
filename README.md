# Fiery Board — تخته آتشین

A lightweight RTL Persian group-scoring application built with native Node.js 24, SQLite and plain browser JavaScript. No frontend build step or third-party runtime packages required.

## Live flows

**Admin:** `https://fb-admin.amirhossein-danesh.ir`

- Password-protected setup dashboard, variable number of participants, named voters, questions and positive weights.
- Secure access codes are displayed once, with only SHA-256 digests persisted.
- Previous games and completed-game result reports.

**Voters:** `https://fiery-board.amirhossein-danesh.ir`

- Code-only login, one active device per code, auto-start waiting room.
- Strict synchronized step-by-step voting: question 1 for each participant, then question 2, etc.
- Every stage requires one irrevocable score between 0 and 10 (decimals accepted) from **every voter** before advancing. Atomic transaction is the authority; UI polls every five seconds.
- Automatic navigation to results after the final stage.

**Results:** `/results` on both domains (authenticated admin via `?game=<id>` on admin host, logged-in voters on public host).

- Ranked weighted final score per participant.
- `جزئیات نمرات` tab: question, weight, per-question average and weighted contribution.
- `مشاهده آرا` tab: per-voter rows and per-question columns for selected participant, with question averages.
- Public individual vote visibility is controlled by the game's `showIndividualVotes` configuration; administrators can see the full report. CSV export follows the same rule.
- No chart comparison or game-settings tabs.

## Data model

All data lives in one persistent SQLite database, shared by the two hostnames. The `games` table keeps a `current_stage` integer migrated at startup if missing. Votes have database-level uniqueness per (game, voter, participant, question), and stages advance atomically in `BEGIN IMMEDIATE` transactions. Weighted score formula:

`S(person) = Σ(question_weight × mean(voter_scores)) / Σ(question_weight)`

Rounding applies to display; calculation uses the unrounded averages. Completed games must contain every expected vote; partial runs do not produce final results.

## Local verification

Requires Node.js 22.13+ (production Docker uses Node 24):

```bash
export ADMIN_PASSWORD='your-own-long-random-admin-password'
export ADMIN_ORIGIN='http://localhost:3108'
export VOTER_ORIGIN='http://localhost:3108'
export DB_PATH='./data/fiery-board.sqlite'
node --test
node server.mjs
```

Development paths: `/` admin, `/vote` voter and `/results?admin=1&game=<id>` admin results. The hostnames enforce their respective landing pages in production.

## Deployment: existing Linux host and reverse proxy

1. Add DNS A (and optionally AAAA) records for both `fb-admin.amirhossein-danesh.ir` and `fiery-board.amirhossein-danesh.ir` pointing at the actual web server.
2. Pull the repository. Create a private `.env` from `.env.example` and fill **only** `ADMIN_PASSWORD` with a secure random value; never commit secrets.
3. Run `docker compose up -d --build`. The app listens on host `127.0.0.1:3108`; persistent volume is `fiery_board_data`.
4. Merge the two blocks in `deploy/nginx.conf` into the existing Nginx configuration (avoid duplicate `server_name` blocks). Test with `nginx -t`, reload, then issue HTTPS certificates using `certbot --nginx -d fb-admin.amirhossein-danesh.ir -d fiery-board.amirhossein-danesh.ir`.
5. Confirm both `/healthz` URLs, create a sample game in admin, open distinct private-window voter logins with the issued codes, complete all questions, verify final results in both authenticated interfaces, and restart the container to verify persistence.

Both hostname routes are ready **in code**. DNS/TLS/reverse proxy/server deployment require server access and are not performed by merging a GitHub commit. If using Caddy or another existing proxy, route both hostnames to `127.0.0.1:3108` and preserve the `Host` header; do not deploy a second proxy on ports 80/443. No application-source edits are needed for these deployment steps.

## Security and operational notes

- Admin session cookies and voter session cookies are HttpOnly, SameSite=Strict, with Secure on HTTPS. Cross-origin requests are rejected for state-changing APIs.
- Host-based routing prevents the admin UI/API from being served through the public hostname.
- One active voter session is enforced for each access code, but this does not prove that one person holds only one code; distribution remains an organizer responsibility.
- A lost access code cannot be recovered as plaintext. Back up issued codes securely when creating the game.
- Voter presence times out after about 45 seconds; a returning voter retains prior immutable votes.
- Large games generate many votes (participants × questions × voters). The present implementation is intended for modest group sessions; performance limits should be load-tested before hundreds of users.
- Back up the Docker volume including WAL; never delete it during routine redeployments.
