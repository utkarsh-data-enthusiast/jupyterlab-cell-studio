<div align="center">
  <img src="style/icon.svg" alt="Cell Studio icon" width="120" height="120" />
  <h1>Cell Studio — JupyterLab cell debugger</h1>
  <p><strong>Debug a cell with one click. Private by design. Fully MIT licensed.</strong></p>
</div>

**Cell Studio** is an open-source JupyterLab 4 extension adding per-code-cell controls inspired by PyCharm's notebook workflow. It integrates with the **native JupyterLab debugger**; it does not patch Jupyter kernels or send notebook contents to external services.

> **Release status:** 0.1.0 source release. TypeScript integration and in-browser debugging require building and runtime acceptance tests before distribution to end users. See [Release checklist](docs/RELEASE.md). The supplied source can be built and packaged using the commands below. PyPI/npm names and GitHub repository URLs are *planned*, not currently published by this project.

## Features

| Feature | Behavior |
|---|---|
| **▶ Run** | Executes the clicked code cell in the active kernel. |
| **🐞 Debug** | Checks kernel support, activates the native debugger, sets a breakpoint at the first nonblank noncomment line *if no breakpoint exists*, then runs that cell. |
| **● Breakpoint** | Adds/removes a breakpoint at the cell editor's cursor line, preserving other breakpoints. |
| **Enable debugger** | Enables native debugger without executing the cell. |
| **Debugger tools** | Uses native JupyterLab debugging: breakpoints, variables, call stack, pause/continue, step over/in/out, conditional support depending on kernel. |
| **Run above/below** | Executes cells in notebook order, halting on an execution error. |
| **Run Markdown section** | Executes cells in a Markdown heading's section, including nested subsections. |
| **Manage cells** | Duplicate, insert below, move up/down, clear output, show/hide output. |
| **Show variables** | Opens the native debugger variable view. |
| **Execution duration** | Shows elapsed time for a code cell executed *through Cell Studio*. |
| **Command palette** | Actions are available in JupyterLab's command palette for shortcut binding. |
| **Settings** | Disable automatically adding an initial breakpoint, or hide execution timings. |

### What it does *not* claim

It is **not a full copy of PyCharm**. IntelliJ indexing/refactorings, PyCharm's graphical DataFrame editor, memory widget, proprietary AI assistance and JetBrains debugger internals are not included. JupyterLab's built-in features already cover many editing, completion, console, and data visualization tasks. Python package debugging is controlled by the kernel, `debugpy`, and JupyterLab's debug service; this extension cannot force a kernel without debugger support to debug. Debugging within SQL notebooks requires a separate SQL-capable debugger/kernel and is **not** provided by this extension.

## Requirements

- JupyterLab **4.5 or 4.6** (Node 20+ is needed to **build** from source, not to run a prebuilt install).
- `ipykernel >= 6` and `debugpy` for the common Python notebook debugger, in the **same existing kernel environment**. No duplicate virtual environment is needed.
- The JupyterLab core debugger plugin must be enabled (normally built in).
- The notebook kernel must be running before Debug Cell is used.

## Install locally from source (developer / prerelease)

Clone this repository or unzip the project, then in its root:

```bash
npm install
npm run build
python -m pip install .
jupyter labextension list
jupyter lab
```

If you use a `venv` already providing Python, JupyterLab and ipykernel, activate it and reuse it. `pip install .` uses Python build isolation to create a wheel; npm dependencies are needed only for building. To avoid duplicate npm build work when building wheels see the [release guide](docs/RELEASE.md).

**Once published to PyPI**, the intended user installation will be `pip install jupyterlab-cell-studio`. **Do not assume that command works until an official release exists.**

## Use

The included [`examples/debug-demo.ipynb`](examples/debug-demo.ipynb) works offline with a Python kernel and exercises debugging and section boundaries.

1. Open any notebook with a compatible Python kernel. Each code cell has a Cell Studio toolbar.
2. Click **Debug** on the desired cell. The Jupyter debugger starts, an initial breakpoint is added only if the cell has none, and that cell executes. Click the margin/gutter of code lines to manage additional breakpoints, or position the caret and click **●**.
3. When paused, use JupyterLab's built-in debugger side panel to inspect variables and step through the code. This extension does not replace the native stepping UI.
4. Use **⋯** on the cell toolbar for Run Above, Run Below, Run Markdown Section, cell organization, output visibility, and native Variables.
5. Change *pauseAtFirstLine* or *showDurations* under Settings → Advanced Settings Editor → Cell Studio.

### Common caveats

- Breakpoints are tied to exact **source text** and can change identity if you edit a cell; this is normal behavior for the Jupyter debug protocol.
- Notebook *execution order* matters: this extension does not silently execute previous cells just to satisfy missing imports/variables.
- Debugging with some remote kernels may not be supported. Debug output may differ for `xeus-python`, `ipykernel`, and other debug-compatible kernels.
- Debugging a cell with existing breakpoints leaves them unchanged. With no breakpoints, the default initial break can be disabled in settings.
- Execution durations show only executions started using this extension's actions, not those started through the stock JupyterLab toolbar.

## Privacy and security

**No ads, tracking pixels, cookies, analytics, telemetry, third-party SDKs, or outbound HTTP calls from the extension.** See [PRIVACY.md](PRIVACY.md) and [SECURITY.md](SECURITY.md). See the [PyCharm feature matrix](docs/FEATURE_MATRIX.md) for implemented, built-in, and unsupported capabilities. Running and debugging *user-authored notebook code* can itself access networks and files; that is controlled by the notebook and kernel, not by this extension. This README avoids externally hosted badge images.

## Developer checks

```bash
npm install
npm run test:sections
npm run check
npm run build
python -m pip wheel . --no-deps -w dist
```

The `tests/sections.test.cjs` suite exercises pure heading/breakpoint helpers. `CI` additionally builds Python wheel and checks packaging. Browser/kernel integration tests remain required before publishing v1.0.

## Publishing

See [docs/RELEASE.md](docs/RELEASE.md) for GitHub, npm, PyPI, manual acceptance testing, and the extension directory. **The JupyterLab Extension Manager is not a direct upload portal**: discoverability usually follows indexed installable packages. Verify its current listing process before announcing availability.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Copyright (c) 2026 PatriotEver Lab contributors. Licensed under [MIT](LICENSE).
