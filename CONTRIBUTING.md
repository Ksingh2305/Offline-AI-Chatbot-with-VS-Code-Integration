# Contributing to LocalForge

Thanks for considering a contribution. This is a personal/portfolio project, but issues and pull requests are welcome.

## Getting started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/<you>/localforge.git`
3. Set up the desktop app and extension following their respective READMEs:
   - [`desktop-app/README.md`](desktop-app/README.md)
   - [`vscode-extension/README.md`](vscode-extension/README.md)

## Development workflow

```bash
# Desktop app — live reload
cd desktop-app
npm run tauri dev

# VS Code extension — watch mode
cd vscode-extension
npm run watch
# then press F5 in VS Code to launch an Extension Development Host
```

## Making changes

- Keep the `ModelProvider` trait abstraction intact — new inference backends should implement the trait, not special-case call sites.
- Frontend and Rust code should compile without warnings (`cargo build` and `tsc` both run clean).
- If you change the IPC surface (`commands.rs`), update `src/lib/ipc.ts` to match.
- Extension changes should be tested against a running desktop app instance, not mocked — the whole point of this project is the local engine integration.

## Commit style

Clear, present-tense commit messages (`Add repo indexing progress bar`, not `Added stuff`). Reference issues where relevant.

## Pull requests

- Describe what changed and why, not just what
- Include a screenshot or terminal output for UI/behavioural changes
- Keep PRs focused — one concern per PR is easier to review

## Reporting issues

Please include:
- OS and version
- Steps to reproduce
- Relevant output from VS Code's **Output → LocalForge** channel or the desktop app's console
