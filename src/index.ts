/**
 * PatriotEver Cell Studio for JupyterLab 4
 *
 * Copyright (c) PatriotEver Lab
 * License: MIT
 *
 * Features:
 * - One compact horizontal floating toolbar
 * - Python cell execution and debugging
 * - Breakpoints, stepping and debugger controls
 * - Variables and call-stack inspection
 * - Notebook and kernel controls
 * - Standalone MySQL execution
 * - Blank SQL cells above or below existing cells
 * - SQL results in normal notebook output areas
 * - Named MySQL login-path connections
 *
 * Privacy:
 * - No telemetry or analytics
 * - No advertisements
 * - No third-party tracking
 * - No application-controlled HTTP requests
 * - No database passwords stored in notebooks
 *
 * SQL execution uses the installed MySQL client.
 * JupySQL, %sql and %%sql are not required.
 */

import type {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';

import {
  ICommandPalette,
  showErrorMessage
} from '@jupyterlab/apputils';

import type { CodeCell } from '@jupyterlab/cells';

import {
  IDebugger,
  IDebuggerHandler,
  IDebuggerSidebar
} from '@jupyterlab/debugger';

import {
  INotebookTracker,
  NotebookActions,
  NotebookPanel
} from '@jupyterlab/notebook';

import {
  ISettingRegistry
} from '@jupyterlab/settingregistry';

import {
  firstExecutableLine,
  sectionBounds,
  type SectionCell
} from './sections';

import '../style/index.css';


/* ============================================================
   PLUGIN IDENTIFICATION
   ============================================================ */

const PLUGIN_ID =
  '@patriotever/jupyterlab-cell-studio:plugin';


/* ============================================================
   COMMAND IDENTIFIERS
   ============================================================ */

const COMMAND = {
  run: 'cell-studio:run-cell',
  runAll: 'cell-studio:run-all',
  debug: 'cell-studio:debug-cell',
  enable: 'cell-studio:enable-debugger',
  breakpoint: 'cell-studio:toggle-breakpoint',
  continue: 'cell-studio:continue',
  pause: 'cell-studio:pause',
  stepOver: 'cell-studio:step-over',
  stepInto: 'cell-studio:step-into',
  stepOut: 'cell-studio:step-out',
  stopDebug: 'cell-studio:stop-debugger',
  restartDebug: 'cell-studio:restart-debugger',
  interrupt: 'cell-studio:interrupt-kernel',
  restartKernel: 'cell-studio:restart-kernel',
  variables: 'cell-studio:show-variables',
  callstack: 'cell-studio:show-callstack',
  clearBreakpoints: 'cell-studio:clear-breakpoints',

  // Legacy command retained for compatibility.
  sqlCell: 'cell-studio:insert-sql-cell',

  // New dedicated SQL insertion commands.
  sqlAbove: 'cell-studio:insert-sql-above',
  sqlBelow: 'cell-studio:insert-sql-below',

  sqlConnect: 'cell-studio:connect-sql',

  above: 'cell-studio:run-above',
  below: 'cell-studio:run-below',
  section: 'cell-studio:run-section',
  duplicate: 'cell-studio:duplicate-cell',
  insert: 'cell-studio:insert-cell-below',
  clear: 'cell-studio:clear-output',
  moveUp: 'cell-studio:move-cell-up',
  moveDown: 'cell-studio:move-cell-down',
  output: 'cell-studio:toggle-output'
} as const;

type Action = keyof typeof COMMAND;

interface Options {
  pauseAtFirstLine: boolean;
  showDurations: boolean;
}


/* ============================================================
   NOTEBOOK HELPERS
   ============================================================ */

function cellIndex(
  panel: NotebookPanel,
  cell: CodeCell
): number {
  return panel.content.widgets.indexOf(cell);
}


function focusCell(
  panel: NotebookPanel,
  cell: CodeCell
): boolean {
  const index = cellIndex(panel, cell);

  if (index < 0) {
    return false;
  }

  NotebookActions.deselectAll(panel.content);
  panel.content.activeCellIndex = index;

  return true;
}


function cellSources(
  panel: NotebookPanel
): SectionCell[] {
  return panel.content.widgets.map(cell => {
    const type = cell.model.type;

    return {
      type:
        type === 'code' || type === 'markdown'
          ? type
          : 'raw',
      source: cell.model.sharedModel.getSource()
    };
  });
}


/* ============================================================
   SQL CELL IDENTIFICATION
   ============================================================ */

/**
 * SQL cells remain standard .ipynb code cells.
 *
 * Cell Studio metadata identifies their language.
 *
 * This allows ordinary SQL source to be saved in
 * standard notebook files.
 */

function isSqlCell(cell: CodeCell): boolean {
  const metadata = cell.model.getMetadata(
    'patrioteverCellStudio'
  ) as {
    language?: string;
  } | undefined;

  if (metadata?.language === 'sql') {
    return true;
  }

  // Compatibility with older JupySQL-based cells.
  return /^\s*%%sql(?:\s|$)/.test(
    cell.model.sharedModel.getSource()
  );
}


function markSqlCell(cell: CodeCell): void {
  const previous = cell.model.getMetadata(
    'patrioteverCellStudio'
  ) as Record<string, unknown> | undefined;

  if (previous?.language !== 'sql') {
    cell.model.setMetadata(
      'patrioteverCellStudio',
      {
        ...(previous ?? {}),
        language: 'sql'
      }
    );
  }

  if (cell.model.mimeType !== 'text/x-sql') {
    cell.model.mimeType = 'text/x-sql';
  }

  cell.node.classList.add('pcl-sql-cell');
}


/* ============================================================
   ERROR HANDLING
   ============================================================ */

function showFailure(reason: unknown): void {
  const message =
    reason instanceof Error
      ? reason.message
      : String(reason);

  void showErrorMessage(
    'PatriotEver Cell Studio',
    message
  );
}


/* ============================================================
   STANDALONE MYSQL EXECUTOR
   ============================================================ */

/**
 * Build Python bridge code for executing SQL.
 *
 * The SQL remains visible as ordinary SQL in the notebook.
 *
 * No JupySQL dependency.
 *
 * SQL is passed to the MySQL client through standard input.
 *
 * The MySQL client is launched without shell interpretation.
 *
 * Authentication uses a named MySQL login path.
 */

function createStandaloneSqlExecution(
  sql: string,
  loginPath: string
): string {
  const encodedSql = JSON.stringify(
    JSON.stringify(sql)
  );

  const encodedLoginPath = JSON.stringify(
    JSON.stringify(loginPath)
  );

  return `
import json as _pcl_json
import os as _pcl_os
import shutil as _pcl_shutil
import subprocess as _pcl_subprocess

_pcl_sql = _pcl_json.loads(${encodedSql})
_pcl_login_path = _pcl_json.loads(${encodedLoginPath})

_pcl_mysql = (
    _pcl_os.environ.get("CELL_STUDIO_MYSQL_BIN")
    or _pcl_shutil.which("mysql")
    or "/usr/local/mysql/bin/mysql"
)

if not _pcl_os.path.isfile(_pcl_mysql):
    raise RuntimeError(
        "MySQL client not found. "
        "Check the MySQL installation or "
        "configure CELL_STUDIO_MYSQL_BIN."
    )

_pcl_command = [
    _pcl_mysql,
    "--no-defaults",
    "--login-path=" + _pcl_login_path,
    "--batch",
    "--table",
    "--default-character-set=utf8mb4",
    "--local-infile=0",
    "--connect-timeout=10"
]

_pcl_environment = _pcl_os.environ.copy()

_pcl_environment["MYSQL_HISTFILE"] = "/dev/null"

try:
    _pcl_result = _pcl_subprocess.run(
        _pcl_command,
        input=_pcl_sql,
        text=True,
        capture_output=True,
        encoding="utf-8",
        timeout=120,
        env=_pcl_environment,
        check=False
    )

except _pcl_subprocess.TimeoutExpired:
    raise RuntimeError(
        "SQL execution exceeded the 120-second limit."
    )

if _pcl_result.stdout:
    print(_pcl_result.stdout, end="")

if _pcl_result.returncode != 0:
    raise RuntimeError(
        _pcl_result.stderr.strip()
        or "MySQL query execution failed."
    )

if not _pcl_result.stdout.strip():
    print("SQL statement executed successfully.")
`;
}


/* ============================================================
   EXECUTE SQL IN A NOTEBOOK CELL
   ============================================================ */

async function executeStandaloneSql(
  panel: NotebookPanel,
  cell: CodeCell,
  loginPath: string
): Promise<boolean> {
  await panel.sessionContext.ready;

  const kernel = panel.sessionContext.session?.kernel;

  if (!kernel) {
    throw new Error(
      'Start a Jupyter kernel before executing SQL.'
    );
  }

  let sql = cell.model.sharedModel.getSource();

  /*
   * Convert older JupySQL cells into plain SQL cells.
   */

  if (/^\s*%%sql[^\r\n]*(?:\r?\n|$)/.test(sql)) {
    sql = sql.replace(
      /^\s*%%sql[^\r\n]*(?:\r?\n|$)/,
      ''
    );

    cell.model.sharedModel.setSource(sql);
  }

  if (!sql.trim()) {
    throw new Error('The SQL cell is empty.');
  }

  markSqlCell(cell);

  const code = createStandaloneSqlExecution(
    sql,
    loginPath
  );

  /*
   * Clear previous results.
   */

  cell.model.outputs.clear();
  cell.model.executionCount = null;

  /*
   * Running and idle are valid JupyterLab execution states.
   */

  cell.model.executionState = 'running';
  cell.outputHidden = false;

  try {
    const future = kernel.requestExecute(
      {
        code,
        stop_on_error: true,
        store_history: false
      },
      false
    );

    /*
     * Attach output to the original SQL cell.
     */

    cell.outputArea.future = future;

    const reply = await future.done;

    if (
      'execution_count' in reply.content &&
      typeof reply.content.execution_count === 'number'
    ) {
      cell.model.executionCount =
        reply.content.execution_count;
    }

    /*
     * Errors are represented by kernel replies and outputs.
     */

    if (reply.content.status === 'error') {
      return false;
    }

    return reply.content.status === 'ok';

  } finally {
    cell.model.executionState = 'idle';
  }
}


/* ============================================================
   JUPYTERLAB PLUGIN
   ============================================================ */

const plugin: JupyterFrontEndPlugin<void> = {
  id: PLUGIN_ID,

  description:
    'Privacy-first JupyterLab debugger and standalone SQL studio',

  autoStart: true,

  requires: [
    INotebookTracker,
    IDebugger,
    IDebuggerHandler
  ],

  optional: [
    ICommandPalette,
    ISettingRegistry,
    IDebuggerSidebar
  ],

  activate: async (
    app: JupyterFrontEnd,
    tracker: INotebookTracker,
    debuggerService: IDebugger,
    debuggerHandler: IDebugger.IHandler,
    palette: ICommandPalette | null,
    settingsRegistry: ISettingRegistry | null,
    debuggerSidebar: IDebugger.ISidebar | null
  ): Promise<void> => {

    /* ========================================================
       SETTINGS
       ======================================================== */

    const options: Options = {
      pauseAtFirstLine: true,
      showDurations: true
    };

    if (settingsRegistry) {
      try {
        const settings =
          await settingsRegistry.load(PLUGIN_ID);

        const updateOptions = () => {
          options.pauseAtFirstLine =
            settings.composite['pauseAtFirstLine'] !== false;

          options.showDurations =
            settings.composite['showDurations'] !== false;

          document.body.dataset.pclShowDurations =
            String(options.showDurations);
        };

        updateOptions();
        settings.changed.connect(updateOptions);

      } catch (error) {
        console.warn(
          'Cell Studio settings unavailable:',
          error
        );
      }
    }


    /* ========================================================
       INTERNAL STATE
       ======================================================== */

    const queues =
      new WeakMap<NotebookPanel, Promise<unknown>>();

    const durations =
      new WeakMap<object, number>();

    const durationLabels =
      new WeakMap<CodeCell, HTMLSpanElement>();

    const mysqlConnections =
      new WeakMap<NotebookPanel, string>();

    const floatingToolbars =
      new Map<NotebookPanel, HTMLElement>();

    /*
     * Debugger stepping must bypass execution queues.
     */

    const immediateActions: ReadonlySet<Action> = new Set([
      'continue',
      'pause',
      'stepOver',
      'stepInto',
      'stepOut',
      'stopDebug',
      'restartDebug',
      'interrupt',
      'restartKernel',
      'callstack',
      'variables',
      'clearBreakpoints'
    ]);


    /* ========================================================
       DEBUGGER VALIDATION
       ======================================================== */

    const requireDebugger = (
      paused = false
    ): void => {
      if (!debuggerService.isStarted) {
        throw new Error(
          'Activate the debugger before using this control.'
        );
      }

      if (
        paused &&
        !debuggerService.hasStoppedThreads()
      ) {
        throw new Error(
          'Execution must be paused at a breakpoint.'
        );
      }
    };


    /* ========================================================
       START DEBUGGER
       ======================================================== */

    const ensureDebugger = async (
      panel: NotebookPanel
    ) => {
      await panel.sessionContext.ready;

      const session = panel.sessionContext.session;

      if (!session?.kernel) {
        throw new Error(
          'Start a Jupyter kernel before debugging.'
        );
      }

      if (!(await debuggerService.isAvailable(session))) {
        throw new Error(
          'This kernel does not support Jupyter debugging. ' +
          'Use a Python kernel with debugpy support.'
        );
      }

      await debuggerHandler.updateContext(
        panel,
        panel.sessionContext
      );

      if (!debuggerService.isStarted) {
        await debuggerService.start();
      }

      await debuggerHandler.update(
        panel,
        session
      );

      if (
        debuggerSidebar &&
        !debuggerSidebar.isDisposed
      ) {
        app.shell.activateById(debuggerSidebar.id);
        app.shell.activateById(panel.id);
      }
    };


    /* ========================================================
       BREAKPOINT HANDLING
       ======================================================== */

    const toggleBreakpoint = async (
      panel: NotebookPanel,
      cell: CodeCell
    ) => {
      if (isSqlCell(cell)) {
        throw new Error(
          'Python breakpoints cannot debug MySQL statements.'
        );
      }

      await ensureDebugger(panel);

      const code = cell.model.sharedModel.getSource();

      if (!code.trim()) {
        throw new Error(
          'Cannot set a breakpoint in an empty cell.'
        );
      }

      const editor = cell.editor;

      if (!editor) {
        throw new Error('Code editor is not ready.');
      }

      const line = editor.getCursorPosition().line + 1;

      const codeId = debuggerService.getCodeId(code);

      const existing =
        debuggerService.model.breakpoints.getBreakpoints(
          codeId
        );

      const found = existing.some(
        bp => bp.line === line
      );

      const next = found
        ? existing.filter(bp => bp.line !== line)
        : [
            ...existing,
            {
              line,
              verified: false
            }
          ];

      await debuggerService.updateBreakpoints(
        code,
        next
      );
    };


    /* ========================================================
       RUN ONE CELL
       ======================================================== */

    const runOne = async (
      panel: NotebookPanel,
      cell: CodeCell
    ): Promise<boolean> => {
      if (!focusCell(panel, cell)) {
        return false;
      }

      const began = performance.now();

      let succeeded: boolean;

      if (isSqlCell(cell)) {
        const loginPath = mysqlConnections.get(panel);

        if (!loginPath) {
          throw new Error(
            'Select a MySQL connection using the ' +
            'database button before executing SQL.'
          );
        }

        succeeded = await executeStandaloneSql(
          panel,
          cell,
          loginPath
        );

      } else {
        succeeded = await NotebookActions.run(
          panel.content,
          panel.sessionContext
        );
      }

      if (options.showDurations) {
        durations.set(
          cell.model,
          performance.now() - began
        );

        const label = durationLabels.get(cell);

        if (label) {
          label.textContent =
            `${(
              durations.get(cell.model)! / 1000
            ).toFixed(2)}s`;
        }
      }

      return succeeded;
    };


    /* ========================================================
       RUN MULTIPLE CELLS
       ======================================================== */

    const runRange = async (
      panel: NotebookPanel,
      begin: number,
      end: number
    ) => {
      const cells = panel.content.widgets.slice(
        begin,
        end
      );

      for (const cell of cells) {
        if (panel.isDisposed) {
          break;
        }

        if (cell.model.type === 'raw') {
          continue;
        }

        if (cell.model.type === 'markdown') {
          if (!focusCell(panel, cell as CodeCell)) {
            break;
          }

          await NotebookActions.run(
            panel.content,
            panel.sessionContext
          );

          continue;
        }

        const ok = await runOne(
          panel,
          cell as CodeCell
        );

        if (!ok) {
          break;
        }
      }
    };


    /* ========================================================
       ACTION HANDLER
       ======================================================== */

    const doAction = async (
      action: Action,
      panel: NotebookPanel,
      cell: CodeCell
    ) => {
      app.shell.activateById(panel.id);

      if (!focusCell(panel, cell)) {
        throw new Error(
          'This cell is no longer in the notebook.'
        );
      }

      const index = cellIndex(panel, cell);

      switch (action) {

        /* ====================================================
           CREATE BLANK SQL CELL ABOVE OR BELOW

           sqlCell is retained as a legacy alias for
           inserting a SQL cell below.
           ==================================================== */

        case 'sqlCell':
        case 'sqlAbove':
        case 'sqlBelow': {

          /*
           * Use JupyterLab's native notebook insertion.
           *
           * The newly inserted cell becomes the active cell.
           */

          if (action === 'sqlAbove') {
            NotebookActions.insertAbove(panel.content);
          } else {
            NotebookActions.insertBelow(panel.content);
          }

          const added = panel.content.activeCell;

          if (!added || added.model.type !== 'code') {
            throw new Error(
              'Unable to create a SQL code cell.'
            );
          }

          const sqlCell = added as CodeCell;

          /*
           * IMPORTANT:
           *
           * New SQL cells start completely blank.
           *
           * No SELECT 1;
           * No %sql
           * No %%sql
           */

          sqlCell.model.sharedModel.setSource('');

          markSqlCell(sqlCell);

          return;
        }


        /* ====================================================
           MYSQL CONNECTION
           ==================================================== */

        case 'sqlConnect': {
          const current =
            mysqlConnections.get(panel) ?? '';

          const response = window.prompt(
            'Enter an existing MySQL login-path name ' +
            '(configured with mysql_config_editor). ' +
            'Do not enter a password:',
            current
          );

          if (response === null) {
            return;
          }

          const name = response.trim();

          if (
            !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(name)
          ) {
            throw new Error(
              'Invalid MySQL login-path name.'
            );
          }

          mysqlConnections.set(panel, name);
          return;
        }


        /* ====================================================
           DEBUGGER CONTROLS
           ==================================================== */

        case 'continue':
          requireDebugger(true);
          await debuggerService.continue();
          return;

        case 'pause':
          requireDebugger();
          await debuggerService.pause();
          return;

        case 'stepOver':
          requireDebugger(true);
          await debuggerService.next();
          return;

        case 'stepInto':
          requireDebugger(true);
          await debuggerService.stepIn();
          return;

        case 'stepOut':
          requireDebugger(true);
          await debuggerService.stepOut();
          return;

        case 'stopDebug':
          requireDebugger();
          await debuggerService.stop();
          return;

        case 'restartDebug':
          requireDebugger();
          await debuggerService.restart();
          return;

        case 'clearBreakpoints':
          requireDebugger();
          await debuggerService.clearBreakpoints();
          return;


        /* ====================================================
           KERNEL CONTROLS
           ==================================================== */

        case 'interrupt': {
          const kernel =
            panel.sessionContext.session?.kernel;

          if (!kernel) {
            throw new Error('No active kernel.');
          }

          await kernel.interrupt();
          return;
        }

        case 'restartKernel': {
          await panel.sessionContext.ready;

          if (!panel.sessionContext.session?.kernel) {
            throw new Error('No active kernel.');
          }

          const confirmed = window.confirm(
            'Restart this notebook kernel? ' +
            'All in-memory Python variables will be lost.'
          );

          if (!confirmed) {
            return;
          }

          await panel.sessionContext.restartKernel();
          return;
        }


        /* ====================================================
           CALL STACK
           ==================================================== */

        case 'callstack': {
          await ensureDebugger(panel);

          if (
            debuggerSidebar &&
            !debuggerSidebar.isDisposed
          ) {
            app.shell.activateById(debuggerSidebar.id);

          } else if (
            app.commands.hasCommand('debugger:show-panel')
          ) {
            await app.commands.execute(
              'debugger:show-panel'
            );

          } else {
            throw new Error(
              'Debugger sidebar unavailable.'
            );
          }

          return;
        }


        /* ====================================================
           VARIABLES
           ==================================================== */

        case 'variables':
          await ensureDebugger(panel);
          await debuggerService.displayDefinedVariables();
          return;


        /* ====================================================
           RUN
           ==================================================== */

        case 'run':
          await runOne(panel, cell);
          return;

        case 'runAll':
          await runRange(
            panel,
            0,
            panel.content.widgets.length
          );
          return;


        /* ====================================================
           ENABLE DEBUGGER
           ==================================================== */

        case 'enable':
          await ensureDebugger(panel);
          return;


        /* ====================================================
           DEBUG CURRENT CELL
           ==================================================== */

        case 'debug': {
          if (isSqlCell(cell)) {
            throw new Error(
              'MySQL statements cannot be debugged ' +
              'with Python breakpoints.'
            );
          }

          await ensureDebugger(panel);

          const code =
            cell.model.sharedModel.getSource();

          if (
            options.pauseAtFirstLine &&
            code.trim()
          ) {
            const codeId =
              debuggerService.getCodeId(code);

            const existing =
              debuggerService.model.breakpoints.getBreakpoints(
                codeId
              );

            if (existing.length === 0) {
              const line = firstExecutableLine(code);

              if (line !== null) {
                await debuggerService.updateBreakpoints(
                  code,
                  [
                    {
                      line,
                      verified: false
                    }
                  ]
                );
              }
            }
          }

          await runOne(panel, cell);
          return;
        }


        /* ====================================================
           BREAKPOINT
           ==================================================== */

        case 'breakpoint':
          await toggleBreakpoint(panel, cell);
          return;


        /* ====================================================
           NOTEBOOK EXECUTION
           ==================================================== */

        case 'above':
          await runRange(panel, 0, index + 1);
          return;

        case 'below':
          await runRange(
            panel,
            index,
            panel.content.widgets.length
          );
          return;

        case 'section': {
          const [start, end] = sectionBounds(
            cellSources(panel),
            index
          );

          await runRange(panel, start, end);
          return;
        }


        /* ====================================================
           NOTEBOOK EDITING
           ==================================================== */

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
      }
    };


    /* ========================================================
       EXECUTION QUEUE
       ======================================================== */

    const enqueue = (
      action: Action,
      panel: NotebookPanel,
      cell: CodeCell
    ) => {
      const pending =
        queues.get(panel) ?? Promise.resolve();

      const next = pending
        .catch(() => undefined)
        .then(() => doAction(action, panel, cell));

      queues.set(panel, next);
      void next.catch(showFailure);
    };


    const dispatch = (
      action: Action,
      panel: NotebookPanel,
      cell: CodeCell
    ): void => {
      if (immediateActions.has(action)) {
        void doAction(
          action,
          panel,
          cell
        ).catch(showFailure);

      } else {
        enqueue(action, panel, cell);
      }
    };


    /* ========================================================
       ACTION DEFINITIONS
       ======================================================== */

    const actions: {
      key: Action;
      label: string;
    }[] = [
      { key: 'run', label: 'Run Cell' },
      { key: 'runAll', label: 'Run All Cells' },
      { key: 'debug', label: 'Debug Cell' },
      { key: 'enable', label: 'Start Debugger' },
      { key: 'breakpoint', label: 'Toggle Breakpoint' },
      { key: 'continue', label: 'Continue' },
      { key: 'pause', label: 'Pause' },
      { key: 'stepOver', label: 'Step Over' },
      { key: 'stepInto', label: 'Step Into' },
      { key: 'stepOut', label: 'Step Out' },
      { key: 'stopDebug', label: 'Stop Debugger' },
      { key: 'restartDebug', label: 'Restart Debugger' },
      { key: 'clearBreakpoints', label: 'Clear Breakpoints' },
      { key: 'variables', label: 'Variables' },
      { key: 'callstack', label: 'Call Stack' },
      { key: 'interrupt', label: 'Interrupt Kernel' },
      { key: 'restartKernel', label: 'Restart Kernel' },

      // Retained for compatibility with earlier releases.
      { key: 'sqlCell', label: 'Insert SQL Cell' },

      // New insertion controls.
      { key: 'sqlAbove', label: 'Insert Blank SQL Cell Above' },
      { key: 'sqlBelow', label: 'Insert Blank SQL Cell Below' },

      { key: 'sqlConnect', label: 'Select MySQL Connection' },
      { key: 'above', label: 'Run Above' },
      { key: 'below', label: 'Run Below' },
      { key: 'section', label: 'Run Section' },
      { key: 'duplicate', label: 'Duplicate Cell' },
      { key: 'insert', label: 'Insert Code Cell' },
      { key: 'clear', label: 'Clear Output' },
      { key: 'moveUp', label: 'Move Cell Up' },
      { key: 'moveDown', label: 'Move Cell Down' },
      { key: 'output', label: 'Toggle Output' }
    ];


    /* ========================================================
       REGISTER COMMANDS
       ======================================================== */

    for (const action of actions) {
      app.commands.addCommand(
        COMMAND[action.key],
        {
          label: action.label,

          isEnabled: () => Boolean(
            tracker.currentWidget
              ?.content.activeCell
              ?.model.type === 'code'
          ),

          execute: () => {
            const panel = tracker.currentWidget;
            const cell = panel?.content.activeCell;

            if (
              panel &&
              cell?.model.type === 'code'
            ) {
              dispatch(
                action.key,
                panel,
                cell as CodeCell
              );
            }
          }
        }
      );

      palette?.addItem({
        category: 'PatriotEver Cell Studio',
        command: COMMAND[action.key]
      });
    }


    /* ========================================================
       DEBUGGER BUTTON STATES
       ======================================================== */

    const needsStoppedThread: ReadonlySet<Action> =
      new Set([
        'continue',
        'stepOver',
        'stepInto',
        'stepOut'
      ]);

    const needsActiveDebugger: ReadonlySet<Action> =
      new Set([
        'pause',
        'stopDebug',
        'restartDebug',
        'clearBreakpoints'
      ]);


    function updateDebugButtonStates(): void {
      const active = debuggerService.isStarted;

      const stopped =
        active && debuggerService.hasStoppedThreads();

      for (const [panel, toolbar] of floatingToolbars) {
        if (panel.isDisposed || !toolbar.isConnected) {
          continue;
        }

        const cell = panel.content.activeCell;

        const sql =
          cell?.model.type === 'code' &&
          isSqlCell(cell as CodeCell);

        const buttons =
          toolbar.querySelectorAll<HTMLButtonElement>(
            'button[data-pcl-action]'
          );

        buttons.forEach(button => {
          const action =
            button.dataset.pclAction as Action;

          if (
            sql &&
            (
              action === 'debug' ||
              action === 'breakpoint'
            )
          ) {
            button.disabled = true;

          } else if (
            needsStoppedThread.has(action)
          ) {
            button.disabled = !stopped;

          } else if (action === 'pause') {
            button.disabled = !active || stopped;

          } else if (action === 'enable') {
            button.disabled = active;

          } else if (
            needsActiveDebugger.has(action)
          ) {
            button.disabled = !active;

          } else {
            button.disabled = false;
          }
        });
      }
    }


    debuggerService.eventMessage.connect(
      () => updateDebugButtonStates()
    );

    debuggerService.sessionChanged.connect(
      () => updateDebugButtonStates()
    );


    /* ========================================================
       FLOATING TOOLBAR BUTTON
       ======================================================== */

    function makeButton(
      text: string,
      title: string,
      action: Action,
      panel: NotebookPanel
    ): HTMLButtonElement {
      const button = document.createElement('button');

      button.type = 'button';
      button.className = 'pcl-floating-action';

      button.dataset.pclAction = action;
      button.textContent = text;
      button.title = title;

      button.setAttribute(
        'aria-label',
        title
      );

      button.addEventListener(
        'mousedown',
        event => event.preventDefault()
      );

      button.addEventListener(
        'click',
        event => {
          event.preventDefault();
          event.stopPropagation();

          const cell = panel.content.activeCell;

          if (cell?.model.type !== 'code') {
            showFailure(
              new Error(
                'Select a Python or SQL code cell first.'
              )
            );
            return;
          }

          dispatch(
            action,
            panel,
            cell as CodeCell
          );
        }
      );

      return button;
    }


    /* ========================================================
       SINGLE HORIZONTAL FLOATING TOOLBAR
       ======================================================== */

    function attachPanel(panel: NotebookPanel): void {
      if (floatingToolbars.has(panel)) {
        return;
      }

      /*
       * Remove obsolete per-cell toolbars.
       */

      panel.content.node
        .querySelectorAll('.pcl-toolbar')
        .forEach(element => element.remove());

      const toolbar = document.createElement('div');

      toolbar.className = 'pcl-floating-strip';

      toolbar.setAttribute(
        'role',
        'toolbar'
      );

      toolbar.setAttribute(
        'aria-label',
        'PatriotEver Cell Studio'
      );

      floatingToolbars.set(panel, toolbar);


      /* ACTIVE LANGUAGE */

      const activeLabel = document.createElement('span');

      activeLabel.className = 'pcl-floating-language';

      toolbar.appendChild(activeLabel);


      /* ====================================================
         FLOATING CONTROL BUTTONS
         ==================================================== */

      const visibleButtons: {
        text: string;
        title: string;
        action: Action;
      }[] = [
        {
          text: '▶',
          title: 'Run current cell',
          action: 'run'
        },
        {
          text: '🐞',
          title: 'Debug current Python cell',
          action: 'debug'
        },
        {
          text: '⚙',
          title: 'Start debugger',
          action: 'enable'
        },
        {
          text: '●',
          title: 'Toggle breakpoint',
          action: 'breakpoint'
        },
        {
          text: '▶│',
          title: 'Continue debugging',
          action: 'continue'
        },
        {
          text: '⏸',
          title: 'Pause debugger',
          action: 'pause'
        },
        {
          text: '↷',
          title: 'Step Over',
          action: 'stepOver'
        },
        {
          text: '↓',
          title: 'Step Into',
          action: 'stepInto'
        },
        {
          text: '↑',
          title: 'Step Out',
          action: 'stepOut'
        },
        {
          text: '■',
          title: 'Stop debugger',
          action: 'stopDebug'
        },
        {
          text: '⟳',
          title: 'Restart debugger',
          action: 'restartDebug'
        },
        {
          text: '⊘',
          title: 'Clear all breakpoints',
          action: 'clearBreakpoints'
        },
        {
          text: '◫',
          title: 'Show variables',
          action: 'variables'
        },
        {
          text: '☷',
          title: 'Show call stack',
          action: 'callstack'
        },
        {
          text: '⏹',
          title: 'Interrupt kernel',
          action: 'interrupt'
        },
        {
          text: '↻ K',
          title: 'Restart kernel',
          action: 'restartKernel'
        },
        {
          text: '▶▶',
          title: 'Run all cells',
          action: 'runAll'
        },

        /*
         * New SQL insertion buttons.
         *
         * Both create completely blank SQL cells.
         */

        {
          text: '↑ SQL',
          title: 'Insert blank SQL cell above',
          action: 'sqlAbove'
        },
        {
          text: '↓ SQL',
          title: 'Insert blank SQL cell below',
          action: 'sqlBelow'
        },

        {
          text: '⛁',
          title: 'Select MySQL connection',
          action: 'sqlConnect'
        }
      ];


      for (const item of visibleButtons) {
        toolbar.appendChild(
          makeButton(
            item.text,
            item.title,
            item.action,
            panel
          )
        );
      }


      /* ====================================================
         MORE NOTEBOOK ACTIONS
         ==================================================== */

      const more = document.createElement('select');

      more.title = 'More notebook actions';

      more.setAttribute(
        'aria-label',
        'More notebook actions'
      );

      const defaultOption = document.createElement('option');

      defaultOption.value = '';
      defaultOption.textContent = '⋯ More';

      more.appendChild(defaultOption);

      const moreActions: Action[] = [
        'above',
        'below',
        'section',
        'duplicate',
        'insert',
        'clear',
        'moveUp',
        'moveDown',
        'output'
      ];


      for (const action of moreActions) {
        const definition = actions.find(
          item => item.key === action
        );

        if (!definition) {
          continue;
        }

        const option = document.createElement('option');

        option.value = action;
        option.textContent = definition.label;

        more.appendChild(option);
      }


      more.addEventListener(
        'change',
        () => {
          const selected = more.value as Action;

          more.value = '';

          if (!selected) {
            return;
          }

          const cell = panel.content.activeCell;

          if (cell?.model.type !== 'code') {
            showFailure(
              new Error(
                'Select a Python or SQL code cell first.'
              )
            );
            return;
          }

          dispatch(
            selected,
            panel,
            cell as CodeCell
          );
        }
      );

      toolbar.appendChild(more);


      /* ====================================================
         EXECUTION DURATION
         ==================================================== */

      const elapsed = document.createElement('span');

      elapsed.className = 'pcl-floating-elapsed';

      toolbar.appendChild(elapsed);


      /* ====================================================
         INSERT THE FLOATING STRIP
         ==================================================== */

      panel.content.node.insertBefore(
        toolbar,
        panel.content.node.firstChild
      );


      /* ====================================================
         REFRESH ACTIVE CELL
         ==================================================== */

      let queued = false;

      const refresh = () => {
        if (queued || panel.isDisposed) {
          return;
        }

        queued = true;

        queueMicrotask(() => {
          queued = false;

          if (panel.isDisposed) {
            return;
          }

          if (!toolbar.isConnected) {
            panel.content.node.insertBefore(
              toolbar,
              panel.content.node.firstChild
            );
          }

          const cell = panel.content.activeCell;

          if (cell?.model.type === 'code') {
            const codeCell = cell as CodeCell;

            const sql = isSqlCell(codeCell);

            if (sql) {
              markSqlCell(codeCell);
            }

            const language = sql ? 'SQL' : 'Python';

            if (activeLabel.textContent !== language) {
              activeLabel.textContent = language;
            }

            const duration = durations.get(
              codeCell.model
            );

            const durationText =
              duration !== undefined
                ? `${(duration / 1000).toFixed(2)}s`
                : '';

            if (elapsed.textContent !== durationText) {
              elapsed.textContent = durationText;
            }

            durationLabels.set(
              codeCell,
              elapsed
            );

          } else {
            if (activeLabel.textContent !== 'Notebook') {
              activeLabel.textContent = 'Notebook';
            }

            if (elapsed.textContent !== '') {
              elapsed.textContent = '';
            }
          }

          updateDebugButtonStates();
        });
      };


      /*
       * Observe direct notebook children only.
       */

      const observer = new MutationObserver(refresh);

      observer.observe(
        panel.content.node,
        {
          childList: true
        }
      );


      const onActiveCellChanged = () => refresh();

      const onCellsChanged = () => refresh();

      panel.content.activeCellChanged.connect(
        onActiveCellChanged
      );


      void panel.context.ready.then(() => {
        const model = panel.content.model;

        model?.cells.changed.connect(
          onCellsChanged
        );

        panel.disposed.connect(() => {
          observer.disconnect();

          floatingToolbars.delete(panel);

          panel.content.activeCellChanged.disconnect(
            onActiveCellChanged
          );

          model?.cells.changed.disconnect(
            onCellsChanged
          );
        });

        refresh();

      }).catch(showFailure);


      refresh();
    }


    /* ========================================================
       EXISTING AND NEW NOTEBOOKS
       ======================================================== */

    tracker.widgetAdded.connect(
      (_, panel) => attachPanel(panel)
    );

    tracker.forEach(
      panel => attachPanel(panel)
    );

  }
};

export default plugin;