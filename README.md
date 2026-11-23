# Kimpanel OSK Bridge — experimental proof of concept

This is an **untested** small GNOME Shell extension intended for GNOME Shell 49-51. It keeps the official `kimpanel@kde.org` extension installed and enabled, and adds only:

1. Kimpanel candidates to GNOME's **existing** on-screen keyboard suggestions row (current candidate page, at most six entries).
2. An OSK key forwarding adjustment for Fcitx5 when GNOME's standard path would directly commit the typed string.
3. Conditional suppression of the normal floating Kimpanel candidate popup while the OSK is visible.

It does not replace Kimpanel, install a second Kimpanel D-Bus service, replace OSK layouts, or initiate candidate page collection.

## Install / uninstall

1. Disable `impanel-with-osk` if installed. Keep `kimpanel@kde.org` enabled.
2. Copy the contents of this folder into `~/.local/share/gnome-shell/extensions/kimpanel-osk-bridge@local/`.
3. **Log out and back in** to load the new extension into a Wayland GNOME Shell session. Enable it with `gnome-extensions enable kimpanel-osk-bridge@local` (or use Extension Manager).
4. If it misbehaves, run `gnome-extensions disable kimpanel-osk-bridge@local`. A logout/login resets any lingering Shell state. To uninstall, disable it and remove the above folder.

## Test procedure

- With Fcitx5 Chinese Pinyin active, type `n`, `ni`, `nih`, `nihao` using a hardware keyboard while OSK is visible. Candidates should refresh after each change.
- Repeat using only OSK touch buttons. Characters should reach Fcitx5 instead of being committed directly as plain Latin text.
- Tap a displayed candidate; it should select the corresponding candidate on the current page.
- Hide the OSK; the original Kimpanel popup should resume its normal behavior.
- Check several native Wayland programs (GNOME Text Editor, Firefox, etc.). Different text-input implementations may behave differently.

Check logs with `journalctl --user -b | grep -i 'Kimpanel OSK Bridge'`, or view your user Shell logs.

## Limitations / risks

This is a source-based prototype, **not tested against an actual GNOME Shell session**. GNOME Shell's private fields and the internal object reference exposed by Kimpanel are not stable APIs. Some keyboard input paths may not reach Fcitx5 or may have compatibility issues. A second input method extension can also interfere with the suggestions row. Only the **current** candidate page and first six candidates are displayed; paging, layout polish, keyboard switch key, full-screen suggestions, and advanced touch gestures are intentionally omitted. The extension assumes the original Kimpanel indicator name `kimpanel` and will do nothing until that indicator exists.

Reference code: https://github.com/wengxt/gnome-shell-extension-kimpanel and https://github.com/hallelujahdrive/impanel-with-osk .
