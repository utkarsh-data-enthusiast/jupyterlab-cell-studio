# PyCharm vs JupyterLab: realistic feature matrix

This project is **not a port of JetBrains proprietary functionality**. Reimplementing every PyCharm feature would require building an entire IDE. Prefer the native JupyterLab implementation whenever available.

| Capability | PyCharm notebooks | Core JupyterLab 4 | Cell Studio 0.1.0 |
|---|---|---|---|
| Run selected code cell | Yes | Yes | Distinct per-cell Run button |
| Cell-by-cell debugging | Yes | Yes, when debugger enabled and kernel supports debug protocol | One-click enable + run |
| Automatic debug activation on clicking a cell | Yes | Requires user toggle first | Yes |
| Auto stop near start of a cell | With breakpoints | Requires breakpoints | Adds first-line breakpoint if none exist and setting enabled |
| Breakpoint gutter | Yes | Yes, when debugger enabled | Reuses native gutter |
| Toggle breakpoint from selected line | Yes | Click gutter | Additional button |
| Step over / into / out / continue | Yes | Yes | Reuses native debugger side panel |
| Variables and stack traces | Yes | Yes during debugging | Shortcut to existing debugger variables view |
| Run all cells above/below | Yes | Yes in command palette | Direct cell action buttons |
| Run code under Markdown heading | Yes | May be available via ToC commands in some versions | Explicit Run Section action |
| Duplicate, insert, reorder cells | Yes | Yes | Direct cell actions |
| Clear/collapse code output | Yes | Yes | Direct cell actions |
| Timed code execution | Yes | Core execution timing UI/plugin varies by version | Times runs launched from Cell Studio |
| Kernel memory graph | Yes | Not identical | Not implemented |
| DataFrame spreadsheet-style editor | Yes | Display / third-party extensions | Not implemented |
| Inline values inside source editor | Yes | Partial debugger hover inspection, version dependent | Not implemented |
| Python completion, syntax highlighting | Yes | Yes, CodeMirror and completer | Leaves built-in enabled |
| Symbol refactoring/indexing | Advanced | Varies with language server plugins | Not implemented |
| AI assistant | Optional proprietary integrations | Available via third-party services/extensions | Not implemented (no remote AI, for privacy) |
| Debug MySQL stored routines | Not through notebook Python debugger | Not through built-in notebook debug protocol | Not implemented (separate project) |

The extension should coexist with existing JupyterLab extensions; adding duplicate features without clear value makes JupyterLab slower and harder to use.
