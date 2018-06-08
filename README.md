# vscode sync

A simple sync extension that lets you upload settings and keybindings to
Google Drive.

## Getting started

Sync exposes only two commands: `sync.upload` and `sync.download`. Type `<F1>
Sync Upload` to get started.

Sync has a few config variables that are used to cache the Google Drive
access tokens. Do not share these!

## Per-platform settings

Sync lets you easily customize settings per-platform.

First, surround the conditional preferences in `// @syncIf` and `// @end`
lines. Then, the `syncIf` line can contain filters.

Currently supported filters:
- `os:windows`, `os:macos`, `os:linux`
- `hostname:foo` where `foo` is the current hostname of the device

If the settings are not in use for the current machine they will be commented
out.

Here are some examples.
```json
// This setting is only active on Windows.
// @syncIf os:windows
"editor.smoothScroll": true
// @end

// This setting is only active when hostname=myhostname.
// @syncIf hostname:myhostname
"someSetting": 3
// @end

// This setting is only active on Windows when hostname=work.
// @syncIf os:windows hostname:work
"someSetting": 3
// @end
```

## What is synced?

- settings.json
- keybindings.json
- locale.json
- installed extensions

## Conflict resolution

There is none - any local changes will be overridden when you download
settings.