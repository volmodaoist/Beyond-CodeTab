# Contributing to Beyond-CodeTab

Thanks for helping improve code and Markdown tabs in Obsidian. Use [GitHub Issues](https://github.com/volmodaoist/Beyond-CodeTab/issues/new/choose) for bugs and feature requests. For usage questions, open an issue and include the relevant Markdown example.

## Report a bug

Include the plugin version or source commit, Obsidian version, operating system, theme, and whether the note uses Reading view, Live Preview, or Source mode. Provide the smallest Markdown block that reproduces the problem and the steps to reproduce it. A screenshot or short recording helps with layout issues.

Remove private note content, Vault paths, and credentials before attaching examples. Include relevant errors from the Obsidian developer console if available.

## Develop locally

```bash
npm ci
make check
make install vault="/path/to/test-vault"
```

Use a test Vault for development. The installer preserves settings and backs up old plugin files. Disable and re-enable the plugin after copying a build.

`make test-obsidian` runs the existing desktop UI regression in isolated temporary Vaults. `make demos` records the README GIFs and needs FFmpeg. See the [test guide](tests/test-guide.md) and [recording guide](docs/assets/demos/README.md).

## Pull requests

Explain the concrete problem, the resulting behavior, and how you checked the change. Follow [AGENTS.md](AGENTS.md) for source style, component responsibilities, and commit message requirements. Run `make lint-fix` and `make check`; run the relevant real Obsidian regression when changing editing, rendering, or navigation.

Before committing, write the final commit message to a temporary file and run:

```bash
python3 .github/workflows/check-commit.py /path/to/commit-message.txt
git commit --file /path/to/commit-message.txt
```

Keep source attribution and license files. Update the affected user or API documentation when behavior changes. Architecture decisions belong in [evolution-history.md](docs/evolution-history.md).
