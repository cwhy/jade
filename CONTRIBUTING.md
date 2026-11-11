# Contributing to jade

Start with a reproducible issue, a failing contract or a documented interaction. For larger architecture changes, explain the invariant and affected package boundary before broad implementation.

## Development

- Use Node.js 22.13+ and npm.
- Run `npm test`. It packages and installs the libraries into an independent consumer.
- Run `npm run pack:local` to produce local integration artifacts.
- Keep generated artifacts, machine paths, credentials and private documents out of commits.

## Changes

- Preserve failing assertions; do not weaken a test to hide a model problem.
- Fix a general invariant rather than adding scenario-specific branches.
- Add targeted coverage for concurrent arrival order, owned Undo and persistence when affected.
- Use only declared public exports across packages. Keep application policy and infrastructure outside the engine.
- Keep package versions coordinated. Explain schema/wire changes and test compatibility behavior explicitly.
- State what was tested and what remains unverified. Node tests do not establish native IME or production performance.

Public reports and fixtures should use synthetic content. Include dependency attribution and license notices for any reused material.

Contributions are made under MPL-2.0. Keep the SPDX license notice on source files and include the relevant license and attribution for any third-party material.
