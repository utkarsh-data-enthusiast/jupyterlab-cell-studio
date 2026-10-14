# Security policy

## Supported versions

The initial 0.1.x series targets JupyterLab 4.5 and 4.6. Please upgrade to a supported JupyterLab and kernel version and report vulnerabilities privately.

## Security model

- Runs only in JupyterLab frontend; no REST endpoints, websocket server, privileged subprocesses, shell calls or OS hooks are added by the extension.
- Calls existing **JupyterLab NotebookActions** and **Debugger** APIs to execute or debug the code that the user clicks.
- `textContent` is used for labels and messages; never `innerHTML`, `eval`, dynamic third-party scripts or remote CDNs.
- Kernel connection and debug requests inherit authentication, permissions and policies from the user's existing JupyterLab server.
- Execution only follows a **user click or explicit JupyterLab command**. There is no automatic background code execution.
- A debugger may expose sensitive variables; only connect to trusted Jupyter servers and kernels.
- Extension's dependency graph and publishing credentials should be audited before public release. Automated tests cannot guarantee absence of vulnerabilities.

## Reporting

Before GitHub repository creation, contact the maintainer directly rather than publicly publishing exploit details. After repository creation, use GitHub's **Private vulnerability reporting** feature, and enable Dependabot security alerts and branch protection.
