import {registerHooks} from 'node:module';

class Signals {
    _handlers = new Map();
    _nextId = 1;

    connect(signal, callback) {
        const id = this._nextId++;
        this._handlers.set(id, {signal, callback});
        return id;
    }

    disconnect(id) {
        this._handlers.delete(id);
    }

    emit(signal) {
        for (const handler of this._handlers.values()) {
            if (handler.signal === signal)
                handler.callback(this);
        }
    }
}

class Actor extends Signals {
    children = [];
    reactive = true;
    visible = true;

    constructor(properties) {
        super();
        Object.assign(this, properties);
    }

    add_child(child) {
        child.parent = this;
        this.children.push(child);
    }

    set_child(child) {
        this.add_child(child);
    }

    insert_child_above(child, sibling) {
        child.parent = this;
        this.children.splice(this.children.indexOf(sibling) + 1, 0, child);
    }

    get_children() {
        return [...this.children];
    }

    get_n_children() {
        return this.children.length;
    }

    get_theme_node() {
        return {
            adjust_for_width: width => width,
            get_length: () => 0,
        };
    }

    destroy_all_children() {
        for (const child of [...this.children])
            child.destroy();
    }

    destroy() {
        this.destroy_all_children();
        const siblings = this.parent?.children;
        siblings?.splice(siblings.indexOf(this), 1);
        this.parent?.emit('child-removed');
    }

    show() {
        this.visible = true;
    }

    hide() {
        this.visible = false;
    }
}

class Bin extends Actor {
    constructor({child, ...properties} = {}) {
        super(properties);
        if (child)
            this.set_child(child);
    }
}

class Button extends Actor {
    _fontScale = 1;

    ensure_style() {
        const percent = this.parent?.style?.match(/font-size: (\d+)%/)?.[1] ?? 100;
        this._fontScale = percent / 100;
    }

    get_preferred_width() {
        return [20, this.label.length * 10 * this._fontScale + 20];
    }
}

class PopupMenuSection extends Signals {
    actor = new Actor();

    addMenuItem(item, position = this.actor.children.length) {
        item.actor.parent = this.actor;
        item.actor._delegate = item;
        this.actor.children.splice(position, 0, item.actor);
    }

    addAction(label, activate) {
        const item = {
            label, activate, actor: new Actor(),
            setOrnament(ornament) { this.ornament = ornament; },
        };
        this.addMenuItem(item);
        return item;
    }

    _getMenuItems() {
        return this.actor.children.map(actor => actor._delegate);
    }

    get items() {
        return this._getMenuItems();
    }

    destroy() {
        this.isOpen = false;
        for (const item of this.items)
            item.destroy?.();
        this.actor.destroy();
        this.emit('destroy');
    }
}

class PopupSeparatorMenuItem {
    constructor(label = '') {
        this.label = label;
        this.actor = new Actor();
    }
}

class Keyboard extends Actor {
    constructor(controller, width = 4096) {
        super({width});
        this._keyboardController = controller;
        this._suggestions = new Actor();
        this._suggestions.add_child(new Actor({label: 'Native suggestion'}));
        this.add_child(this._suggestions);
        this._setupKeyboard();
        this.connect('destroy', this._onDestroy.bind(this));
    }

    _setupKeyboard() {}

    _onDestroy() {
        this._languagePopup?.destroy();
        this._languagePopup = null;
    }

    _popupLanguageMenu() {
        this._languagePopup?.destroy();
        this._languagePopup = new PopupMenuSection();
        this._languagePopup.addAction('English (US)', () => {}).setOrnament(Ornament.DOT);
        this._languagePopup.addMenuItem(new PopupSeparatorMenuItem());
        this._languagePopup.addAction('Keyboard Settings', () => {});
        this._languagePopup.isOpen = true;
    }

    setWidth(width) {
        this.width = width;
        this.emit('notify::width');
    }

    setVisible(visible) {
        this.visible = visible;
        this.emit('visibility-changed');
    }

    destroy() {
        this.emit('destroy');
        super.destroy();
    }
}

class Settings extends Signals {
    _values = new Map([['candidate-font-scale', 100]]);

    get_int(key) {
        return this._values.get(key);
    }

    set_int(key, value) {
        this._values.set(key, value);
        this.emit(`changed::${key}`);
    }
}

class Extension {
    constructor(settings) {
        this.settings = settings;
    }

    getSettings() {
        return this.settings;
    }

    gettext(text) {
        return text;
    }
}

class InjectionManager {
    _restores = [];

    overrideMethod(target, key, wrap) {
        const original = target[key];
        target[key] = wrap(original);
        this._restores.push(() => { target[key] = original; });
    }

    clear() {
        for (const restore of this._restores)
            restore();
    }
}

let sources;
let nextSourceId;
const GLib = {
    PRIORITY_DEFAULT: 0,
    SOURCE_REMOVE: false,
    timeout_add(_priority, _interval, callback) {
        const id = nextSourceId++;
        sources.set(id, callback);
        return id;
    },
    source_remove(id) {
        return sources.delete(id);
    },
};
const St = {BoxLayout: Actor, Button, Bin};
const Clutter = {ActorAlign: {CENTER: 2}};
const Ornament = {DOT: 'dot', NO_DOT: 'no-dot'};

const moduleUrl = source => `data:text/javascript,${encodeURIComponent(source)}`;
const mockKey = 'kimpanel-osk-bridge-test-modules';
globalThis[mockKey] = {GLib, Clutter, St, Keyboard, Extension, InjectionManager,
    Ornament, PopupMenuSection, PopupSeparatorMenuItem};

const bindings = `globalThis[${JSON.stringify(mockKey)}]`;
const extensionMocks = moduleUrl(`export const {Keyboard, Extension, InjectionManager} = ${bindings};`);
const mainMocks = moduleUrl(`
    export let keyboard, panel, extensionManager, inputMethod;
    export function setMain(values) {
        ({keyboard, panel, extensionManager, inputMethod} = values);
    }
`);
const mockModules = new Map([
    ['gi://GLib', moduleUrl(`export default ${bindings}.GLib;`)],
    ['gi://Clutter', moduleUrl(`export default ${bindings}.Clutter;`)],
    ['gi://St', moduleUrl(`export default ${bindings}.St;`)],
    ['resource:///org/gnome/shell/ui/main.js', mainMocks],
    ['resource:///org/gnome/shell/ui/keyboard.js', extensionMocks],
    ['resource:///org/gnome/shell/ui/popupMenu.js',
        moduleUrl(`export const {Ornament, PopupMenuSection, PopupSeparatorMenuItem} = ${bindings};`)],
    ['resource:///org/gnome/shell/extensions/extension.js', extensionMocks],
]);

const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
        const url = mockModules.get(specifier);
        return url ? {url, shortCircuit: true} : nextResolve(specifier, context);
    },
});
const {default: Bridge} = await import('../extension.js');
const {setMain} = await import(mainMocks);
hooks.deregister();
delete globalThis[mockKey];

export function createHarness({withKeyboard = true, keyboardWidth = 4096} = {}) {
    sources = new Map();
    nextSourceId = 1;
    const calls = {commit: [], raw: [], virtual: [], page: [], select: [], properties: [], trayMenus: []};
    const controller = {
        commit: async (str, modifiers) => { calls.commit.push([str, modifiers]); },
        _getKeyvalsFromString: str => Array.from(str, char => char.codePointAt(0)),
        keyvalPress: key => calls.raw.push(['press', key]),
        keyvalRelease: key => calls.raw.push(['release', key]),
    };
    const inputMethod = {
        currentFocus: {},
        async handleVirtualKey(key) {
            calls.virtual.push(key);
            return false;
        },
    };
    const panel = {
        table: [],
        enabled: true,
        showLookupTable: true,
        inputpanel: new Actor({visible: false}),
        updateInputPanel() { this.inputpanel.visible = this.showLookupTable && this.table.length > 0; },
        SetLookupTable(_labels, table) {
            this.table = table;
            this.updateInputPanel();
        },
        emit: signal => calls.page.push(signal),
        selectCandidate: index => calls.select.push(index),
        triggerProperty: property => calls.properties.push(property),
        menu: {execMenu: properties => calls.trayMenus.push(properties)},
        indicator: {
            _properties: {},
            _setIcon(status) { this._properties[status.key] = status; },
        },
    };
    const statusArea = {kimpanel: {kimpanel: panel}};
    const manager = {_keyboard: withKeyboard ? new Keyboard(controller, keyboardWidth) : null};
    const extensionManager = new Signals();
    setMain({keyboard: manager, panel: {statusArea}, extensionManager, inputMethod});
    const settings = new Settings();
    const bridge = new Bridge(settings);
    let enabled = true;
    bridge.enable();
    const disable = bridge.disable.bind(bridge);
    bridge.disable = () => {
        enabled = false;
        disable();
    };
    return {
        bridge, controller, inputMethod, panel, keyboard: manager._keyboard, calls, settings,
        dispose() {
            if (enabled)
                bridge.disable();
        },
        createKeyboard() {
            manager._keyboard = new Keyboard(controller, keyboardWidth);
            return manager._keyboard;
        },
        expireActions() {
            for (const [id, callback] of sources) {
                sources.delete(id);
                callback();
            }
        },
    };
}
