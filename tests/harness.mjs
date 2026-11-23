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

    destroy_all_children() {
        for (const child of [...this.children])
            child.destroy();
    }

    destroy() {
        this.destroy_all_children();
        const siblings = this.parent?.children;
        siblings?.splice(siblings.indexOf(this), 1);
    }

    show() {
        this.visible = true;
    }

    hide() {
        this.visible = false;
    }
}

class ScrollView extends Actor {
    hadjustment = {value: 0};
}

class Button extends Actor {
    _label = {};

    get_child() {
        return this._label;
    }
}

class Keyboard extends Actor {
    constructor(controller) {
        super();
        this._keyboardController = controller;
        this._suggestions = new Actor();
        this._suggestions.add_child(new Actor({label: 'Native suggestion'}));
        this.add_child(this._suggestions);
        this._setupKeyboard();
        this.connect('destroy', this._onDestroy.bind(this));
    }

    _setupKeyboard() {}

    _onDestroy() {}

    setVisible(visible) {
        this.visible = visible;
        this.emit('visibility-changed');
    }

    destroy() {
        this.emit('destroy');
        super.destroy();
    }
}

class Extension {
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
const St = {BoxLayout: Actor, Button, ScrollView, PolicyType: {AUTOMATIC: 1, NEVER: 2}};
const Pango = {EllipsizeMode: {NONE: 0}};

const moduleUrl = source => `data:text/javascript,${encodeURIComponent(source)}`;
const mockKey = 'kimpanel-osk-bridge-test-modules';
globalThis[mockKey] = {GLib, Pango, St, Keyboard, Extension, InjectionManager};

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
    ['gi://Pango', moduleUrl(`export default ${bindings}.Pango;`)],
    ['gi://St', moduleUrl(`export default ${bindings}.St;`)],
    ['resource:///org/gnome/shell/ui/main.js', mainMocks],
    ['resource:///org/gnome/shell/ui/keyboard.js', extensionMocks],
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

export function createHarness({withKeyboard = true} = {}) {
    sources = new Map();
    nextSourceId = 1;
    const calls = {commit: [], raw: [], virtual: [], page: [], select: []};
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
    };
    const statusArea = {kimpanel: {kimpanel: panel}};
    const manager = {_keyboard: withKeyboard ? new Keyboard(controller) : null};
    const extensionManager = new Signals();
    setMain({keyboard: manager, panel: {statusArea}, extensionManager, inputMethod});
    const bridge = new Bridge();
    let enabled = true;
    bridge.enable();
    const disable = bridge.disable.bind(bridge);
    bridge.disable = () => {
        enabled = false;
        disable();
    };
    return {
        bridge, controller, inputMethod, panel, keyboard: manager._keyboard, calls,
        dispose() {
            if (enabled)
                bridge.disable();
        },
        createKeyboard() {
            manager._keyboard = new Keyboard(controller);
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
