// SPDX-License-Identifier: GPL-3.0-or-later

import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as KeyboardUI from 'resource:///org/gnome/shell/ui/keyboard.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Extension, InjectionManager} from 'resource:///org/gnome/shell/extensions/extension.js';

import {CandidateRow} from './candidateRow.js';

const ACTION_TIMEOUT_MS = 1000;
const INPUT_METHOD_PROPERTY = '/Fcitx/im';
const INPUT_METHOD_PREFIX = INPUT_METHOD_PROPERTY + '/';

function wrapMethod(target, name, wrap) {
    const original = target[name];
    const ownMethod = Object.hasOwn(target, name);
    const wrapper = wrap(original);
    target[name] = wrapper;
    return () => {
        if (target[name] !== wrapper)
            return;
        if (ownMethod)
            target[name] = original;
        else
            delete target[name];
    };
}

export default class KimpanelOskBridge extends Extension {
    enable() {
        this._injection = new InjectionManager();
        this._panel = null;
        this._restorePanel = [];
        this._lookupPage = null;
        this._displayedPage = null;
        this._actionTimeoutId = 0;
        this._keyboard = null;
        this._row = null;
        this._visibilityId = 0;
        this._keyboardDestroyId = 0;
        this._restoreController = null;
        this._languageMenu = null;
        this._requestLanguageMenu = null;
        this._pendingLanguageMenu = null;
        this._settings = this.getSettings();
        this._fontScaleChangedId = this._settings.connect('changed::candidate-font-scale', settings => {
            this._row?.setFontScale(settings.get_int('candidate-font-scale'));
        });

        const bridge = this;
        this._injection.overrideMethod(KeyboardUI.Keyboard.prototype,
            '_setupKeyboard', original => function (...args) {
                const result = original.apply(this, args);
                bridge._attachKeyboard(this);
                return result;
            });
        this._injection.overrideMethod(KeyboardUI.Keyboard.prototype,
            '_popupLanguageMenu', original => function (...args) {
                const result = original.apply(this, args);
                if (bridge._keyboard === this && this._languagePopup?.isOpen)
                    bridge._requestLanguageMenu?.(this._languagePopup);
                return result;
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
        if (this._settings) {
            this._settings.disconnect(this._fontScaleChangedId);
            this._settings = null;
        }
        this._injection?.clear();
        this._injection = null;
    }

    _attachPanel() {
        const panel = Main.panel.statusArea.kimpanel?.kimpanel ?? null;
        if (panel === this._panel)
            return;
        this._detachPanel();
        if (!panel || typeof panel.updateInputPanel !== 'function' ||
            typeof panel.selectCandidate !== 'function')
            return;

        const bridge = this;
        this._panel = panel;
        this._restorePanel.push(wrapMethod(panel, 'updateInputPanel',
            original => function (...args) {
                if (bridge._panel === this && bridge._syncCandidates(this)) {
                    this.inputpanel.hide();
                    return;
                }
                return original.apply(this, args);
            }));

        if (typeof panel.SetLookupTable === 'function' && typeof panel.emit === 'function') {
            this._restorePanel.push(wrapMethod(panel, 'SetLookupTable',
                original => function (labels, texts, attrs, hasPrev, hasNext, ...args) {
                    if (bridge._panel === this) {
                        // Kimpanel retains texts as its table but discards both page flags.
                        bridge._lookupPage = {table: texts, hasPrev, hasNext};
                    }
                    return original.call(this, labels, texts, attrs, hasPrev, hasNext, ...args);
                }));
        }

        this._patchLanguageMenu(panel);
        panel.updateInputPanel();
    }

    _detachPanel() {
        const panel = this._panel;
        if (!panel)
            return;

        this._panel = null;
        this._lookupPage = null;
        this._requestLanguageMenu = null;
        this._cancelLanguageMenuRequest();
        this._languageMenu?.section.destroy();
        for (const restore of this._restorePanel)
            restore();
        this._restorePanel = [];
        this._clearCandidates();
        if (panel.inputpanel)
            panel.updateInputPanel();
    }

    _attachKeyboard(keyboard) {
        if (!keyboard || keyboard === this._keyboard)
            return;

        this._detachKeyboard(this._keyboard);
        this._keyboard = keyboard;
        if (keyboard._suggestions) {
            this._row = new CandidateRow(keyboard,
                this.gettext('Previous candidate page'),
                this.gettext('Next candidate page'));
            this._row.setFontScale(this._settings.get_int('candidate-font-scale'));
        }
        this._visibilityId = keyboard.connect('visibility-changed', () => {
            this._panel?.updateInputPanel();
        });
        this._keyboardDestroyId = keyboard.connect('destroy', () => this._detachKeyboard(keyboard));
        this._patchController(keyboard);
        this._panel?.updateInputPanel();
    }

    _detachKeyboard(keyboard) {
        if (!keyboard || keyboard !== this._keyboard)
            return;

        if (this._visibilityId)
            keyboard.disconnect(this._visibilityId);
        if (this._keyboardDestroyId)
            keyboard.disconnect(this._keyboardDestroyId);
        this._visibilityId = 0;
        this._keyboardDestroyId = 0;
        this._restoreController?.();
        this._restoreController = null;
        this._languageMenu?.section.destroy();
        this._keyboard = null;
        this._clearCandidates();
        this._row?.destroy();
        this._row = null;
        this._panel?.updateInputPanel();
    }

    _patchLanguageMenu(panel) {
        const menu = panel.menu;
        if (typeof panel.triggerProperty !== 'function' || typeof menu?.execMenu !== 'function')
            return;

        const bridge = this;
        const indicator = panel.indicator;
        if (typeof indicator?._setIcon === 'function') {
            this._restorePanel.push(wrapMethod(indicator, '_setIcon',
                original => function (status, ...args) {
                    const result = original.call(this, status, ...args);
                    bridge._languageMenu?.updateOrnaments(status);
                    return result;
                }));
        }

        const triggerProperty = panel.triggerProperty.bind(panel);
        const requestMenu = popup => {
            // ExecMenu has no request ID. One request serves the latest OSK or tray action.
            if (bridge._pendingLanguageMenu) {
                bridge._pendingLanguageMenu.popup = popup;
                return;
            }

            const timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ACTION_TIMEOUT_MS, () => {
                bridge._pendingLanguageMenu = null;
                return GLib.SOURCE_REMOVE;
            });
            bridge._pendingLanguageMenu = {popup, timeoutId};
            triggerProperty(INPUT_METHOD_PROPERTY);
        };

        this._requestLanguageMenu = requestMenu;
        this._restorePanel.push(wrapMethod(panel, 'triggerProperty',
            original => function (property, ...args) {
                if (property === INPUT_METHOD_PROPERTY)
                    return requestMenu(null);
                return original.call(this, property, ...args);
            }));
        this._restorePanel.push(wrapMethod(menu, 'execMenu',
            original => function (properties, ...args) {
                const request = bridge._pendingLanguageMenu;
                if (!request || !properties.length ||
                    !properties.every(property => property.startsWith(INPUT_METHOD_PREFIX)))
                    return original.call(this, properties, ...args);

                bridge._cancelLanguageMenuRequest();
                if (!request.popup)
                    return original.call(this, properties, ...args);
                if (bridge._keyboard?.visible && bridge._keyboard._languagePopup === request.popup &&
                    request.popup.isOpen)
                    bridge._addFcitxInputMethods(request.popup, properties, triggerProperty);
            }));
    }

    _cancelLanguageMenuRequest() {
        if (!this._pendingLanguageMenu)
            return;

        GLib.source_remove(this._pendingLanguageMenu.timeoutId);
        this._pendingLanguageMenu = null;
    }

    _addFcitxInputMethods(popup, properties, triggerProperty) {
        const section = new PopupMenu.PopupMenuSection();
        section.addMenuItem(new PopupMenu.PopupSeparatorMenuItem('Fcitx5'));
        const methods = properties.map(entry => {
            const [property, label] = entry.split(':', 2);
            const item = section.addAction(label, () => triggerProperty(property));
            // Match GNOME's language actions so tapping the menu keeps text focus.
            item.can_focus = false;
            return {label, item};
        });

        const updateOrnaments = status => {
            let name;
            if (status?.key === INPUT_METHOD_PROPERTY) {
                // With PreferTextIcon, Fcitx puts the full name in the long text field.
                const usesTextIcon = status.icon === '' && status.hint?.includes('label=' + status.label);
                name = usesTextIcon ? status.text : status.label;
            }
            const matches = name ? methods.filter(method => method.label === name) : [];
            const current = matches.length === 1 ? matches[0].item : null;
            for (const {item} of methods)
                item.setOrnament(item === current ? PopupMenu.Ornament.DOT : PopupMenu.Ornament.NO_DOT);
        };

        this._languageMenu = {section, updateOrnaments};
        section.connect('destroy', () => {
            if (this._languageMenu?.section === section)
                this._languageMenu = null;
        });

        const panel = this._panel;
        updateOrnaments(panel.enabled ? panel.indicator?._properties?.[INPUT_METHOD_PROPERTY] : null);
        // GNOME's separator follows the native sources and precedes Keyboard Settings.
        const settingsSeparator = popup._getMenuItems().findIndex(
            item => item instanceof PopupMenu.PopupSeparatorMenuItem);
        popup.addMenuItem(section, settingsSeparator < 0 ? undefined : settingsSeparator);
    }

    _patchController(keyboard) {
        const controller = keyboard._keyboardController;
        if (typeof controller?.commit !== 'function')
            return;

        const bridge = this;
        const restoreController = wrapMethod(controller, 'commit',
            original => async function (str, modifiers) {
                // GNOME commits some OSK strings directly. Give Fcitx5 key events on that path.
                const panel = bridge._panel;
                const inputMethod = Main.inputMethod;
                const focus = inputMethod?.currentFocus;
                if (!panel?.enabled || bridge._restoreController !== restoreController || !keyboard.visible ||
                    !focus || modifiers?.size > 0 || this._oskCompletionEnabled ||
                    this._currentSource?.type === 'ibus' ||
                    typeof inputMethod.handleVirtualKey !== 'function' ||
                    typeof this._getKeyvalsFromString !== 'function')
                    return original.call(this, str, modifiers);

                const keyvals = this._getKeyvalsFromString(str);
                if (!keyvals?.length)
                    return original.call(this, str, modifiers);

                for (const keyval of keyvals) {
                    let handled = false;
                    try {
                        handled = await inputMethod.handleVirtualKey(keyval);
                    } catch (error) {
                        console.warn(`[Kimpanel OSK Bridge] Virtual key failed: ${error}`);
                    }
                    if (bridge._restoreController !== restoreController || !keyboard.visible ||
                        bridge._panel !== panel || !panel.enabled ||
                        Main.inputMethod !== inputMethod || inputMethod.currentFocus !== focus)
                        return;

                    if (!handled) {
                        this.keyvalPress(keyval);
                        this.keyvalRelease(keyval);
                    }
                }
            });
        this._restoreController = restoreController;
    }

    _syncCandidates(panel) {
        const table = panel.table;
        if (!this._row || !this._keyboard.visible || !panel.inputpanel ||
            !panel.enabled || !panel.showLookupTable || !table?.length) {
            this._clearCandidates();
            return false;
        }

        if (this._displayedPage?.table === table)
            return true;

        const {hasPrev, hasNext} = this._lookupPage?.table === table ? this._lookupPage : {};
        const page = {
            table,
            select: index => this._runCandidateAction(panel, page, () => panel.selectCandidate(index)),
            previous: hasPrev
                ? () => this._runCandidateAction(panel, page, () => panel.emit('LookupTablePageUp'))
                : null,
            next: hasNext
                ? () => this._runCandidateAction(panel, page, () => panel.emit('LookupTablePageDown'))
                : null,
        };
        this._cancelActionTimeout();
        this._displayedPage = page;
        this._row.show(page);
        return true;
    }

    _runCandidateAction(panel, page, action) {
        if (this._displayedPage !== page || !this._keyboard?.visible ||
            !panel.enabled || !panel.showLookupTable || panel.table !== page.table ||
            this._actionTimeoutId)
            return;

        this._row.setWaiting(true);
        this._actionTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ACTION_TIMEOUT_MS, () => {
            this._actionTimeoutId = 0;
            this._row.setWaiting(false);
            return GLib.SOURCE_REMOVE;
        });
        action();
    }

    _cancelActionTimeout() {
        if (!this._actionTimeoutId)
            return;
        GLib.source_remove(this._actionTimeoutId);
        this._actionTimeoutId = 0;
    }

    _clearCandidates() {
        this._cancelActionTimeout();
        this._displayedPage = null;
        this._row?.hide();
    }
}
