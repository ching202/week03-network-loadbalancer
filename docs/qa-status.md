# Verification record — live tests passed

Verified November 3, 2026, on Windows 11 Home (build 26300.9818), using Docker Desktop's WSL 2 Linux-container backend.

## Observed integration results

The user launched `Run lab.cmd` from File Explorer. This was necessary because Codex's restricted shell could not access Docker's Windows named pipe. Codex reviewed the resulting JSON report, container status, logs, image IDs, and subsequent live browser behavior.

The integration run began at **7:06:56 p.m. Eastern** and finished at **7:07:24 p.m. Eastern**. UTC timestamps are preserved unchanged in [qa-latest.json](../evidence/qa-latest.json).

| Phase | Requests | Observed result |
| --- | ---: | --- |
| Initial round-robin | 10 | Alternated; Backend-1: 5, Backend-2: 5 |
| Traffic spanning forced backend1 stop | 60 | All HTTP 200; zero failed requests |
| Backend1 stopped | 20 | All HTTP 200 from Backend-2 |
| Recovery sampling | 3 | Both IDs reappeared; Nginx was not restarted |
| **Integration API total** | **93** | **Zero failed requests** |
| Separate live browser test | 10 | All HTTP 200; 5/5 split; no captured console warnings/errors |

Health checks and network positive controls are additional checks and are not included in the 93 sampled API requests.

## Completed checklist

- [x] `docker compose config --quiet` passed; [resolved configuration](../evidence/resolved-compose.json) saved.
- [x] Three services started and reported healthy; [container status](../evidence/containers.txt) saved.
- [x] `nginx -t` passed inside the actual load-balancer container.
- [x] Ten sequential requests alternated 5/5.
- [x] Sixty requests spanning the stop returned HTTP 200.
- [x] Twenty requests while backend1 was stopped reached Backend-2 only.
- [x] Backend-1 rejoined automatically without restarting Nginx.
- [x] Neither backend had published host ports or a public-subnet interface.
- [x] Host ports 3000, 3001, and 3002 each returned `ECONNREFUSED`.
- [x] A public-only client reached the gateway, but connections to `172.28.20.2:3000` and `172.28.20.3:3000` both timed out.
- [x] A private-network positive control reached backend2 from backend1.
- [x] Gateway `/healthz` and application `/readyz` returned HTTP 200.
- [x] The QA client reused its TCP connection; upstream connections were reused per backend.
- [x] Request IDs propagated correctly and backend responses used `Cache-Control: no-store`.
- [x] Live browser test returned ten HTTP 200 responses; captured console warnings/errors were empty.
- [x] Saved [browser JSON](../evidence/browser-check.json), [browser screenshot](../evidence/browser-round-robin.jpg), and [container logs](../evidence/container-logs.txt).
- [ ] Show DevTools Network headers/statuses and the full screen + webcam demonstration in the student's recording.
- [x] Public GitHub repository: [ching202/week03-network-loadbalancer](https://github.com/ching202/week03-network-loadbalancer).
- [ ] Record and publish the video, then fill in its submission link.

The integration report's `manualBrowserChecks` field was written before the browser check; the later browser JSON records that separate verification. The video remains a student task.

## Environment and reproducibility

- Docker Desktop: **4.98.0 (245422)**
- Docker Engine/CLI: **29.9.2**; [version record](../evidence/docker-version.txt)
- Docker Compose: **v5.6.1**; [version record](../evidence/compose-version.txt)
- WSL: **3.0.3.0**, Linux kernel **6.18.54.1-1**
- Images: `nginx:1.30-alpine`, `week03-backend:local` built from `node:24-alpine`; [actual image IDs](../evidence/images.json)
- Gateway: **http://127.0.0.1:80/**
- Public subnet: **172.28.10.0/24**
- Private subnet: **172.28.20.0/24**, internal
- Local Node.js backend/QA unit tests: **6 passed**; [TAP output](../evidence/backend-tests.tap)

Run `node scripts/qa.mjs` or double-click `Run lab.cmd` to repeat the integration test. Pause other API clients so the strict sequential round-robin check measures an uncontended pool. The test restores backend1 on normal failure and leaves the project running.

## Limits of these results

Zero failures were observed in this measured single-backend outage; this is not an absolute guarantee for arbitrary failures or partially delivered responses. The Docker host administrator remains trusted, and one load balancer is still a single point of failure. Stop/start recovery was tested; an IP-changing container replacement was not separately exercised. Precise end-to-end recovery time was not recorded. The local demonstration uses HTTP and has no TLS configuration.
