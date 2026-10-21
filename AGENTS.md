# AGENTS.md

This package owns the `terrarium` World. It stays independent of Cortico's built-in Worlds.

- After changes to tools, event types or the environment prompt, run `pnpm describe:extension packages/cortico-world-terrarium` from the Cortico checkout.
- Run `pnpm check:extension packages/cortico-world-terrarium` before publishing.
- Run the package's `test`, `typecheck`, `typecheck:webui` and `build:webui` scripts.
- Keep `cortico.tags` aligned with the official index vocabulary. Certification is granted by index maintainers after publication.
- Release announcements are reserved for a new major or minor series, such as 0.8.0. Patch releases such as 0.7.1 do not publish announcements.
- Managed server deployments use `box-release install` and `box-release activate`; never overwrite the active payload. See `docs/server-releases.md` for migration and rollback.

- Update `src/version-notice.ts` with the improvements for each release and a theme when present. Bugfix-only releases use `<base-version>-bugfix.X` with no theme.
