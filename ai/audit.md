# AI prompt record and network audit

## Provenance

The initial substantive user input was the supplied assignment, including its embedded sample prompt. [user-input.txt](user-input.txt) reproduces the instructional text and prompt exactly; LMS grade/status and other submission metadata were omitted for public publication. The original attachment remains local. The user did not send separate follow-up prompts asking for the individual patches below. Codex made those implementation choices while fulfilling the assignment.

The two `initial-*` files are the baseline generated and saved during this session before the final implementation. They are review-only snapshots, not a deployed environment. The audit and revisions were also produced by Codex. They are not evidence of independent student review, and no live baseline failures were observed. The student should verify and discuss these differences personally.

## Audit findings

| Check | Baseline finding | Final change / how to verify |
| --- | --- | --- |
| Backend host port leakage | No backend `ports` mappings; `expose` only. Correct. | Retained. Inspect `HostConfig.PortBindings`, not just a closed arbitrary host port. |
| Dual homing | Only Nginx joins both bridges. Correct. | Retained. Integration script checks actual container network attachments. |
| Private outbound isolation | `private_subnet` was a normal bridge. Naming it private does not make it internal. | Added `internal: true`; validate the running network's `Internal` field. |
| Service discovery | Service names were used, but the upstream addresses were resolved at Nginx startup. | Added Docker resolver, `resolve`, and shared-memory `zone`; no static container IPs. |
| Failure handling | No explicit connect/read limits or bounded retry policy. Nginx still has default `error timeout` retry behavior; it is inaccurate to say the draft had no retries at all. | Added 1-second connect and 2-second read/send timeouts, explicit eligible statuses, two attempts, and a 4-second retry window. |
| Peer recovery | Default passive failure parameters were implicit. | Explicit `max_fails=1 fail_timeout=3s`; demonstrate stop/start and automatic rejoin. |
| Algorithm | Equal-weight upstreams selected default round-robin. Correct. | Retained; no invented `round_robin` directive and no sticky `ip_hash`. |
| Health checks | No container health gates or gateway health endpoint. | Added Compose health checks, startup readiness dependencies, `/healthz`, and `/readyz`. |
| Observability | Default access logs lacked clear upstream retry information. | JSON logs include upstream addresses/statuses and request/connection IDs. |

## Specific difference to explain in your video

Baseline private network:

```yaml
private_subnet:
  driver: bridge
```

Final private network, with the same IPAM subnet declaration retained:

```yaml
private_subnet:
  driver: bridge
  internal: true
```

Explain that a network's name is only a label. The internal flag supplies an actual connectivity restriction. It does not make the Docker host administrator an untrusted outsider. [Docker Compose networks](https://docs.docker.com/reference/compose-file/networks/)

Then show the final `proxy_next_upstream` and timeout directives. The live test must establish observed failover behavior; the configuration text alone cannot establish zero dropped requests. [Nginx proxy documentation](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_next_upstream)

## Follow-up prompt log

After the initial project was prepared, the user supplied this exact follow-up:

> Help me install Docker and run the project so we can verify load balancing, failover, and network isolation.

Codex downloaded the official Docker Desktop installer, verified its Docker Inc. signature, installed Docker Desktop 4.98.0 for the current Windows user, and continued first-run setup. The user installed WSL 3.0.3 using an administrator terminal. Docker CLI/Engine version 29.9.2 and Compose v5.6.1 were verified.

The user launched `Run lab.cmd` in their normal Windows session because Codex's restricted shell could not access Docker's Windows named pipe. The resulting integration report passed all 11 checks with 93 API requests and zero failures. Codex then inspected the saved evidence and ran the browser's ten-request test: 5/5 distribution, all HTTP 200, and no captured console warnings or errors. These observations are saved in `evidence/`; the student still needs to record the required personal walkthrough.

Add any further real prompts and results here. Do not invent a prompt history or claim a student-performed manual patch for an AI-authored revision.

The user later requested:

> Help me upload this project to GitHub and get the repository link for my assignment.

They selected a public repository. Codex prepared the publication by removing LMS grade/status metadata and replacing machine-specific paths in the resolved-configuration evidence. Test outcomes were not altered. The source, documentation, and saved test evidence are published at [ching202/week03-network-loadbalancer](https://github.com/ching202/week03-network-loadbalancer).
