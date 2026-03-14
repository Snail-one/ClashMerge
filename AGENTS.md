# Repository Guidelines

## Project Structure & Module Organization
This repository currently contains the product spec at `docs/PRD.md`. Implementation should follow the structure defined there:

- `src/`: application code
- `src/core/`: fetch, parse, merge, transform, and generate pipeline
- `src/routes/`: HTTP endpoints for sources, builds, and output
- `src/utils/`: shared helpers
- `data/`: runtime data such as `sources.json`, cached subscriptions, scripts, logs, and generated YAML
- `tests/`: unit and integration tests

Keep source code and generated data separate. Do not commit temporary cache or output files unless they are deliberate fixtures.

## Build, Test, and Development Commands
The project is expected to use Node.js. Prefer npm scripts and keep them stable:

- `npm install`: install dependencies
- `npm run dev`: start the local development server with reload
- `npm run build`: run the build or validation step for release readiness
- `npm test`: run the full test suite
- `npm run lint`: check formatting and code quality

When adding tooling, update `package.json` and this file together.

## Coding Style & Naming Conventions
Use JavaScript with 2-space indentation and UTF-8 text files. Prefer small, composable modules and pure functions in `src/core/`.

- Files: `kebab-case.js`
- Variables/functions: `camelCase`
- Classes: `PascalCase`
- Constants: `UPPER_SNAKE_CASE`

Keep configuration shapes explicit. Favor clear transformation steps over compact but opaque logic. Use Prettier and ESLint once the project scaffold is in place.

## Testing Guidelines
Place tests under `tests/` and mirror the source layout where practical, for example `tests/core/merge.test.js`. Cover the main pipeline:

- subscription parsing
- proxy deduplication
- JS transform execution
- final YAML generation

Add regression tests for bugs in merge or filtering behavior. `npm test` must pass before opening a change.

## Commit & Pull Request Guidelines
There is no Git history yet, so use Conventional Commits going forward, for example `feat: add subscription merge pipeline` or `fix: handle invalid yaml input`.

PRs should include:

- a short description of the change
- linked issue or task when available
- test evidence (`npm test`, manual API check, or sample output)
- screenshots only for UI work

## Security & Configuration Tips
Treat subscription URLs and generated configs as sensitive. Do not hardcode private endpoints or credentials. Run user JS transforms in a sandboxed context and keep network or filesystem access disabled by default.
