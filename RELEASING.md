# Releasing Draftwick

Step by step, from a finished change to downloadable packages on GitHub. The examples release
version `0.2.0`; replace it with your version. Releases use [semantic versioning](https://semver.org/):
`0.x.0` for new features while the app is young, `0.x.y` for fixes.

You do these steps yourself. Nothing here runs automatically.

## 1. Check the code is ready

```bash
git status                     # nothing uncommitted
pnpm install
pnpm typecheck
pnpm build
pnpm test
cd src-tauri && cargo test && cd ..
```

All four must pass.

## 2. Set the version

The version is written in **three** places. Change all of them to the same number:

| File | Line |
| --- | --- |
| `package.json` | `"version": "0.2.0"` |
| `src-tauri/Cargo.toml` | `version = "0.2.0"` |
| `src-tauri/tauri.conf.json` | `"version": "0.2.0"` |

Then let Cargo update its lockfile, and check the app reports the right number (Help > About):

```bash
cd src-tauri && cargo check && cd ..
```

Package file names contain the version (`Draftwick_0.2.0_amd64.deb`). Update the file names in the
**Install** section of `README.md` too.

## 3. Build the packages

```bash
pnpm tauri build
```

The first build takes several minutes. The results are in `src-tauri/target/release/bundle/`:

- `deb/Draftwick_0.2.0_amd64.deb`
- `appimage/Draftwick_0.2.0_amd64.AppImage`

## 4. Test the packages

Do not skip this. Test the files you are about to publish, not a `pnpm tauri dev` run.

```bash
# AppImage: runs without installing
chmod +x src-tauri/target/release/bundle/appimage/Draftwick_0.2.0_amd64.AppImage
./src-tauri/target/release/bundle/appimage/Draftwick_0.2.0_amd64.AppImage

# .deb: installs on your system
sudo apt install ./src-tauri/target/release/bundle/deb/Draftwick_0.2.0_amd64.deb
```

Check that Draftwick appears in the launcher, starts, the icon is right, you can type and a draft
is saved, and Help > About shows the new version. Remove the test install afterwards with
`sudo apt remove draftwick`.

## 5. Make the checksums

Checksums let people verify their download.

```bash
cd src-tauri/target/release/bundle
sha256sum deb/Draftwick_0.2.0_amd64.deb appimage/Draftwick_0.2.0_amd64.AppImage > SHA256SUMS.txt
cat SHA256SUMS.txt
cd -
```

## 6. Commit and tag

```bash
git add package.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json README.md
git commit -m "Release 0.2.0"
git tag -a v0.2.0 -m "Draftwick 0.2.0"
```

## 7. Push

The repository's remote is `origin`. The first push of a new repository:

```bash
git push -u origin main
```

Later pushes, and the tag:

```bash
git push origin main
git push origin v0.2.0
```

## 8. Create the release on GitHub

In the browser:

1. Open <https://github.com/surajitbasak109/draftwick/releases>.
2. Choose **Draft a new release**.
3. **Choose a tag:** select `v0.2.0`.
4. **Release title:** `Draftwick 0.2.0`.
5. **Description:** list what is new (see the template below).
6. Drag these files into **Attach binaries**:
   - `Draftwick_0.2.0_amd64.deb`
   - `Draftwick_0.2.0_amd64.AppImage`
   - `SHA256SUMS.txt`
7. For an early version, tick **Set as a pre-release**. Leave it unticked once you consider it stable.
8. Choose **Publish release**.

If you install the [GitHub CLI](https://cli.github.com/) (`gh`), the same thing is one command:

```bash
gh release create v0.2.0 \
  src-tauri/target/release/bundle/deb/Draftwick_0.2.0_amd64.deb \
  src-tauri/target/release/bundle/appimage/Draftwick_0.2.0_amd64.AppImage \
  src-tauri/target/release/bundle/SHA256SUMS.txt \
  --title "Draftwick 0.2.0" --notes-file RELEASE_NOTES.md
```

### Release notes template

```markdown
## What's new
- ...

## Fixes
- ...

## Install
- Debian or Ubuntu: `sudo apt install ./Draftwick_0.2.0_amd64.deb`
- Any recent Linux: make the AppImage executable (`chmod +x`) and run it.

Verify a download with `sha256sum -c SHA256SUMS.txt`.
```

## 9. After publishing

- Open the release page, download one package, and install it once, to be sure the upload is intact.
- Check that the README's Releases link and install file names match.

## Good to know

- **Linux only so far.** `pnpm tauri build` builds for the system it runs on, so these steps give
  Linux packages only. Windows and macOS packages need to be built on those systems (or in CI).
- **Snap and the Ubuntu archive** are separate projects, not part of this process.
- **Mistakes:** if a tag is wrong, delete it (`git tag -d v0.2.0`, and
  `git push origin :refs/tags/v0.2.0` if it was pushed) before anyone depends on it. Once people
  have downloaded a release, publish a new version rather than changing the old one.
- **Later, automatically:** a GitHub Actions workflow can build and attach the packages whenever
  you push a `v*` tag. Worth setting up once releases become routine.
