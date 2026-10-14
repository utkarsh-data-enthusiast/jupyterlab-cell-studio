# Release and manual acceptance checklist

**Do not publish on a claim of full testing until all checks are complete.**

## 1. Prepare GitHub

Create a public repository named `jupyterlab-cell-studio` under `utkarsh-data-enthusiast` (or update URLs to the actual chosen owner). Upload all project files, including dotfiles `.github/workflows/ci.yml`, `.gitignore`. Enable GitHub Actions, Dependabot, branch protection, private vulnerability reporting.

## 2. Verify a clean build

Prerequisites: Node.js 20+, npm, Python 3.10+ and access to official package registries.

```bash
npm install # commit the generated package-lock.json for reproducible releases
npm run test:sections
npm run check
npm run build
python -m pip wheel . --no-deps -w dist
jupyter labextension list
```

If no `package-lock.json` exists, run `npm install` to generate it and commit it. Avoid publishing until npm has successfully resolved and audited exact dependencies. For testing the wheel use a new disposable environment **only for release testing** (not your normal project interpreter), then `pip install dist/*.whl` and inspect `jupyter labextension list` for enabled `@patriotever/jupyterlab-cell-studio`.

## 3. Browser and kernel acceptance (release gate)

Test Safari/Chrome/Firefox on JupyterLab 4.5 and 4.6 with local ipykernel+debugpy. Open `examples/debug-demo.ipynb` as the initial test fixture. Validate each behavior:

- [ ] Extension loads without console errors, including after refresh.
- [ ] Cell toolbars appear for all cells when scrolling long, virtualized notebooks and adding/moving cells.
- [ ] Run affects the **clicked cell**, not a previously focused cell.
- [ ] Debug starts the core debugger from a fresh session and pauses at the inserted first-line breakpoint.
- [ ] Clicking Debug a second time while active does not restart the debugger.
- [ ] Breakpoint button adds/removes the cursor-line breakpoint without deleting other breakpoints.
- [ ] Native gutter breakpoints, Continue, Step In, Step Out, Next and Variables all work.
- [ ] `pauseAtFirstLine = false` does not add implicit breakpoints.
- [ ] `showDurations = false` hides all duration labels.
- [ ] Run Above, Below and Markdown Section respect source order and stop on failures.
- [ ] Duplicate Cell adds one cell in the right place.
- [ ] Switching kernels/notebooks does not execute a wrong cell or use stale debugger sessions.
- [ ] Kernels without debug capability show a clear error without execution.
- [ ] No third-party network requests are emitted by the extension in developer tools.
- [ ] Extension uninstall, reload, reinstallation and notebook autosave work.

## 4. Publish

1. Add package-lock.json to the repository after successful npm install and audit source and dependencies.
2. Create tag `v0.1.0`, run CI and inspect generated wheel and npm tarball.
3. If npm distribution is desired, publish package with `npm publish --access public` (npm org rights required).
4. If Python wheels pass the checks, upload wheel and sdist to PyPI via Trusted Publishing and `twine` (or `python -m build` then `twine upload`).
5. Users can then use `pip install jupyterlab-cell-studio`. Verify whether the package is indexed in the current JupyterLab Extension Manager; it is not a normal ZIP upload.
6. Create a GitHub Release with the wheel, sdist and source archives, add screenshots **from actual JupyterLab runtime**, not mockups.

## 5. Final audit

- No credentials/tokens in Git repository, archives or screenshots.
- Run `npm audit --omit=dev`, `pip-audit` as applicable, GitHub code scanning and license checks before publication.
- Verify package links and icon render, release notes and README match observed behavior.
- Don't claim feature parity with PyCharm: this extension uses native debugger behavior rather than replicating JetBrains proprietary IDE systems.
