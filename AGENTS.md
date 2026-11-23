# Repository guidance

For automated tests, see [tests/AGENTS.md](tests/AGENTS.md).

## Release

Run `./scripts/package.sh` with `zip` and `glib-compile-schemas` installed to build `dist/kimpanel-osk-bridge@chenxiex.github.io.shell-extension.zip`. On Debian and Ubuntu, `glib-compile-schemas` is provided by `libglib2.0-bin`. Pass an output directory as the first argument to choose another location. The script compiles the GSettings schema in its staging directory and includes the XML, compiled schema and license in the ZIP.

Update the extension version in `metadata.json` and commit it. Then push a new version tag, for example `v1.0.0`.

```sh
git tag -a v1.0.0 -m "Release v1.0.0"
git push origin v1.0.0
```

GitHub Actions runs the tests, builds the ZIP with the same script, and attaches it to the GitHub Release for the tag.
