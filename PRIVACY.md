# Privacy policy / zero-telemetry declaration

Cell Studio itself:

- **Does not track users.** No telemetry, analytics, unique user identifiers, advertising, cookies, fingerprinting or usage reporting.
- **Does not send notebook content to any extension-owned server.** There is no extension-owned server.
- **Does not store notebook source, kernel variables or execution outputs in a remote database.** Runtime timing values live only in memory and are reset when the tab closes.
- **Does not read login tokens, user emails or IP addresses.** It uses JupyterLab's existing authenticated session connection for the native debug protocol.
- **Does not load third-party web resources at runtime** and **does not bundle network analytics SDKs**.

The JupyterLab server, notebook kernel, other extensions, npm/pip/CI tooling and user-written notebook code are separate components with their own security and privacy behavior. A notebook running `requests.get(...)`, for example, will still make that network request. Extension build dependency installation downloads packages and may use package-manager registries; this is distinct from runtime telemetry.
