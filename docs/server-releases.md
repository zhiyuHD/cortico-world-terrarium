<!-- Owner: server/releases.ts, server/release-cli.ts, server/release-runner.ts, server/migrate-flat.sh, server/release-assets.ts -->

# Server releases

Each release contains the server, administration CLI, public page, private console and their assets. `release.json` records its ID, package version, source revision, data compatibility epoch and each file's size and SHA-256. Installation rejects missing, extra, changed and non-regular files. Payloads are copied into a staging directory, checked again and renamed into `versions/<id>/`, with files read-only.

`data/` remains outside releases. Updating and rolling back never copy or restore ecosystem states, credentials, feedback, announcements or control schedules. Releases with different data epochs cannot be activated without an explicit data migration; this implementation supplies no data migrations.

`current` is replaced with an atomic symlink rename. `.deployment/state.json` is a persisted transaction journal with the active version, previous version, pending operation and the last 100 results. File and directory changes are synchronized before proceeding. The CLI holds a kernel `flock` during changes; a second operation fails while that lock is held. The supervisor completes or recovers the journal independently of the caller's SSH connection.

`manager` pins the supervisor and release CLI imported during initial migration. Application updates do not replace that controller. The user service starts `manager/runner.mjs`, which verifies the target payload, starts its concrete version directory and checks public health, release identity, public HTML and configured private console assets. Health must remain successful for at least 750 ms. The startup timeout defaults to 20 seconds; `CORTICO_TERRARIUM_START_TIMEOUT_MS` accepts 1500–120000 milliseconds. A failed activation restores and starts the previous version. If the supervisor stops during activation, its next start restores the previous version before serving. A crash after successful activation uses the service's restart policy; it does not trigger automatic rollback.

Updates restart the process and briefly interrupt requests and WebSocket connections. Clients reconnect using their existing credentials. New managed pages reference versioned assets, and newer managed servers continue serving retained versions' public scene and private console assets. Imported legacy servers lack these versioned routes; reload browser pages after rolling back to a legacy server. No versions are automatically deleted.

## Import an existing deployment

Requires Linux, Node.js 22+, `flock` and a user systemd service. Build the package's `build:server` and `build:admin` targets, copy the resulting `dist/` directory onto the server, then run as the service owner:

```sh
bash /path/to/dist/migrate-flat.sh /path/to/deployment /path/to/dist legacy-baseline cortico-box.service
```

The migration snapshots the existing flat server files, adds the release controller and writes `atomic-releases.conf` under the user service's drop-in directory. Existing environment configuration and `data/` remain in place. The imported baseline uses legacy health checks without a release identity. The script creates `<deployment>/box-release` for subsequent commands. Original flat files remain on disk and are no longer the service entry point.

If the service configuration change fails, the script removes its drop-in and restarts the original flat service. Installed release metadata remains for inspection; resolve it before retrying migration. A custom public health address can be supplied through `CORTICO_TERRARIUM_HEALTH_URL`; the supervisor requires loopback HTTP `/health`.

## Update and rollback

Build both server targets. Pack the build into a new directory on the build machine:

```sh
node dist/release.mjs pack --source dist --output /path/to/package --id server-20261019-a --version 0.7.11 --revision <git-commit>
```

Copy that directory to the deployment host, then install and activate it:

```sh
cd /path/to/deployment
./box-release install --source /path/to/package
./box-release activate --id server-20261019-a
./box-release status
./box-release list
./box-release verify --id server-20261019-a
./box-release rollback
```

`rollback` selects the previous successfully active version; `rollback --id <id>` selects another installed compatible version. `--service <name>.service` overrides the default user service name. The CLI reports a failed health check even when the old server was restored successfully. If restarting the service or waiting for activation fails, inspect `status` and the user service journal, correct the cause, then run `./box-release recover`. A queued transaction is attempted; an interrupted starting transaction is rolled back.

The private authenticated `GET /api/admin/boxes` response includes process-local `acceptedReports.http` and `acceptedReports.websocket` counters. These count committed reports, reset at server restart and can be sampled alongside host and process metrics. Its box rows distinguish registrations, saved reports and current WebSocket connections.

## Native payloads

Node releases retain schema 1 and launch `server.mjs` with the controller's Node executable. Native releases use schema 2 with `runtime: { kind: "native", platform: "linux", arch: "x64" | "arm64" }`. Their executable is named `server`; installation seals it to mode 0555 and starts it directly without a shell. Other files remain read-only. Both formats include the existing public and private assets and Node-based release controller. Native executables may be at most 128 MiB; the whole payload may be at most 192 MiB. A target mismatch fails activation and restores the previous release.

```sh
node dist/release.mjs pack --source native-dist --output new-package --id native-example --version 0.1.0 --revision <commit> --native-target linux-x64 --data-epoch 2
```

The executable inherits the deployment working directory, environment, standard streams, release ID and deployment root. It must serve the existing health and asset checks at the configured addresses. The controller sends SIGTERM and, after three seconds, SIGKILL if it has not stopped. Data compatibility is independent of runtime: switching between JSON and SQLite requires a migration and a suitable data epoch. A matching epoch must mean both releases can read and write the same persisted data.

Existing deployments pin their original controller. Before installing schema 2 packages, pack and install a schema 1 Node release containing the updated controller using the old CLI. Invoke the updated CLI from that installed version:

```sh
node versions/<new-node-release>/release.mjs upgrade-controller --root /path/to/deployment --id <new-node-release>
```

This command requires no pending activation. It atomically replaces `manager`, then records the controller ID in the deployment journal. Repeating it completes an interruption between those two writes. It leaves `current`, `previous` and application data unchanged. Restart the user service to load the new runner. Keep the former controller version available for recovery.
