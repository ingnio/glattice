# Contributing to Glattice

Thanks for wanting to help. Bug reports, fixes and small improvements are all welcome.

## Before you start

- **Bugs:** open an issue with the steps, what you expected and what happened. A short recording helps, and Glattice is a good tool for making one.
- **Features and larger changes:** open an issue first so we can agree on the approach before you write code.
- **Security problems:** do not open a public issue. See [SECURITY.md](SECURITY.md).

## Setting up

Glattice currently targets Windows 10 and 11.

You need:

- [Rust](https://rustup.rs) (stable)
- [Node.js](https://nodejs.org) 20 or newer
- [pnpm](https://pnpm.io)
- The [Tauri prerequisites for Windows](https://tauri.app/start/prerequisites/) (Microsoft C++ Build Tools and WebView2)

Then:

```sh
pnpm install
pnpm tauri dev
```

## Where things live

| Path | What it is |
| --- | --- |
| `src/` | The interface: React and TypeScript. One file per view (`Home`, `Player`, `Grid`, `Zoom`, `Config`). |
| `src/lib/` | Shared frontend logic: frame painting, trim, GIF and video encoding, preferences. |
| `src-tauri/src/` | The backend: Rust. Screen capture, input recording, sprite sheets, window handling. |

Two things to keep in step when you change them:

- **Overlays are drawn in two places.** `src/lib/paintEdits.ts` draws edits, clicks and key labels for the Player and for GIF and video exports. `src-tauri/src/edits.rs` and `overlays.rs` draw the same things for sprite sheets. A change to one usually needs the same change in the other.
- **Keyboard shortcuts are listed in `src/ShortcutsModal.tsx`.** Add or update the entry there when you add or change a shortcut.

## Checks to run

Run these before opening a pull request. The same checks run automatically on every pull request.

```sh
pnpm exec tsc --noEmit
cd src-tauri
cargo test --no-default-features --lib
```

If you changed anything visible, run the app and try it.

## Pull requests

- Keep each pull request to one change.
- Describe what changed and why, and how you tested it.
- Add a line to the `Unreleased` section of [CHANGELOG.md](CHANGELOG.md) for anything a user would notice.
- If you add or update a dependency, regenerate [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) so its license is listed.

## Releases

Maintainers: the steps for cutting a release are in [docs/RELEASING.md](docs/RELEASING.md).

## Licensing

By contributing you agree that your contribution is licensed under the [MIT License](LICENSE).

Do not add dependencies under the GPL, LGPL or AGPL to the default build. The optional `gifski` feature is the one exception and stays off by default.

## Conduct

Everyone taking part is expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
