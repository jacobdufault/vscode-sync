# vscode sync

A simple sync extension that lets you upload settings and keybindings to
Google Drive.

## Getting started

Sync exposes only two commands: `sync.upload` and `sync.download`. Type `<F1>
Sync Upload` to get started.

Sync has a few config variables that are used to cache the Google Drive
access tokens. Do not share these!

## Per-platform settings

Sync lets you easily customize settings per-platform. Wrap the preferences in
`@beginSync` and `@endSync` tags and apply filters; currently `os:windows`,
`os:macos`, `os:linux` are supported. `hostname:...` matches against the
current machine's hostname.

If the settings are not in use for the current machine they will be commented
out.

```json
// @beginSync os:windows
"editor.smoothScroll": true
// @endSync

// @beginSync hostname:myhostname
"someSetting": 3
// @endSync

// @beginSync hostname:work os:windows
"someSetting": 3
// @endSync
```

## What is synced?

- settings.json
- keybindings.json
- locale.json
- installed extensions

## Conflict resolution

There is none - any local changes will be overridden when you download
settings.