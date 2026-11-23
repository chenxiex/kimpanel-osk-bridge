# Kimpanel OSK Bridge

Kimpanel OSK Bridge shows Fcitx5 candidates above the GNOME on-screen keyboard (OSK). It uses the live backend of the official Kimpanel extension (`kimpanel@kde.org`) and styles its candidate row with the GNOME Shell theme.

## Use

- Tap a word to select it. If the page is wider than the keyboard, use the horizontal scrollbar. GNOME Shell 51 also supports swiping the list directly.
- Tap **‹** or **›** to request the previous or next page from Fcitx5. The buttons appear when there is another page, and unavailable directions are dimmed. The row refreshes when Fcitx5 sends its updated candidate table.
- The floating Kimpanel window returns when the OSK closes. Kimpanel also handles preedit or auxiliary text on its own when there are no OSK candidates to show.

## Install or update

1. Keep `kimpanel@kde.org` enabled. Disable `impanel-with-osk` if installed.
2. Copy `metadata.json`, `extension.js` and `candidateRow.js` into `~/.local/share/gnome-shell/extensions/kimpanel-osk-bridge@local/`.
3. Log out and back in to GNOME Wayland to load the new code.
4. If the bridge is disabled, run `gnome-extensions enable kimpanel-osk-bridge@local`.

To uninstall, disable the bridge with `gnome-extensions disable kimpanel-osk-bridge@local` and remove its directory.

## Verify

The extension needs GNOME Shell, Fcitx5 and Kimpanel. Running the automated tests needs Node.js 22.15 or later. There are no build steps or npm dependencies.

```sh
node --test tests/*.test.mjs
```

## Compatibility

The bridge targets GNOME Shell 49–51. The tests run the bridge with mock Shell objects. An isolated GNOME Shell 51.1 and Kimpanel 94 smoke test exercises the widgets and D-Bus messages with a simulated input method.

GNOME Shell and Kimpanel expose the objects used here through private interfaces. The bridge retains the page flags when Kimpanel receives the `SetLookupTable` message, so paging becomes available after the next lookup-table update if the bridge is enabled midway through a composition. OSK key forwarding depends on the application's input context and the session's input method.

See the upstream implementations for the lookup-table handler, paging signals and keyboard lifecycle. [Kimpanel backend](https://github.com/wengxt/gnome-shell-extension-kimpanel/blob/master/extension.js), [Fcitx5 Kimpanel protocol](https://github.com/fcitx/fcitx5/blob/master/src/ui/kimpanel/kimpanel.cpp), [GNOME Shell keyboard](https://github.com/GNOME/gnome-shell/blob/51.1/js/ui/keyboard.js).
