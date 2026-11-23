# Kimpanel OSK Bridge

Kimpanel OSK Bridge shows Fcitx5 candidates above the GNOME on-screen keyboard (OSK). It uses the live backend of the official Kimpanel extension (`kimpanel@kde.org`) and styles its candidate row with the GNOME Shell theme.

## Use

- Tap a word to select it. The candidates are centered, and each row fits the keyboard width.
- Tap **‹** or **›** to browse candidates. A wide Fcitx5 page is split into shorter rows. The arrow moves through those rows and then requests the adjacent page from Fcitx5. Unavailable directions are dimmed.
- Open the extension preferences with `gnome-extensions prefs kimpanel-osk-bridge@chenxiex.github.io` to adjust the candidate font size. Changes apply immediately. At 100%, candidates use the GNOME theme size.
- The floating Kimpanel window returns when the OSK closes. Kimpanel also handles preedit or auxiliary text on its own when there are no OSK candidates to show.

## Install or update

Keep `kimpanel@kde.org` enabled. Disable `impanel-with-osk` if installed. If you have the earlier `@local` build enabled, disable it with `gnome-extensions disable kimpanel-osk-bridge@local` before switching.

Run the commands below with `curl` and `unzip` to download the extension ZIP from the [latest release](https://github.com/chenxiex/kimpanel-osk-bridge/releases/latest) and overwrite the installed files.

```sh
(
    set -eu
    uuid=kimpanel-osk-bridge@chenxiex.github.io
    extensions_dir="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions"
    download_dir=$(mktemp -d)
    trap 'rm -rf -- "$download_dir"' EXIT
    archive="$download_dir/$uuid.shell-extension.zip"

    curl --fail --location --output "$archive" \
        "https://github.com/chenxiex/kimpanel-osk-bridge/releases/latest/download/$uuid.shell-extension.zip"
    unzip -tq "$archive"
    mkdir -p "$extensions_dir/$uuid"
    unzip -o "$archive" -d "$extensions_dir/$uuid"
)
```

Log out and back in to GNOME Wayland to load the new files. If the bridge is disabled, enable it after logging back in.

```sh
gnome-extensions enable kimpanel-osk-bridge@chenxiex.github.io
```

To uninstall, disable the bridge with `gnome-extensions disable kimpanel-osk-bridge@chenxiex.github.io` and remove its directory.

## Compatibility

The bridge targets GNOME Shell 51. The tests run the bridge with mock Shell objects. An isolated GNOME Shell 51.1 and Kimpanel 94 smoke test exercises the widgets and D-Bus messages with a simulated input method.

GNOME Shell and Kimpanel expose the objects used here through private interfaces. The bridge retains the page flags when Kimpanel receives the `SetLookupTable` message, so paging becomes available after the next lookup-table update if the bridge is enabled midway through a composition. OSK key forwarding depends on the application's input context and the session's input method.

See the upstream implementations for the lookup-table handler, paging signals and keyboard lifecycle. [Kimpanel backend](https://github.com/wengxt/gnome-shell-extension-kimpanel/blob/master/extension.js), [Fcitx5 Kimpanel protocol](https://github.com/fcitx/fcitx5/blob/master/src/ui/kimpanel/kimpanel.cpp), [GNOME Shell keyboard](https://github.com/GNOME/gnome-shell/blob/51.1/js/ui/keyboard.js).
