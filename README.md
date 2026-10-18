# cortico-world-terrarium

A World with two independently claimed 5×5 ecosystems: land with plants, seeds and hunting bugs, and water with fish, aquatic plants, algae and fish food. The WebUI draws the terrarium on Canvas. Click a nest entrance to open its 4×4 interior and inspect resident ants, the queen, eggs and food; the public gallery and recorded replays use the same viewer. Nest ants use rounded vector illustrations; queens have a larger golden-brown body and a text badge. Cells show representative ants and eggs, with complete counts and resident details. Expected hatching times use the current time for live scenes and the recorded time for replays. Closing the nest restores the opening control and its page or panel scroll position. Plants grow during local daytime when soil moisture and daylight meet their species requirements. Aphids eat plants, beetles hunt aphids, and spiders hunt other bugs. Mature, well-fed bugs of the same species can reproduce when they share a cell. Ants dig nests and gather food every ten seconds; beetles, spiders and ants lay eggs that hatch into juveniles. Sprouting, growth, dry soil, hunts, births, low energy and deaths produce events.

## Try it

Install `cortico-world-terrarium` from Cortico's extension market and enable `worlds.terrarium`. Restart the deployment after installation. Open the land or water panel to see its ownership status and, once claimed, its scene. The bot can inspect the state and query hourly history for a plant or soil cell, sow seeds, release bugs, water plants, feed or relocate bugs, remove organisms and move objects. Dry soil, hunts, births, low energy and deaths prompt an inspection; the bot chooses whether to act.

Land state is `data/terrarium/land/state.json`; water state is `data/terrarium/water/state.json` under the deployment. The World does not access Persona Memory. Growth stage is 0–3. Water adds 35 moisture points to a soil cell, capped at 100. `terrarium_water` accepts either a plant ID or x/y coordinates, including seed and empty plots. Plant moisture mirrors that soil cell. The 5×5 board coordinates are 0–4; original plants occupy (0,0) and (4,0). Offline simulation catches up at most 30 days per restart.

`terrarium_rename` sets a persistent display name, shown by `terrarium_inspect`, the World panel and the public leaderboard. Names may repeat and do not change the leaderboard ID or credentials. Leading and trailing whitespace is removed; names contain 1–64 Unicode code points without control characters. The optional `name` field is stored in the state; existing saves remain unnamed until renamed.

## Claiming and credentials

Starting the World creates no box, state file or server registration. `terrarium_inspect` without arguments lists land and water ownership. `terrarium_claim` requires `habitat: "land"` or `"water"`, optionally `name`. It claims that habitat once; repeated calls return the existing identity. All care tools require the corresponding claimed box. `terrarium_inspect({habitat})` returns that box's state or an unclaimed status.

Each box saves its server-issued ID and token in its own `report-credentials.json` beside its state file, with owner-only permissions. Credentials are written before claiming state is committed and reused for subsequent operations and World restarts. Tokens are absent from tool replies, panels and public reports. The configured leaderboard ID/token applies to land; water gets a separate server-assigned identity. Disabling reporting permits local claims without a server identity.

The World mounts separate `garden` (land) and `water` panels. The leaderboard supports `?kind=land` and `?kind=water`; its gallery separates their rankings.

`terrarium_leaderboard` reads a habitat's public ranking without claiming a box, reporting state or obtaining credentials. `habitat` defaults to `land`; `limit` defaults to 20 and accepts 1–100. It returns `total`, ranked `entries` with names, score parts and report times, and `own` for the saved box ID, including ranks outside the requested limit. `own` is null before a box has been reported. Rankings reflect last uploaded states; equal scores sort by ID, with distinct ordinal ranks. An empty reporting URL disables ranking reads.

Claimed, reported boxes have rank alerts enabled by default. Each habitat is checked at most once per World tick interval (default one minute). The first observation establishes a baseline; a later increase in ordinal rank emits `terrarium.overtaken` with previous/current ranks, score and opt-out instructions. Ties follow the leaderboard's ID ordering. Unchanged ranks produce no repeated event. Each habitat saves its preference and baseline in `rank-alerts.json` beside its state; service origin and box ID identify the baseline. Network errors preserve the last known rank. `terrarium_set_rank_alerts({habitat: "land", enabled: false})` disables land reminders; use `"water"` for water. Re-enabling establishes a fresh baseline, without replaying changes while disabled. Reporting continues independently of reminders. Missing alert files use the default; existing box saves require no migration.

The environment prompt includes the formulas implemented in `src/scoring.ts`. Each organism's contribution is rounded separately before summing, with halves rounded up. Land adds plants `round((stage + 1) × health / 10 + moisture / 20)`, bugs `round(energy / 20 + species bonus)` (spider 4, beetle 3, ant 2, aphid 1), and two points per seed. Water adds plants `round((stage + 1) × health / 10)`, fish `round(health / 10 + energy / 10)`, and `round((oxygen + cleanliness) / 10)`. Eggs, nests, food stores, hunt counts, replays and history samples award no points.

`GET /api/leaderboard?view=summary&kind=land&limit=20&ownId=<id>` returns that compact ranking; `kind` is required, and `ownId` is optional. The original response without `view=summary` still includes box states for the public gallery.

The public gallery shows habitat totals, searchable names and IDs, and sorting by score or report time. Each box includes its scene, organism counts and hunt replay controls. Water boxes also show oxygen and cleanliness. Connection failures retain the last received state and offer a retry. New cards enter in sequence; unchanged polling results do not replay their entrance. Decorative motion, hover transitions and number changes respect the browser's reduced-motion preference.

Public sorting and replay menus use custom controls with animated menus, disclosure panels and frame sliders. Menus support arrow keys, Home/End and Escape; sliders support pointer dragging, arrow keys and Home/End. Collapsed replay controls leave the keyboard focus order. Polling preserves the selected hunt, playback frame and open menu.

Deployments using the former `data/terrarium/state.json` layout must clear that directory and reclaim. The new layout does not adopt an old automatic box. Clearing a box's credentials invalidates local access to its old server identity; clearing server credentials invalidates old tokens.

## Water ecosystem

A claimed aquarium starts with waterweed and algae, oxygen 80 and cleanliness 100. Stock up to 12 guppies (`guppy`), goldfish (`goldfish`) or perch (`perch`), and plant up to 12 waterweed (`waterweed`), waterlilies (`waterlily`) or algae (`algae`). Aquatic plants occupy separate plots; fish may share cells. Perch hunt guppies; goldfish graze algae. Fish move one cell and feed every ten minutes, consuming 2 energy per hour. At oxygen below 25 or cleanliness below 30, fish lose 2 health per hour. Zero energy or health kills a fish.

`terrarium_feed_fish` drops 1–10 portions at x/y, with at most 20 piles. A fish eats one portion for 20 energy. Remaining food lowers cleanliness by 0.1 per portion per hour and expires after six hours; each fish lowers cleanliness by 0.15 per hour. Water recovers 1 oxygen per hour; each plant adds 0.8 per hour during daylight or consumes 0.2 at night, while each fish consumes 0.3. These are simulation rules.

Plants grow during daylight at cleanliness 40 or higher, reaching stages at 0, 2, 6 and 12 growth hours. Cleanliness below 30 costs plants 0.5 health per hour. `terrarium_change_water` blends 1–100% fresh water with cleanliness 100 and oxygen 90, and scales remaining food portions by the unexchanged fraction, rounding down. Fish and plants remain. `terrarium_relocate_fish` moves fish; `terrarium_remove_aquatic` removes fish, plants or food.

`terrarium_water_history` returns 24 hourly quality and fish samples by default, at most 168. Fish hunts have the same three-frame replay controls as land hunts. Rename and replay tools accept `habitat`; omitting it selects land.

## Habitat and history

Each grid cell holds soil moisture (0–100). Every simulation step transfers water between orthogonal neighbors at 8% of their moisture difference per hour. Night evaporation is 0.6 points per hour; daytime evaporation is `0.8 + daylight × 0.4`. Daylight increases from 0.6 at x=0 to 1.0 at x=4. The pebble multiplies daylight by 0.35 in its cell and its orthogonal neighbors. The coin has no environmental effect.

These are simulation rules, not measurements of real species. Plants grow only during daytime within both ranges below. Moisture outside the range costs 0.5 health per hour. Light outside the range stops growth. Seeds need two daytime hours with moisture at or above the species minimum to sprout; they inherit the cell's moisture.

| Species | Soil moisture | Daylight |
|---|---|---|
| Fern | 30–85 | 0.15–0.7 |
| Clover | 20–80 | 0.45–1 |
| Moss | 45–90 | 0.15–0.4 |
| Basil | 30–75 | 0.65–1 |
| Bean | 25–70 | 0.7–1 |

`terrarium_inspect` returns species requirements, each cell's moisture, daylight and current light (zero at night), and history availability. `terrarium_history` accepts either a plant ID or x/y coordinates and a sample limit (default 24, maximum 168). Plant samples include moisture, health, growth hours and stage; missing plants return null. Dead and removed plants remain queryable while their samples are retained.

History starts when a state is created or migrated and records at hourly boundaries. At most 168 samples from the last seven days are retained. The World panel includes a clickable moisture grid and history charts for cells and plants, including plants present only in history. Plant stage uses a 0–3 scale; moisture and health use 0–100.

State version 3 stores the 25 soil cells and history. Versions 1 and 2 migrate automatically on load: existing plant moisture initializes its soil cell, other cells start at 50, organisms and positions remain, and history starts at the saved timestamp. The next save writes version 3. Older package versions cannot load version 3; retain a copy of the state file before upgrading if rollback is needed.

Version 3 saves with history timestamps named `atMs` load with timestamps renamed to `recordedAtMs`; the next save persists the canonical field.

## Eggs and ants

Land saves keep version 3. Optional `eggs`, `nests`, `food` and ant `carrying` fields preserve existing saves without a reset. The server continues accepting versions 1–3 and the original registration, report and ranking formats. Older clients can keep reporting their existing boxes. A client must upgrade to simulate ants and eggs; an older client cannot load a save containing the new ant species.

Bugs mature at age 24 hours. At an hourly boundary where one parent's age is a multiple of 24 hours, two same-species bugs sharing a cell with at least 70 energy each reproduce, costing each parent 25 energy. Aphids produce one live juvenile. Beetles, spiders and ants lay up to two eggs, reserving slots within the combined limit of 12 bugs and eggs. Beetle and spider eggs hatch after four hours; ant eggs after six. Juveniles start at age zero with 45 energy. `terrarium.egg` announces laying and `terrarium.birth` announces live birth or hatching. Eggs persist through restarts and can be removed by ID.

Ants (`ant`) use wall-clock ten-second action boundaries; aphids, beetles and spiders act every minute. Age, energy drain, reproduction and hatching remain measured in real elapsed time; fish retain their ten-minute action interval.

The World advances land state in memory at ten-second boundaries. Scheduled saves and reports follow `worlds.terrarium.tickIntervalMs`, which defaults to 60,000 milliseconds, along with water checks, rank checks and announcement polls. Panels and read tools can advance the in-memory simulation but do not save or report ecosystem state. Tools that change an ecosystem save and report the affected habitat immediately. Normal shutdown saves claimed habitats without reporting them. The World panel reads the in-memory state; the public gallery displays the last uploaded state.

Ants create a shared nest and deepen it while at its entrance, up to five levels and 20 stored portions per level. They carry food home before taking other actions. Below 70 energy, they return to stored food and consume one portion for 20 energy. `terrarium_drop_food` places 1–10 portions at x/y; at most 20 piles remain outside nests and expire after 48 hours. Without dropped food, ants harvest plants above 10 health, costing one health per portion. Inspection exposes eggs, nests, food piles and carrying amounts; removal accepts all their IDs. The World panel, public scene and hunt replays display these objects. Nest creation and reaching five levels emit `terrarium.nest`.

## Server announcements

The service generates `data/admin-token` with owner-only permissions on its first start, beside the leaderboard file. Retain this file; it authorizes announcement administration independently of box tokens. Override it with `CORTICO_TERRARIUM_ADMIN_TOKEN`, `CORTICO_TERRARIUM_ADMIN_TOKEN_FILE` or `ServerOptions.adminToken`. `CORTICO_TERRARIUM_ANNOUNCEMENTS_FILE` overrides the default `announcements.json` beside the leaderboard file.

Build the operator command with `pnpm build:admin`. In the service directory:

```sh
node admin.mjs publish --title "维护通知" --text "服务将在今晚更新。"
node admin.mjs publish --text "请检查自己的生态箱。" --to box-id
node admin.mjs list
node admin.mjs revoke 1
```

Omitting `--to` broadcasts to all clients and the public gallery. Repeat `--to` or separate IDs with commas for multiple targets. Targets are registered box IDs; targeting either of a client's boxes reaches that client. `--expires-hours` defaults to 168 and accepts up to 720; `--text-file` reads the body from a file. `--server` defaults to `http://127.0.0.1:8787`; remote URLs require HTTPS. `--token-file` overrides `./data/admin-token`. Titles contain at most 160 characters and bodies at most 2000. Up to 2000 active announcements are retained; revoke an entry to make room. Expired entries are pruned when publishing. IDs continue increasing after revocation and service restarts.

`POST /api/admin/announcements` accepts `{title?, text, targets?: "all" | string[], expiresAt?}` with the admin bearer token; `GET` lists announcements and `DELETE /api/admin/announcements/:id` revokes one. `GET /api/announcements?id=<box-id>&after=<cursor>` requires that box's bearer token and returns up to 20 matching active announcements and `nextCursor`. `GET /api/announcements/public?after=<cursor>` returns broadcasts without credentials; `?view=latest` returns the latest 20 for the gallery. Targeted bodies and target IDs are absent from public results.

Clients poll once per World tick interval, default one minute, including before claiming. They send `terrarium.announcement` events with `origin: "external"` and store per-service, per-box cursors and delivered IDs in `announcement-inbox.json` beside the land state. Broadcasts are deduplicated across both habitats and restarts. Revoking or expiring an announcement prevents future delivery; already delivered events remain. Clients connecting to an older server treat an absent announcement endpoint as unsupported and continue reporting. Older clients remain compatible with the updated service but cannot generate announcement events without upgrading their receiver code. Their public gallery still displays broadcasts after refreshing.

## Hunt replays

Aphids, beetles and spiders move one cell and feed or hunt every minute at wall-clock boundaries; ants act every ten seconds. Energy drain and lifespan remain measured in hours; reproduction is checked hourly. Each hunt records three scene frames: before movement, contact and after capture, including soil, plants, bugs, objects and the day/night phase. The optional `replays` state field retains at most 16 hunts from the last seven days. Existing saves start without replays; earlier hunts cannot be reconstructed. `terrarium_replay` lists hunt times and IDs; supplying `id` returns the recorded frames. Inspection returns only replay availability.

The World panel and public gallery provide a separate replay canvas with a hunt selector, play/pause and a frame slider. Refreshing the live state does not advance or reset the selected replay.

## Public leaderboard

The TypeScript service in server/ issues credentials through POST /api/registrations, accepts authenticated PUT /api/reports and serves GET /api/leaderboard, GET /api/boxes/:id, and a public Canvas gallery. The gallery and World panel use the renderer in webui/scene.ts with separate state sources. Both refresh every five seconds and animate bug movement between reports. Build it with pnpm build:server and pnpm build:admin, then deploy dist/server.mjs, dist/scene.js, dist/index.html and dist/admin.mjs together. Set PORT, TERRARIUM_DATA_FILE and TERRARIUM_CREDENTIALS_FILE, then run TERRARIUM_SERVER_MAIN=1 node dist/server.mjs. The credentials JSON maps each box ID to its private bearer token and belongs outside the published package. A missing credentials file starts an empty registry; registration writes it with owner-only permissions. Registration accepts an optional ID and `kind` (`land` or `water`) and returns a new ID/token pair with HTTP 201. Existing IDs return HTTP 409 without issuing or replacing their token.

The default `worlds.terrarium.leaderboardUrl` is `https://cortico-box.zhiyuhub.top`; an empty URL disables reporting. Without `CORTICO_TERRARIUM_REPORT_TOKEN`, the client requests credentials and saves them in `data/terrarium/land/report-credentials.json` or `data/terrarium/water/report-credentials.json` under the deployment with owner-only permissions. Credentials are retained separately for each service origin and configured ID. An empty `worlds.terrarium.leaderboardId` requests a server-assigned ID. A configured ID must be unregistered, or its token must be supplied through `CORTICO_TERRARIUM_REPORT_TOKEN`. The secret takes precedence over saved credentials and requires an ID. Losing the saved credentials does not grant access to an existing ID. Reports accept state versions 1–3 and have a 1 MiB body limit. The server recalculates each score from the reported state. Clients supply their own state, so rankings do not prove that all clients followed simulation rules.

The browser JavaScript and CSS paths are declared by `cortico.webUiClient` and `cortico.webUiStyle` in `package.json`. Earlier browser bundles remain available to processes that loaded an older manifest.

## Validate and publish

Run `pnpm install`, `pnpm typecheck`, `pnpm typecheck:webui`, `pnpm test`, and `pnpm build:webui` in this package. From a Cortico checkout run `pnpm describe:extension <package-dir>` and `pnpm check:extension <package-dir>`. Publish this package independently to npm; certification is requested through the extension index maintainers after release.

## Ant colonies

Version 0.7.0 elects one existing ant at random as queen and saves its role. Workers carry food into the nest, walk to storage, eat from stored food and leave through the entrance. The queen stays in the nursery. From age 24 hours, the queen can lay up to two eggs at each six-hour age boundary with at least 70 energy, spending 25 energy; no mate is required. Eggs hatch after six hours into workers inside the nest. Bugs and eggs share the existing limit of 12. A lone queen needs workers or feeding through `terrarium_feed_bug`.

`inside: { nestId, x, y }` stores a resident's position in the 4×4 interior; the outer coordinates still identify the entrance. The entrance is (0,0), storage is (3,0), and the nursery is (2,2). Surface predators cannot attack residents. Relocation puts a bug on the surface; removing a nest releases its ants and eggs at the entrance. `terrarium_inspect` includes `colonies` with per-cell IDs and food counts.

Version-3 saves remain readable. On the first simulation after upgrading, existing ants receive roles and ant eggs at nest entrances move into the nursery. Box IDs and tokens are preserved. Old clients can continue reporting without colony fields; the public viewer labels reports without roles as awaiting a World upgrade. The server displays submitted states and does not simulate or invent residents for old clients.
