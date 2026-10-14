/**
 * PatriotEver Cell Studio for JupyterLab 4.
 * MIT. No telemetry, no services, no fetch, no uploads, no third-party APIs.
 * Debugging uses the built-in JupyterLab debugger & Jupyter kernel debug protocol.
 */
import type { JupyterFrontEnd, JupyterFrontEndPlugin } from '@jupyterlab/application';
import { ICommandPalette, showErrorMessage } from '@jupyterlab/apputils';
import type { CodeCell } from '@jupyterlab/cells';
import { IDebugger, IDebuggerHandler, IDebuggerSidebar } from '@jupyterlab/debugger';
import { INotebookTracker, NotebookActions, NotebookPanel } from '@jupyterlab/notebook';
import { ISettingRegistry } from '@jupyterlab/settingregistry';
import { firstExecutableLine, sectionBounds, type SectionCell } from './sections';
import '../style/index.css';

const PLUGIN_ID = '@patriotever/jupyterlab-cell-studio:plugin';
const COMMAND = {
  run: 'cell-studio:run-cell',
  debug: 'cell-studio:debug-cell',
  enable: 'cell-studio:enable-debugger',
  breakpoint: 'cell-studio:toggle-breakpoint',
  above: 'cell-studio:run-above',
  below: 'cell-studio:run-below',
  section: 'cell-studio:run-section',
  duplicate: 'cell-studio:duplicate-cell',
  insert: 'cell-studio:insert-cell-below',
  clear: 'cell-studio:clear-output',
  moveUp: 'cell-studio:move-cell-up',
  moveDown: 'cell-studio:move-cell-down',
  output: 'cell-studio:toggle-output',
  variables: 'cell-studio:show-variables'
} as const;

type Action = keyof typeof COMMAND;
interface Options {
  pauseAtFirstLine: boolean;
  showDurations: boolean;
}

function cellIndex(panel: NotebookPanel, cell: CodeCell): number {
  return panel.content.widgets.indexOf(cell);
}

function focusCell(panel: NotebookPanel, cell: CodeCell): boolean {
  const index = cellIndex(panel, cell);
  if (index < 0) return false;
  NotebookActions.deselectAll(panel.content);
  panel.content.activeCellIndex = index;
  return true;
}

function cellSources(panel: NotebookPanel): SectionCell[] {
  return panel.content.widgets.map(cell => {
    const type = cell.model.type;
    return {
      type: type === 'code' || type === 'markdown' ? type : 'raw',
      source: cell.model.sharedModel.getSource()
    };
  });
}

function showFailure(reason: unknown): void {
  const message = reason instanceof Error ? reason.message : String(reason);
  void showErrorMessage('Cell Studio', message);
}

const plugin: JupyterFrontEndPlugin<void> = {
  id: PLUGIN_ID,
  description: 'Private, per-cell debugging and notebook workflow tools',
  autoStart: true,
  requires: [INotebookTracker, IDebugger, IDebuggerHandler],
  optional: [ICommandPalette, ISettingRegistry, IDebuggerSidebar],
  activate: async (
    app: JupyterFrontEnd,
    tracker: INotebookTracker,
    debuggerService: IDebugger,
    debuggerHandler: IDebugger.IHandler,
    palette: ICommandPalette | null,
    settingsRegistry: ISettingRegistry | null,
    debuggerSidebar: IDebugger.ISidebar | null
  ): Promise<void> => {
    const options: Options = { pauseAtFirstLine: true, showDurations: true };
    if (settingsRegistry) {
      try {
        const settings = await settingsRegistry.load(PLUGIN_ID);
        const updateOptions = () => {
          options.pauseAtFirstLine = settings.composite['pauseAtFirstLine'] !== false;
          options.showDurations = settings.composite['showDurations'] !== false;
          document.body.dataset.pclShowDurations = String(options.showDurations);
        };
        updateOptions();
        settings.changed.connect(updateOptions);
      } catch (error) {
        console.warn('Cell Studio settings unavailable:', error);
      }
    }

    // Each notebook has a separate queue: prevents two clicks from racing the debugger.
    const queues = new WeakMap<NotebookPanel, Promise<unknown>>();
    const durations = new WeakMap<object, number>();
    const durationLabels = new WeakMap<CodeCell, HTMLSpanElement>();

    const ensureDebugger = async (panel: NotebookPanel) => {
      await panel.sessionContext.ready;
      const session = panel.sessionContext.session;
      if (!session || !session.kernel) throw new Error('Start a notebook kernel before debugging.');
      if (!(await debuggerService.isAvailable(session))) {
        throw new Error('This kernel does not support Jupyter debugging. Use ipykernel 6+ with debugpy, or another kernel supporting the debug protocol.');
      }
      // Public JupyterLab IHandler API: updateContext also updates the widget.
      await debuggerHandler.updateContext(panel, panel.sessionContext);
      if (!debuggerService.isStarted) await debuggerService.start();
      // Refresh notebook integration after the debugger has started.
      await debuggerHandler.update(panel, session);
      if (debuggerSidebar && !debuggerSidebar.isDisposed) {
        app.shell.activateById(debuggerSidebar.id);
        // Keep the notebook as the active document for subsequent actions.
        app.shell.activateById(panel.id);
      }
    };

    const toggleBreakpoint = async (panel: NotebookPanel, cell: CodeCell) => {
      await ensureDebugger(panel);
      const code = cell.model.sharedModel.getSource();
      if (!code.trim()) throw new Error('Cannot set a breakpoint in an empty cell.');
      const editor = cell.editor;
      if (!editor) throw new Error('The code editor is not ready; select the cell and try again.');
      const line = editor.getCursorPosition().line + 1;
      const codeId = debuggerService.getCodeId(code);
      const existing = debuggerService.model.breakpoints.getBreakpoints(codeId);
      const found = existing.some(bp => bp.line === line);
      const next = found
        ? existing.filter(bp => bp.line !== line)
        : [...existing, { line, verified: false }];
      await debuggerService.updateBreakpoints(code, next);
    };

    const runOne = async (panel: NotebookPanel, cell: CodeCell): Promise<boolean> => {
      if (!focusCell(panel, cell)) return false;
      const began = performance.now();
      const succeeded = await NotebookActions.run(panel.content, panel.sessionContext);
      if (options.showDurations) {
        durations.set(cell.model, performance.now() - began);
        const label = durationLabels.get(cell);
        if (label) label.textContent = `${(durations.get(cell.model)! / 1000).toFixed(2)}s`;
      }
      return succeeded;
    };

    const runRange = async (panel: NotebookPanel, begin: number, end: number) => {
      // Snapshot cell identities to avoid executing newly inserted cells during a run.
      const cells = panel.content.widgets.slice(begin, end);
      for (const cell of cells) {
        if (panel.isDisposed) break;
        if (cell.model.type === 'raw') continue;
        if (cell.model.type === 'markdown') {
          // Render Markdown using native notebook actions, not kernel execution.
          if (!focusCell(panel, cell as CodeCell)) break;
          await NotebookActions.run(panel.content, panel.sessionContext);
          continue;
        }
        const ok = await runOne(panel, cell as CodeCell);
        if (!ok) break;
      }
    };

    const doAction = async (action: Action, panel: NotebookPanel, cell: CodeCell) => {
      app.shell.activateById(panel.id);
      if (!focusCell(panel, cell)) throw new Error('This cell is no longer in the notebook.');
      const index = cellIndex(panel, cell);
      switch (action) {
        case 'run':
          await runOne(panel, cell);
          return;
        case 'enable':
          await ensureDebugger(panel);
          return;
        case 'debug': {
          await ensureDebugger(panel);
          const code = cell.model.sharedModel.getSource();
          if (options.pauseAtFirstLine && code.trim()) {
            const codeId = debuggerService.getCodeId(code);
            const existing = debuggerService.model.breakpoints.getBreakpoints(codeId);
            if (existing.length === 0) {
              const line = firstExecutableLine(code);
              if (line !== null) {
                await debuggerService.updateBreakpoints(code, [{ line, verified: false }]);
              }
            }
          }
          await runOne(panel, cell);
          return;
        }
        case 'breakpoint':
          await toggleBreakpoint(panel, cell);
          return;
        case 'above':
          await runRange(panel, 0, index + 1);
          return;
        case 'below':
          await runRange(panel, index, panel.content.widgets.length);
          return;
        case 'section': {
          const [start, end] = sectionBounds(cellSources(panel), index);
          await runRange(panel, start, end);
          return;
        }
        case 'duplicate':
          NotebookActions.duplicate(panel.content);
          return;
        case 'insert':
          NotebookActions.insertBelow(panel.content);
          return;
        case 'clear':
          NotebookActions.clearOutputs(panel.content);
          return;
        case 'moveUp':
          NotebookActions.moveUp(panel.content);
          return;
        case 'moveDown':
          NotebookActions.moveDown(panel.content);
          return;
        case 'output':
          NotebookActions.toggleOutput(panel.content);
          return;
        case 'variables':
          await ensureDebugger(panel);
          await debuggerService.displayDefinedVariables();
          return;
      }
    };

    const enqueue = (action: Action, panel: NotebookPanel, cell: CodeCell) => {
      const pending = queues.get(panel) ?? Promise.resolve();
      const next = pending.catch(() => undefined).then(() => doAction(action, panel, cell));
      queues.set(panel, next);
      void next.catch(showFailure);
    };

    const actions: { key: Action; label: string }[] = [
      { key: 'run', label: 'Run this cell' },
      { key: 'debug', label: 'Debug cell (activate debugger automatically)' },
      { key: 'enable', label: 'Enable debugging without running' },
      { key: 'breakpoint', label: 'Toggle breakpoint at cursor' },
      { key: 'above', label: 'Run above (including this cell)' },
      { key: 'below', label: 'Run from this cell to end' },
      { key: 'section', label: 'Run Markdown section' },
      { key: 'duplicate', label: 'Duplicate cell below' },
      { key: 'insert', label: 'Insert code cell below' },
      { key: 'clear', label: 'Clear cell output' },
      { key: 'moveUp', label: 'Move cell up' },
      { key: 'moveDown', label: 'Move cell down' },
      { key: 'output', label: 'Show or hide cell output' },
      { key: 'variables', label: 'Open debugger variables view' }
    ];

    // Native command palette support and keyboard-shortcut configurability.
    for (const action of actions) {
      app.commands.addCommand(COMMAND[action.key], {
        label: action.label,
        isEnabled: () => Boolean(tracker.currentWidget?.content.activeCell?.model.type === 'code'),
        execute: () => {
          const panel = tracker.currentWidget;
          const cell = panel?.content.activeCell;
          if (panel && cell?.model.type === 'code') enqueue(action.key, panel, cell as CodeCell);
        }
      });
      palette?.addItem({ category: 'Cell Studio', command: COMMAND[action.key] });
    }

    function makeButton(text: string, title: string, action: Action, panel: NotebookPanel, cell: CodeCell): HTMLButtonElement {
      const button = document.createElement('button');
      button.className = 'pcl-action';
      button.type = 'button';
      button.textContent = text;
      button.title = title;
      button.setAttribute('aria-label', title);
      button.addEventListener('mousedown', ev => ev.preventDefault());
      button.addEventListener('click', ev => {
        ev.preventDefault();
        ev.stopPropagation();
        enqueue(action, panel, cell);
      });
      return button;
    }

    function attachCell(panel: NotebookPanel, cell: CodeCell): void {
      // Widget and model can outlive and be re-created by virtual scrolling.
      if (cell.isDisposed || cell.node.querySelector(':scope > .pcl-toolbar')) return;
      const root = document.createElement('div');
      root.className = 'pcl-toolbar';
      root.setAttribute('role', 'toolbar');
      root.setAttribute('aria-label', 'Cell Studio controls');
      root.appendChild(makeButton('▶ Run', 'Run this code cell', 'run', panel, cell));
      root.appendChild(makeButton('🐞 Debug', 'Activate debugger and run this code cell', 'debug', panel, cell));
      root.appendChild(makeButton('●', 'Toggle breakpoint at current cursor line', 'breakpoint', panel, cell));
      const dropdown = document.createElement('details');
      dropdown.className = 'pcl-more';
      const summary = document.createElement('summary');
      summary.title = 'More notebook actions';
      summary.setAttribute('aria-label', 'More notebook actions');
      summary.textContent = '⋯';
      dropdown.appendChild(summary);
      const menu = document.createElement('div');
      menu.className = 'pcl-menu';
      for (const action of actions.slice(2)) {
        const button = makeButton(action.label, action.label, action.key, panel, cell);
        button.addEventListener('click', () => { dropdown.open = false; });
        menu.appendChild(button);
      }
      dropdown.appendChild(menu);
      root.appendChild(dropdown);
      const elapsed = document.createElement('span');
      elapsed.className = 'pcl-elapsed';
      elapsed.title = 'Last execution duration using Cell Studio';
      if (durations.has(cell.model)) elapsed.textContent = `${(durations.get(cell.model)! / 1000).toFixed(2)}s`;
      root.appendChild(elapsed);
      durationLabels.set(cell, elapsed);
      cell.node.insertBefore(root, cell.node.firstChild);
    }

    function attachPanel(panel: NotebookPanel): void {
      let queued = false;
      const refresh = () => {
        if (queued || panel.isDisposed) return;
        queued = true;
        queueMicrotask(() => {
          queued = false;
          if (panel.isDisposed) return;
          panel.content.widgets.forEach(cell => {
            if (cell.model.type === 'code') attachCell(panel, cell as CodeCell);
          });
        });
      };
      // Works with JupyterLab's virtual-scrolling reattachments and cell additions.
      const observer = new MutationObserver(refresh);
      observer.observe(panel.content.node, { childList: true, subtree: true });
      const onCellsChanged = () => refresh();
      void panel.context.ready.then(() => {
        const model = panel.content.model;
        model?.cells.changed.connect(onCellsChanged);
        panel.disposed.connect(() => {
          observer.disconnect();
          model?.cells.changed.disconnect(onCellsChanged);
        });
        refresh();
      }).catch(showFailure);
      refresh();
    }

    tracker.widgetAdded.connect((_, panel) => attachPanel(panel));
    tracker.forEach(panel => attachPanel(panel));
  }
};

export default plugin;
