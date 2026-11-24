# Releasing Glattice

## Cutting a release

1. Set the new version in all three places: `package.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`.
2. In `CHANGELOG.md`, give the changes a heading for that version and date.
3. If dependencies changed, run `python scripts/third-party-notices.py` and commit the result.
4. Merge to `main` and wait for the CI workflow to pass.
5. Tag the commit and push the tag:

   ```sh
   git tag v0.2.0
   git push origin v0.2.0
   ```

6. The Release workflow builds the Windows installers and attaches them to a **draft** GitHub release. Download the setup `.exe`, install it and try a recording and an export.
7. Paste the version's changelog section into the release notes and publish the draft.

To build installers locally instead, run `pnpm tauri build`. They are written to `src-tauri/target/release/bundle/`.

## Code signing

The installers are not signed yet. Windows SmartScreen therefore warns the first time someone runs one, until enough people have installed that file for it to earn a reputation. Signing removes or shortens that.

Signing needs a certificate issued to an identity, so it cannot be set up from the repository alone. The options to look at:

- **A free signing service for open-source projects.** Some certificate providers sign releases for qualifying open-source projects at no cost. They need an application and review, and signing happens in their service from the CI build.
- **A cloud signing service.** Paid monthly, no hardware token, and designed to be called from CI.
- **A code-signing certificate from a certificate authority.** Paid yearly. These are now issued on hardware tokens or cloud key stores, so CI needs the cloud form.

Whichever is chosen, it plugs into Tauri in `src-tauri/tauri.conf.json` under `bundle.windows`: either `certificateThumbprint`, `digestAlgorithm` and `timestampUrl` for a certificate in the Windows store, or `signCommand` for a service with its own signing tool. See the [Tauri Windows code-signing guide](https://tauri.app/distribute/sign/windows/). Keep any secrets in GitHub Actions secrets, never in the repository.

Until signing is in place, the README tells people how to get past the SmartScreen warning.
