<!-- Owner: ../src/state-storage.ts, ../src/state.ts, ../src/world.ts -->
# Habitat snapshots

Land and water use separate `state.json` files. Each has its own `state.json.backup`, containing the previous parseable snapshot; the first save also creates a backup of that initial state. Saves for one absolute path run in order. Temporary files use unique names, mode 0600, and are flushed before replacement. POSIX also flushes the parent directory; Windows flushes file contents and uses rename, without attempting directory fsync.

Startup recovers a missing or unparseable main file from its backup. A damaged main file is retained byte-for-byte as `state.json.corrupt-<time>-<uuid>` before replacement, and WebUI logs record the recovered habitat and paths. A parsed root must be a non-null object. Habitat schema validation still applies after reading; a syntactically valid but incompatible snapshot does not become a new box. If the main file is damaged and no parseable backup exists, startup fails and preserves the files. An absent main file and absent backup means the habitat has not been claimed.

To restore an external backup, stop the deployment first. Preserve its current `state.json`, `.backup` and reporting credentials elsewhere, then replace only the affected habitat's `state.json` with the validated backup. Keep IDs and tokens unchanged. Restart and verify level, plants and animals before normal use. Historical snapshots resume from their recorded simulation time and may advance through the offline interval; keep the original archive when preparing a copy with a newer simulation timestamp.

A flushed replacement reduces exposure to interrupted writes but does not establish the cause of a reported damaged file or guarantee recovery from storage hardware failure. The rotating local backup and server snapshots may predate the latest actions.
