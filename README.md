# Week 03 — Multi-subnet network topology and load balancing

A local Docker Compose lab with two Node.js backends, two bridge subnets, and a dual-homed Nginx reverse proxy. Only Nginx publishes a host port. The browser console and command-line tests show which backend handled each request.

**GitHub repository:** [ching202/week03-network-loadbalancer](https://github.com/ching202/week03-network-loadbalancer)

**Verification status — PASS:** On November 3, 2026, all 11 Docker integration checks passed: 93 measured API requests, zero failures, 5/5 initial round-robin distribution, successful failover/recovery, and rejected direct backend access. A separate live browser test returned another 10 successful requests, split 5/5, with no captured console errors or warnings. Six local backend/QA tests also passed. See [QA status](docs/qa-status.md), the [integration result](evidence/qa-latest.json), and [browser evidence](evidence/browser-check.json).

## Architecture

```text
 Host browser / terminal
 http://127.0.0.1:80
          |
          | ONLY published port: 127.0.0.1:80 -> container :80
          v
 +---------------- public_subnet -------------------------+
 | 172.28.10.0/24                                        |
 |                 +-------------------+                 |
 |                 | Nginx :80         |                 |
 +-----------------| public interface  |-----------------+
                   | private interface |  Only dual-homed service
 +-----------------| round-robin pool  |-----------------+
 |                 +---------+---------+                 |
 |                           |                           |
 |                +----------+----------+                |
 |                v                     v                |
 |       backend1:3000          backend2:3000              |
 |       ID: Backend-1          ID: Backend-2              |
 |       no host port          no host port               |
 |                                                       |
 | 172.28.20.0/24 · internal: true                         |
 +---------------- private_subnet ------------------------+
```

Container IPs are assigned dynamically. Nginx uses Docker service names and the embedded resolver at `127.0.0.11`. The two CIDRs above are defaults and can be changed in `.env` if they overlap with a VPN or existing network.

`private_subnet` has `internal: true`, and neither backend joins `public_subnet`. `expose: 3000` documents the container port; it does not publish a host port or impose an access-control rule. The public bridge and the single published gateway port provide host ingress. The default binding is loopback for this local assignment, so there is no internet demo URL. [Compose network reference](https://docs.docker.com/reference/compose-file/networks/)

**Boundary scope:** This protects the application from ordinary external clients and containers attached only to the public bridge. The Docker daemon/host administrator is trusted. Native Linux hosts can generally reach bridge container IPs even when ports are unpublished; Docker Desktop puts its Linux containers behind a VM. A refused `localhost:3001` connection alone does not prove complete isolation. The QA suite also inspects real port bindings and probes actual private IPs from a public-only container. [Docker bridge behavior](https://docs.docker.com/engine/network/drivers/bridge/) · [Docker Desktop networking](https://docs.docker.com/desktop/features/networking/)

## Prerequisites and setup

- Docker Desktop running **Linux containers**, or Docker Engine with the Compose v2 plugin. [Docker Desktop installation](https://docs.docker.com/desktop/)
- Node.js 24 LTS on the host for the dependency-free QA scripts. [Node.js](https://nodejs.org/en/download)
- A free host port 80 and nonoverlapping private address ranges.

On this Windows machine, double-click **Run lab.cmd** in this folder to start the containers, run the integration suite, and save evidence. Keep other browser/API clients idle during its round-robin test.

Alternatively, open a terminal in this repository and run:

```sh
docker version
docker compose version
docker compose config --quiet
docker compose up --build -d --wait
docker compose exec -T load-balancer nginx -t
docker compose ps
```

Open **http://127.0.0.1/** and press **Send 10 requests**. Both counters should increase by five when both backends are healthy and no other client is making API requests. Static assets and `/healthz` are served directly by Nginx, so they do not consume balancing turns.

If port 80 is occupied, copy `.env.example` to `.env`, change `LB_PORT=8080`, and run `docker compose up -d --wait`. Open `http://127.0.0.1:8080/`. The integration QA script detects the published port automatically; supply that URL to the manual request script.

PowerShell: `Copy-Item .env.example .env`. Bash: `cp .env.example .env`.

Images use the maintained `nginx:1.30-alpine` and `node:24-alpine` release families rather than `latest`. These tags can receive patch updates; they are not immutable digests. No npm installation is needed.

## Endpoints

| URL | Purpose |
| --- | --- |
| `/` | Browser traffic console, served by Nginx |
| `/api/whoami` | Balanced JSON: `instanceId`, `hostname`, timestamp, request ID |
| `/healthz` | Nginx liveness; 200 even if both backends are down |
| `/readyz` | Proxied backend health; succeeds if at least one backend answers |
| Backend `/healthz` | Container-local application health, used by Compose |

The Node.js app serves GET and HEAD only. It returns `Cache-Control: no-store`, `X-Backend-Id`, and `X-Backend-Connection`. Nginx adds `X-Request-Id` and passes it to the backend for log correlation.

## Load balancing and failover

Equal server weights and the absence of `least_conn`, `ip_hash`, or another selection directive select the default round-robin algorithm. A single Nginx worker makes this small lab's sequential alternation easy to demonstrate. Keep-alive reuses TCP connections while requests continue rotating. Dynamic `resolve` plus a shared upstream `zone` handles Docker DNS changes; open-source Nginx supports this combination from 1.27.3 onward. [Nginx upstream reference](https://nginx.org/en/docs/http/ngx_http_upstream_module.html)

`max_fails=1 fail_timeout=3s` temporarily excludes a failing peer. Explicit connection/read timeouts and `proxy_next_upstream` allow eligible failed GETs to try the other peer, with at most two attempts. After the failure window, requests can try the recovered peer again. Compose health checks gate initial startup and report health; Nginx's ongoing peer detection is passive, not subscription-only active health checking.

**The measurable target is zero observed failed GET requests during the demonstrated single-backend outage.** This is not an unconditional zero-downtime guarantee. Nginx cannot recover a response already partly sent to the client, both backends can fail, and this lab has only one load balancer. Buffering helps with these small responses but cannot guarantee replay of every failure. The configuration does not enable replay of non-idempotent requests. [Nginx retry limits](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_next_upstream)

## Run the QA suite

Pause other API clients first. The integration test intentionally stops **this Compose project's backend1**, measures requests during the stop, and restores it. It does not change host firewall rules.

```sh
node --test --test-reporter=tap tests/backend.test.mjs
node scripts/qa.mjs
```

The integration suite checks:

1. Resolved Compose configuration, actual network membership, subnet ranges, and actual host port bindings.
2. `nginx -t`, gateway liveness, and backend readiness.
3. Ten consecutive requests with exactly five responses per backend and alternating identifiers.
4. Client and upstream connection reuse, request IDs, and cache headers.
5. Sixty requests spanning a forced backend stop, then twenty requests that must all reach Backend-2. The client does not retry failed requests.
6. Backend-1 recovery without restarting Nginx.
7. Rejected host TCP connections to ports 3000, 3001, and 3002.
8. A public-only container that reaches Nginx but cannot open TCP connections to either real private backend IP. A private-network positive control also verifies backend-to-backend health access.

Results and every measured API request are written to `evidence/qa-latest.json`. A nonzero exit code means failure or a blocked prerequisite, not success. The suite restores backend1 on normal test failures; if the script is force-terminated, run `docker compose start backend1` yourself. Browser Console/Network inspection remains a manual step.

### Short commands for your live demonstration

```sh
node scripts/requests.mjs 10
docker compose stop -t 0 backend1
node scripts/requests.mjs 20
docker compose start backend1
```

Wait roughly 5–10 seconds for application health and the passive failure window, then run:

```sh
node scripts/requests.mjs 10
docker compose logs --tail 30 load-balancer
```

For a nondefault host port: `node scripts/requests.mjs 10 http://127.0.0.1:8080`.

In **Windows PowerShell**, use `curl.exe`, since `curl` may be an alias in older shells:

```powershell
curl.exe -i http://127.0.0.1/healthz
curl.exe -i http://127.0.0.1/readyz
curl.exe --noproxy "*" --connect-timeout 2 http://127.0.0.1:3001
docker compose port backend1 3000
```

The direct port request should fail to connect, and `compose port` should report that the backend has no published mapping. On Bash, use `curl` instead of `curl.exe`. Substitute the gateway port if configured differently. If another program already uses port 3001, identify it; that result alone does not establish a Docker leak.

Open browser DevTools, clear the Console, and filter Network by `whoami`. Send ten requests. Check 200 responses, the returned identifiers, response headers, and no console errors. Enable the Network **Connection ID** column when available, or inspect Nginx's `connection` and `connection_requests` log fields. Repeated backend connection IDs provide upstream reuse evidence.

### Stop and clean up

```sh
docker compose stop
docker compose start
docker compose down --remove-orphans
```

`stop` preserves containers and networks; `start` starts those containers again. `down` removes this project's containers and networks. Built images and saved evidence remain. Do not use `docker system prune` for this assignment.

## AI disclosure, exact prompt appendix, and audit

**Tool used:** OpenAI Codex. The user supplied the assignment as an attachment, including its sample architecture prompt. [ai/user-input.txt](ai/user-input.txt) preserves the assignment instructions and embedded prompt exactly, with LMS grade/status and other submission metadata omitted from this public copy. The original attachment remains local. The sample prompt was not separately submitted as a second user message. Subsequent requests are recorded in [the follow-up prompt log](ai/audit.md).

Codex generated the baseline files, final implementation, audit notes, tests, and documentation. The baseline is preserved in [ai/initial-compose.yaml.txt](ai/initial-compose.yaml.txt) and [ai/initial-nginx.conf.txt](ai/initial-nginx.conf.txt). These are review artifacts and are not loaded by Compose. See [the audit and prompt log](ai/audit.md).

The baseline correctly separated backend network membership, avoided backend host port publication, used service names, and selected round-robin. The review identified that the private bridge lacked `internal: true`, that Nginx lacked runtime DNS refresh, and that failover timing depended on default timeout/retry behavior. The final files add those controls and health checks.

This is an **AI-assisted audit**, not a claim that the student independently found or manually patched these issues. Before submission, inspect the original and final files, run the tests yourself, and describe your actual verification in your own words. Record any additional prompts and corrections you make. Do not label pending runtime checks as passed.

## QA test summary and submission

| Requirement | Current evidence |
| --- | --- |
| Backend responses, health, request IDs, HTTP reuse, error handling | PASS: six local tests; [TAP output](evidence/backend-tests.tap) |
| Public/private declarations, no backend `ports` | PASS: actual network membership and port bindings inspected |
| Nginx syntax and service-name routing | PASS: `nginx -t` and live requests; changed-IP rediscovery not separately exercised |
| Ten-request round-robin distribution | PASS: alternating 5/5 responses |
| Failover without observed dropped requests; rejoin | PASS: 60 requests spanning stop, 20/20 to survivor while down, both peers observed after restart |
| Host-port and cross-subnet negative tests | PASS: host ports 3000/3001/3002 refused; public-only connections to both private IPs timed out |
| Live browser and Console | PASS: 10 HTTP 200 responses, 5/5 split, zero captured warnings/errors; DevTools Network walkthrough still to record |
| GitHub repository and webcam + screen video | Public repository linked above; video still to record |

Use [docs/video-outline.md](docs/video-outline.md) for a 6:20 recording plan and [docs/submission-template.md](docs/submission-template.md) for the LMS text. Local Docker is accepted by the supplied assignment, so use **N/A - Local Docker Topology** for the live URL.

To obtain a fresh copy from GitHub:

```sh
git clone https://github.com/ching202/week03-network-loadbalancer.git
cd week03-network-loadbalancer
docker compose up --build -d --wait
```

The initial integration run was launched by the user through `Run lab.cmd`, because Codex's restricted shell could not access Docker's Windows named pipe. Codex inspected the saved results and performed the browser check. Review the evidence and repeat the live commands for your own recording. Verify the repository and unlisted/public video links work for your grader. This local lab uses HTTP; it does not implement TLS, a WAF, or redundant load balancers.
