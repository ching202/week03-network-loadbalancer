# Screen + webcam recording plan — target 6:20

Keep your face and screen visible together for the entire recording. Use these as talking points; rehearse and explain the results in your own words. The assignment requires a duration between 5:00 and 7:00.

Before recording, start Docker Desktop, pull/build images, run the full QA script, and fix any failures. Keep the terminal font large. Close unrelated tabs and background API clients. Open the README diagram, baseline snapshots, final Compose/Nginx files, the browser traffic console, and DevTools. Avoid spending the recording downloading images.

| Time | Screen action | Explanation to give |
| --- | --- | --- |
| 0:00–0:40 | Show README architecture diagram. | Trace host port 80 to Nginx, then to backend1 or backend2 on port 3000. Name both subnet ranges and explain why Nginx has two interfaces. |
| 0:40–1:30 | Compare the baseline and final Compose files; show the Nginx retry block. | Disclose Codex assistance. Point to the omitted `internal: true` flag in the baseline and explain the correction. Describe the checks you personally performed. Do not claim you independently discovered an AI-authored audit finding unless you did. |
| 1:30–1:55 | Run `docker compose up --build -d --wait`, then `docker compose ps`. | Show the running services and health status. Explain that only Nginx publishes a host port. |
| 1:55–2:35 | Run `node scripts/requests.mjs 10`. | Read the alternating Backend-1/Backend-2 identifiers and the measured 5/5 count. Explain equal-weight round-robin and why the requests are stateless. |
| 2:35–3:15 | Browser: send ten requests, inspect Network headers and Console. | Show HTTP 200, no errors, backend identity, no-store, and request ID. Explain that keeping a TCP connection open does not pin every HTTP request to one backend. |
| 3:15–3:45 | Run `docker compose stop -t 0 backend1`, then `node scripts/requests.mjs 20`. | Show zero failed requests and Backend-2 only if those are the actual results. Explain retries and temporary passive exclusion. |
| 3:45–4:15 | Run `docker compose start backend1`; allow the health/failure window to settle; send ten more requests. | Show both identifiers again. Nginx was not restarted. If the results differ, explain the observed failure and fix it before recording a final take. |
| 4:15–4:45 | Run the direct host-port curl and `docker compose port backend1 3000`; show the saved public-only probe result. | Explain refused direct access, no published backend ports, and why the cross-subnet test is stronger evidence than a closed localhost port alone. |
| 4:45–5:15 | Show `/healthz`, `/readyz`, `docker compose logs --tail 30 load-balancer`, and `evidence/qa-latest.json`. | Distinguish gateway liveness from application readiness. Point out upstream addresses, retry statuses, and the actual suite result. |
| 5:15–6:20 | Return to diagram and speak to camera. | Summarize traffic distribution, the reduced public attack surface, service discovery, and the value of testing AI-generated infrastructure. State the limits: one Nginx instance remains a single point of failure; HTTP/TLS and partial-response retry limits matter for production. |

## Commands to have ready in PowerShell

```powershell
docker compose up --build -d --wait
docker compose ps
node scripts/requests.mjs 10
docker compose stop -t 0 backend1
node scripts/requests.mjs 20
docker compose start backend1
# Allow roughly 5–10 seconds before showing the recovered distribution.
node scripts/requests.mjs 10
curl.exe --noproxy "*" --connect-timeout 2 http://127.0.0.1:3001
docker compose port backend1 3000
curl.exe -i http://127.0.0.1/healthz
curl.exe -i http://127.0.0.1/readyz
docker compose logs --tail 30 load-balancer
```

If using port 8080, pass `http://127.0.0.1:8080` to the request script and use it for gateway URLs. Keep the backend negative-test port at 3001. A failed curl is the expected outcome only for the backend port test.

The full `node scripts/qa.mjs` run also measures requests while Docker is stopping the node. Run it before recording and show its saved evidence; the shorter manual sequence alone only demonstrates traffic after the node has stopped.

After recording, review the whole video for face visibility, legible text, audio, actual test results, and 5–7 minute duration. Upload it with permissions that let the grader watch it. Replace the template timestamps with the actual timestamps if your pacing differs.
