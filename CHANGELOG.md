# Changelog

Versions marked unreleased were local development versions and were not published to npm.

## 0.7.10

- Include the Coopanion application version in full, incremental and HTTP reports when launched by Coopanion; validate and persist it with the box entry.
- Add system, dark and light modes to the public gallery, with saved preferences, and adapt World panels and colony dialogs to the host color mode.

## 0.7.9

- Return per-plant moisture ranges and explicit warnings after single-cell or area watering; preview full-garden overwatering in WebUI.
- Identify measured health losses from excess moisture, drought, aphids and ant harvesting in health and death events. Summarize crossings of 75 and 50 health while retaining persisted critical warning deduplication.
- Clarify that elapsed simulation time is settled before watering, and watering restores five health immediately.

## 0.7.8

- Add terrarium_water_area for inclusive rectangles, saving and reporting the whole operation once; the land panel can water the selected neighborhood or all 25 cells.
- Emit plant warnings at 20 health or below, including plants already critical in older saves and damage from pests. Persist warning deduplication and rearm after recovery to 35 health.
- Mark critical plants in the land panel and retain existing soil, evaporation, credentials and box state.

## 0.7.7

- Add private feedback forms to the public gallery and both World panels, with animated disclosure, submission receipts and retained text on failure.
- Add terrarium_feedback without automatic claims; reuse existing credentials to associate a box and declare the client version.
- Persist a bounded feedback inbox with submission limits, authenticated administrator listing and resolve commands. Existing deployments initialize feedback.json on first submission.

## 0.7.6

- Verify SHA-256 state digests for incremental baselines, patched targets and acknowledgements; resynchronize mismatches without committing rejected state.
- Use full snapshots with older WebSocket servers that omit checksum acknowledgements, retaining legacy client and HTTP compatibility.
- Cover state drift with matching revisions, modified patches, invalid or missing digests, acknowledgement recovery, repeated land/water edits and 250 reproducible JSON patch round trips.

## 0.7.5

- Expose per-habitat upload status, acknowledgement times, transport and consecutive failures through inspection and both World panels.
- Add terrarium_sync and panel controls to upload a complete snapshot using existing credentials; preserve local state and show errors when uploads fail.
- Remove the author-declared experimental tag; official certification remains subject to maintainer review. Incremental reporting stays opt-in and labelled as possibly unstable.

## 0.7.4

- Report over authenticated WebSocket connections with acknowledgements, heartbeat checks and reconnect recovery; preserve the HTTP report interface for older clients and servers.
- Add manually enabled incremental reports, disabled by default and labelled as possibly unstable. Start each connection with a full snapshot and resynchronize mismatched revisions.
- Include the actual package version on every new-client report and persist it with the box entry; continue accepting legacy HTTP reports without a version.
- Advance land state in memory every ten seconds; save and report on the configured tick interval, one minute by default.
- Keep panel and read-tool requests from saving or reporting state; save and report state-changing tools immediately, and save without reporting on normal shutdown.
- Mark service announcements as external events.
- Add repository, homepage and issue metadata; correct the MIT copyright holder to zhiyuHD.
- Remove document owner lines, describe browser assets through the manifest and identify unpublished development versions.

## 0.7.3

- Accelerate aphids, beetles and spiders to one action per minute, and ants to one action per ten seconds.
- Advance, save and report land state every ten seconds with existing check configurations; keep water, ranking and announcement checks on their configured interval.
- Keep fish actions at ten minutes and retain elapsed-time aging, energy drain, reproduction and hatching; cache timezone formatters for offline catch-up.

## 0.7.2

- Redraw nest ants with rounded brown bodies, short curved legs and faces; distinguish queens with a larger golden-brown illustration.
- Keep nest illustrations within mobile cells and show representative residents while retaining full counts and details.

## 0.7.1

- Label queen cells and per-cell ant/egg counts; show expected time to hatch, using recorded time during replays.
- Enlarge entrance targets on small canvases and restore focus and page or panel scroll positions after closing the nest.

## 0.7.0

- Open nests from their entrances to inspect a live 4×4 interior, resident ants, queen, eggs and food in WebUI, the public gallery and recorded replays.
- Elect and persist one existing ant as queen; workers enter nests to store food and eat, while queen eggs hatch into workers inside.
- Preserve version-3 saves, IDs and credentials; older clients can still report. Existing colonies elect a queen automatically on upgrade; workers no longer lay eggs.
- Show only the nest entrance in the outside scene.

## 0.6.1 (unreleased)

- Draw ant nests with raised entrances, curved underground tunnels, layered chambers and stored grain in daytime and nighttime scenes.

## 0.6.0

- Add two-minute ant actions, shared nests with five depth levels, food gathering, carrying and stored-food consumption; add terrarium_drop_food and land scene details.
- Add persistent beetle, spider and ant eggs, timed hatching and juvenile birth events; preserve aphid live birth and reserve capacity for eggs.
- Add authenticated announcement administration with publish/list/revoke commands, broadcast and box-ID targets, expiry and public gallery display.
- Deliver announcement events with persistent cursors and deduplication across habitats and restarts, including broadcasts before claiming; keep existing save and API formats compatible and tolerate older servers without announcement support. Older clients require an update to receive announcement events.
- Publish the World browser bundle under a versioned path while retaining assets used by running clients.

## 0.5.2

- Emit terrarium.overtaken when a claimed box drops in its habitat ranking, with previous/current ranks and instructions to disable reminders.
- Add terrarium_set_rank_alerts; persist independent land/water preferences and rank baselines across restarts, with silent initial and re-enabled observations.

## 0.5.1

- Add terrarium_leaderboard for separate land/water rankings, score parts and own rank beyond the requested top list; document exact scoring formulas in the environment prompt.
- Replace public native menus, replay disclosures and range inputs with animated custom controls supporting keyboard and touch; add a custom search clear button.
- Animate the public gallery illustration, new cards, changed totals and hover states; honor reduced-motion preferences without replaying card entrances on polling.

## 0.5.0

- Redesign the public gallery with responsive land/water cards, habitat totals, search, sorting and connection retry.
- Start with no owned boxes; add explicit, idempotent land and water claims.
- Store land and water state and credentials separately; reuse issued IDs/tokens across tool calls and restarts.
- Add fish, aquatic plants, algae, fish food, oxygen, water quality, water changes, history and predation replays.
- Add a water panel and separate public rankings for land and water.
- BREAKING CHANGE: Move deployment storage from data/terrarium/state.json to data/terrarium/land/state.json and data/terrarium/water/state.json. Clear previous terrarium data and server registrations, then call terrarium_claim for each habitat. Inspection without habitat returns ownership; panel state returns claimed and state fields.

- Move and feed bugs every ten minutes while keeping energy drain, lifespan and reproduction on their existing time scales.
- Save up to 16 hunts from seven days with movement, contact and result frames; add a replay tool and visual playback.
- Accept reports up to 1 MiB to include recorded scenes.

- Add terrarium_rename with a persistent display name independent of the box ID and credentials.
- Show the name in inspection, the World panel and the public leaderboard.

- Read v3 history saved with the legacy atMs timestamp field without losing ecosystem data.

## 0.4.0

- Default to https://cortico-box.zhiyuhub.top and request credentials when no token is configured.
- Persist issued credentials per service and box ID across client and server restarts.

- Add per-cell soil moisture, water diffusion and pebble shade.
- Give plant species distinct moisture and daylight requirements.
- Add hourly soil and plant history, a history query tool and WebUI charts.
- Migrate state versions 1 and 2 to version 3 on load; the next save writes version 3. Older versions cannot read the new state.
- Accept legacy leaderboard reports and reports with seven days of history.

## 0.3.0 (unreleased)

- Let the bot feed and relocate bugs and remove plants, seeds or bugs.
- Let mature, well-fed bug pairs reproduce when they share a cell.
- Deliver hunt, birth, hunger and death events so the bot can inspect and respond.

## 0.2.2 (unreleased)

- Keep bugs visible on the soil surface and separate bugs sharing a cell.
- Animate only actual moves; preserve movement across unchanged reports.
- Disable public scene caching so renderer updates reach visitors.

## 0.2.1 (unreleased)

- Share one Canvas renderer between the World panel and public leaderboard.
- Refresh the World panel every five seconds and animate bug movement and hunts.

## 0.2.0 (unreleased)

- Add sowing, bug behavior, hunting and ecosystem events.
- Add an optional authenticated leaderboard service and public Canvas gallery.
- Migrate existing terrarium state to the 5×5 ecosystem format.

## 0.1.0 (unreleased)

- Add a persistent two-plant terrarium with day and night changes.
- Add inspection, watering, and object movement tools.
- Show the terrarium in a WebUI panel.
