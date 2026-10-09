# Contract: Deploy interface (CI → production server)

This is the only way CI changes production. Spec requirements: FR-015, FR-016.

## Invocation

```text
ssh -i <deploy key> -o UserKnownHostsFile=<pinned> deploy@<server> <tag>
```

- The `authorized_keys` line for the key is
  `restrict,command="/opt/subscription-tracker/bin/deploy.sh" ssh-ed25519 … gha-deploy`.
- `restrict` turns off forwarding, the PTY and `~/.ssh/rc`.
- `command=` means every login with this key runs `deploy.sh`, whatever the
  client asked for. The requested command arrives only as
  `$SSH_ORIGINAL_COMMAND`.

## Input

| Field | Rule |
|---|---|
| `<tag>` (`$SSH_ORIGINAL_COMMAND`) | must match `^sha-[0-9a-f]{7}$` exactly. Any other value, including empty, extra words or shell metacharacters, is rejected **before any other command runs**. |

## Behavior

1. Take the deploy lock (`flock`), waiting for any deploy already running.
2. Record the running tag in `previous-tag`.
3. Set `IMAGE_TAG=<tag>`. Then `docker compose pull`, then
   `docker compose up -d --wait --wait-timeout 120`.
   - `--wait` succeeds only when the backend's `/health` (which reaches the
     database) and the frontend's health check pass.
4. Check `https://$API_HOST/health` through Caddy and expect 200.
5. If step 3 or 4 fails:
   1. Restore `IMAGE_TAG` from `previous-tag`.
   2. Run `docker compose up -d --wait`.
   3. Exit with code 1.

## Exit codes

| Code | Meaning | Production state afterwards |
|---|---|---|
| 0 | the new tag is live and healthy | new version |
| 1 | the new tag failed health; rolled back | previous version (schema may be newer; see research R6) |
| 2 | the rollback also failed | **degraded**. UptimeRobot will alert, and the maintainer intervenes using `deploy/README.md` "Manual rollback". |
| 64 | invalid tag argument | unchanged; nothing ran |
| 75 | could not pull the image (registry or network) | unchanged |

Output on stdout/stderr is shown in the CI log. It must never print the
contents of the env file.

## CI side (`build-and-push.yml`, job `deploy-upcloud`)

- Runs only after `build` succeeds, only on `main`, and only when the
  repository variable `UPCLOUD_DEPLOY_ENABLED == 'true'`.
- `concurrency: upcloud-deploy`, with `cancel-in-progress: false`.
- Secrets:
  - `UPCLOUD_DEPLOY_SSH_KEY`: the private key;
  - `UPCLOUD_DEPLOY_HOST`;
  - `UPCLOUD_KNOWN_HOSTS`: the pinned host key line.
- Sends `sha-${GITHUB_SHA::7}`, the same tag the build job pushed.
- A non-zero exit fails the job, and GitHub emails the maintainer about the
  failed run.

## Tests

`deploy/tests/test_deploy_guard.py` runs `deploy.sh` with a fake `docker` on
`PATH` that records its calls:

- **Rejected inputs:** `""`, `"latest"`, `"sha-ABCDEFG"`,
  `"sha-1234567; rm -rf /"`, `"sha-1234567 extra"` and `"$(id)"`. Each must
  exit 64 with the fake recording no calls.
- **Accepted input:** `sha-1234567` reaches `pull`.
- **Failed health:** a fake `up --wait` failure leads to a rollback with
  `previous-tag` and exit 1.
