# Contributing to maw-js

Thanks for taking an interest. This project is alpha — the surface moves fast and breaking changes land frequently. Expect churn; expect warmth.

## Quick start

```bash
bun install
bun run test:all    # ~2-3 min; runs unit, isolated, mock-smoke, plugin suites
bun run maw --help
```

Bun v1.3+ is required. tmux is needed for multi-agent features. On Linux, `ssh` must be on PATH for federation.

## Before opening a PR

1. `bun run test:all` passes locally.
2. New code has tests. If the code path is integration-only (spawns a subprocess, sets a timer, listens for a signal), document why in the test file.
3. New `mock.module(...)` calls live in `test/isolated/` or `test/helpers/` (see `scripts/check-mock-boundary.sh`).
4. If you added a new export to `src/core/transport/ssh.ts` or `src/config/*`, update the canonical mock in `test/helpers/mock-*.ts` (see `scripts/check-mock-export-sync.sh`).
5. Commits follow [Conventional Commits](https://www.conventionalcommits.org/) — `feat:`, `fix:`, `chore:`, `test:`, `docs:`.

## Opening issues

- **Bugs**: include the command you ran, the output you got, and what you expected. A minimal repro beats a long narrative.
- **Features**: open a short issue describing the problem first. If we align on the shape, a PR is welcome.
- **Proposals / design docs**: use GitHub Discussions, not issues. Issues are for work; discussions are for thought.

## Releases

Alphas ship from `main` via `bun run ship:alpha`. The script lints, tags, and force-pushes the rolling `alpha` branch. See `scripts/ship-alpha.sh`.

## Code of Conduct

See [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md). In short: be kind, assume good faith, name the behavior not the person.

## Security

See [SECURITY.md](./SECURITY.md) for responsible disclosure.

## License

By contributing, you agree that your contributions will be licensed under the repository's [LICENSE](./LICENSE).
