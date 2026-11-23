// SPDX-License-Identifier: GPL-3.0-or-later
// Experimental Kimpanel -> GNOME OSK bridge; GNOME Shell 49-51.
// This extension DOES NOT own any D-Bus name or replace the Kimpanel UI.

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as KeyboardUI from 'resource:///org/gnome/shell/ui/keyboard.js';
import {Extension, InjectionManager} from 'resource:///org/gnome/shell/extensions/extension.js';

const MAX_VISIBLE_CANDIDATES = 6;

export default class KimpanelOskBridge extends Extension {
    enable() {
        this._injection = new InjectionManager();
        this._panel = null;
        this._panelUpdate = null;
        this._keyboard = null;
        this._visibilityId = 0;
        this._controller = null;
        this._controllerCommit = null;
        this._lastSuggestions = null;
        this._ownsSuggestions = false;

        const bridge = this;
        // Patch new OSKs as well as the currently existing one.
        this._injection.overrideMethod(KeyboardUI.Keyboard.prototype,
            '_setupKeyboard', original => function (...args) {
                const result = original.apply(this, args);
                bridge._attachKeyboard(this);
                return result;
            });

        this._injection.overrideMethod(KeyboardUI.Keyboard.prototype,
            '_onDestroy', original => function (...args) {
                bridge._detachKeyboard(this);
                return original.apply(this, args);
            });

        this._extensionStateId = Main.extensionManager.connect(
            'extension-state-changed', () => this._attachPanel());

        this._attachKeyboard(Main.keyboard?._keyboard);
        this._attachPanel();
    }

    disable() {
        if (this._extensionStateId) {
            Main.extensionManager.disconnect(this._extensionStateId);
            this._extensionStateId = 0;
        }

        this._detachPanel();
        this._detachKeyboard(this._keyboard);
        this._injection?.clear();
        this._injection = null;
        this._clearSuggestions();
    }

    _oskVisible() {
        return !!Main.keyboard?.visible;
    }

    _attachPanel() {
        // Kimpanel's status indicator keeps a reference to its live backend.
        const panel = Main.panel.statusArea.kimpanel?.kimpanel ?? null;
        if (panel === this._panel)
            return;
        this._detachPanel();
        if (!panel || typeof panel.updateInputPanel !== 'function' ||
            typeof panel.selectCandidate !== 'function')
            return;

        const bridge = this;
        this._panel = panel;
        this._panelUpdate = panel.updateInputPanel;
        panel.updateInputPanel = function (...args) {
            if (bridge._oskVisible()) {
                // The original panel may still contain preedit/aux text.
                // Don't draw that floating UI on top of the OSK.
                this.inputpanel?.hide();
                bridge._syncSuggestions(this);
                return;
            }
            bridge._clearSuggestions();
            return bridge._panelUpdate.apply(this, args);
        };
        panel.updateInputPanel();
    }

    _detachPanel() {
        if (this._panel && this._panelUpdate) {
            const panel = this._panel;
            panel.updateInputPanel = this._panelUpdate;
            this._panel = null;
            this._panelUpdate = null;
            this._clearSuggestions();
            // Restore normal Kimpanel floating popup if still usable.
            if (panel.inputpanel) {
                try { panel.updateInputPanel(); } catch (e) { console.debug(e); }
            }
        }
    }

    _attachKeyboard(keyboard) {
        if (!keyboard || keyboard === this._keyboard)
            return;
        this._detachKeyboard(this._keyboard);
        this._keyboard = keyboard;
        this._lastSuggestions = null;
        this._visibilityId = keyboard.connect('visibility-changed', () => {
            this._lastSuggestions = null;
            this._panel?.updateInputPanel();
        });
        this._patchController(keyboard._keyboardController);
        if (this._panel)
            this._panel.updateInputPanel();
    }

    _detachKeyboard(keyboard) {
        if (!keyboard || keyboard !== this._keyboard)
            return;
        if (this._visibilityId) {
            try { keyboard.disconnect(this._visibilityId); } catch (e) { console.debug(e); }
            this._visibilityId = 0;
        }
        if (this._controller && this._controllerCommit)
            this._controller.commit = this._controllerCommit;
        this._controller = null;
        this._controllerCommit = null;
        this._keyboard = null;
        this._lastSuggestions = null;
    }

    _patchController(controller) {
        if (!controller || typeof controller.commit !== 'function')
            return;
        this._controller = controller;
        this._controllerCommit = controller.commit;
        const original = controller.commit;
        const bridge = this;

        controller.commit = async function (str, modifiers) {
            // GNOME's default XKB OSK path commits directly into the target.
            // For Fcitx5, feed virtual key events through the input method.
            // Retain GNOME's native behavior when it already uses that path.
            if (!bridge._panel?.enabled || !bridge._oskVisible() ||
                !Main.inputMethod?.currentFocus || modifiers?.size > 0 ||
                this._oskCompletionEnabled ||
                this._currentSource?.type === 'ibus' ||
                typeof Main.inputMethod.handleVirtualKey !== 'function' ||
                typeof this._getKeyvalsFromString !== 'function')
                return original.call(this, str, modifiers);

            const keyvals = this._getKeyvalsFromString(str);
            if (!keyvals?.length)
                return original.call(this, str, modifiers);

            for (const keyval of keyvals) {
                let handled = false;
                try {
                    handled = await Main.inputMethod.handleVirtualKey(keyval);
                } catch (error) {
                    console.warn(`[Kimpanel OSK Bridge] Virtual key failed: ${error}`);
                }
                if (!handled) {
                    this.keyvalPress(keyval);
                    this.keyvalRelease(keyval);
                }
            }
        };
    }

    _syncSuggestions(panel) {
        if (!this._oskVisible())
            return;
        const texts = panel.showLookupTable && panel.enabled
            ? (panel.table ?? []).slice(0, MAX_VISIBLE_CANDIDATES).map(
                text => String(text).split('\n')[0])
            : [];
        const signature = JSON.stringify([panel.preedit, texts]);
        if (signature === this._lastSuggestions)
            return;
        this._clearSuggestions();
        this._lastSuggestions = signature;
        if (!texts.length)
            return;

        this._ownsSuggestions = true;
        Main.keyboard.setSuggestionsVisible(true);
        texts.forEach((text, index) => {
            Main.keyboard.addSuggestion(text, () => {
                if (this._panel !== panel) return;
                // Index is for the currently displayed page (no fake paging).
                panel.selectCandidate(index);
                this._lastSuggestions = null;
                this._clearSuggestions();
            });
        });
    }

    _clearSuggestions() {
        if (this._ownsSuggestions)
            Main.keyboard?.resetSuggestions();
        this._ownsSuggestions = false;
        this._lastSuggestions = null;
    }
}
