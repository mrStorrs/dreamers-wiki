# Testing And Fixtures

## Test layers

Unit tests cover routing, validation, state parsing, and helper behavior. Integration tests use temporary Git repositories for workspace, diff, push, and recovery flows. Artifact tests inspect this rebuilt wiki fixture for navigation, quality, and reader workflows.

## Fixtures

Git fixtures are created under the operating system temp directory. The committed rebuilt wiki fixture under `tests/fixtures/rebuilt-wiki` represents the expected reader-first wiki artifact and is mirrored to the ignored local wiki workspace during smoke rebuilds.

## Benchmarks

`test-benchmarks.md` records local command timings and recommended timeouts. The timings keep local orchestration honest without becoming a CI scheduler.
