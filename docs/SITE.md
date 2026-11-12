# Public site and playground

The public site is https://cwhy.github.io/jade/. It is maintained in this repository
and published by `.github/workflows/pages.yml` from `main`.

The account's existing Pages custom domain currently redirects that address to
`https://chenyuio.com/jade/`. This project does not change account-level domain or
DNS settings. Relative links work at either entry point.

## Boundaries

- `site/index.html`, `style.css`, `guide.html`: landing page, responsive styles and guide.
- `site/sample.js`: fictional rich document fixture.
- `site/local-room.js`: demo-only host around the public `Client` and `Room` exports.
- `site/playground.js`: browser controllers, rendering and two independent editor views.
- `tools/build-site.mjs`: copies public engine modules and generates an exact export import map.
- `tools/serve-site.mjs`: loopback-only development server on port 4173.

The website is a consumer of Jade; it does not change the engine or introduce
private cross-package imports. The demo authority runs locally. Disconnect pauses
that client's exchange with the authority while its optimistic document remains
editable. Reconnect catches up, submits pending operations and propagates decisions.
Undo and Redo use the real actor-owned client history.

There is no network service, authorization, durable journal, asset upload, public
room link, remote-cursor UI or recovery workspace. All visitors start with their
own temporary sample. Reload and Reset sample discard it. Do not treat the demo
host as a production transport or a performance benchmark.

## Build and check

```sh
npm ci --offline --ignore-scripts --no-audit --no-fund
npm test
npm run site:build
npm run site:test
npm run site:serve
```

Check both editors, actor-owned Undo/Redo, divergent offline edits followed by
reconnect, rich cells, Reset cancellation/confirmation, the guide, browser Back,
and a narrow viewport. The site test checks the deployed module graph, relative
links and the local authority integration. It does not replace browser input QA.

Only the explicit `artifacts/site` output is uploaded. There are no analytics,
third-party scripts or CDN dependencies. Engine source and its MPL license ship
with the demo. Changes to the workflow or site do not publish packages to npm.

## Design

The reference is Elm's landing page: generous white space, modest typography,
direct playground/guide links, square outlined buttons and explanatory examples.
Jade uses its own green wordmark and copy. The early-software note and demo scope
are explicit; do not add invented adoption, reliability or performance claims.
