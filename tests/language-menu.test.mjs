import assert from 'node:assert/strict';
import test from 'node:test';

import {createHarness} from './harness.mjs';

const inputMethodProperty = '/Fcitx/im';
const nativeMenuLabels = ['English (US)', '', 'Keyboard Settings'];
const inputMethods = [
    '/Fcitx/im/keyboard-us:键盘 - 英语（美国）:input-keyboard::',
    '/Fcitx/im/pinyin:拼音:fcitx-pinyin::',
    '/Fcitx/im/rime:中州韵:fcitx-rime::',
];

function menuLabels(popup) {
    return popup.items.map(item => item.label);
}

test('the OSK uses the Kimpanel list and triggers the selected input method', t => {
    const harness = createHarness();
    t.after(harness.dispose);
    const {keyboard, panel, calls} = harness;

    keyboard._popupLanguageMenu();
    assert.deepEqual(calls.properties, [inputMethodProperty]);
    const popup = keyboard._languagePopup;
    panel.menu.execMenu(inputMethods);

    const [nativeAction, section, settingsSeparator, settingsAction] = popup.items;
    assert.deepEqual([nativeAction.label, settingsSeparator.label, settingsAction.label], nativeMenuLabels);
    assert.equal(section.items[0].constructor.name, settingsSeparator.constructor.name);
    assert.deepEqual(menuLabels(section), ['Fcitx5', '键盘 - 英语（美国）', '拼音', '中州韵']);
    assert.deepEqual(calls.trayMenus, []);

    const pinyin = section.items[2];
    assert.equal(pinyin.can_focus, false);
    pinyin.activate();
    assert.deepEqual(calls.properties, [inputMethodProperty, '/Fcitx/im/pinyin']);

    harness.bridge.disable();
    assert.deepEqual(menuLabels(popup), nativeMenuLabels);
    panel.menu.execMenu(inputMethods);
    assert.deepEqual(calls.trayMenus, [inputMethods]);
});

test('forwards unrelated menus while an OSK request is pending', t => {
    const harness = createHarness();
    t.after(harness.dispose);
    const {keyboard, panel, calls} = harness;
    const settingsMenu = ['/Fcitx/punctuation/full:Full width:fcitx-punc-active::'];

    keyboard._popupLanguageMenu();
    panel.menu.execMenu(settingsMenu);
    assert.deepEqual(calls.trayMenus, [settingsMenu]);

    panel.menu.execMenu(inputMethods);
    const [, section] = keyboard._languagePopup.items;
    assert.equal(section.items[0].label, 'Fcitx5');
});

const requestCases = [
    ['the tray', harness => harness.panel.triggerProperty(inputMethodProperty), true],
    ['a replacement OSK popup', harness => harness.keyboard._popupLanguageMenu(), false],
];

for (const [name, supersede, useTray] of requestCases) {
    test('routes a pending list to ' + name, t => {
        const harness = createHarness();
        t.after(harness.dispose);
        const {keyboard, panel, calls} = harness;

        keyboard._popupLanguageMenu();
        const firstPopup = keyboard._languagePopup;
        supersede(harness);
        assert.deepEqual(calls.properties, [inputMethodProperty]);
        panel.menu.execMenu(inputMethods);

        if (useTray) {
            assert.deepEqual(calls.trayMenus, [inputMethods]);
            assert.deepEqual(menuLabels(firstPopup), nativeMenuLabels);
        } else {
            assert.deepEqual(firstPopup.items, []);
            const [, section] = keyboard._languagePopup.items;
            assert.equal(section.items[0].label, 'Fcitx5');
            assert.deepEqual(calls.trayMenus, []);
        }
    });
}

test('drops an OSK response received after its popup closes', t => {
    const harness = createHarness();
    t.after(harness.dispose);
    const {keyboard, panel, calls} = harness;

    keyboard._popupLanguageMenu();
    const popup = keyboard._languagePopup;
    popup.isOpen = false;
    panel.menu.execMenu(inputMethods);

    assert.deepEqual(menuLabels(popup), nativeMenuLabels);
    assert.deepEqual(calls.trayMenus, []);
});

test('allows a new menu request after a missing Kimpanel response', t => {
    const harness = createHarness();
    t.after(harness.dispose);
    const {keyboard, panel, calls} = harness;

    keyboard._popupLanguageMenu();
    harness.expireActions();
    assert.deepEqual(menuLabels(keyboard._languagePopup), nativeMenuLabels);

    panel.triggerProperty(inputMethodProperty);
    assert.deepEqual(calls.properties, [inputMethodProperty, inputMethodProperty]);
    panel.menu.execMenu(inputMethods);
    assert.deepEqual(calls.trayMenus, [inputMethods]);
});

test('marks the cached Kimpanel method and moves the dot on a status update', t => {
    const harness = createHarness();
    t.after(harness.dispose);
    const {keyboard, panel} = harness;
    panel.indicator._setIcon({
        key: inputMethodProperty, label: '中州韵', icon: 'fcitx-rime', text: '拼音', hint: ['menu', 'label=ㄓ'],
    });

    keyboard._popupLanguageMenu();
    panel.menu.execMenu(inputMethods);
    const [nativeSource, section] = keyboard._languagePopup.items;
    const activeFcitxItems = () => section.items.filter(item => item.ornament === 'dot').map(item => item.label);
    assert.equal(nativeSource.ornament, 'dot');
    assert.deepEqual(activeFcitxItems(), ['中州韵']);

    panel.indicator._setIcon({
        key: inputMethodProperty, label: '中', icon: '', text: '拼音', hint: ['menu', 'label=中'],
    });
    assert.deepEqual(activeFcitxItems(), ['拼音']);
});

for (const [name, status] of [
    ['missing', {}],
    ['ambiguous', {key: inputMethodProperty, label: '中州韵', icon: 'fcitx-rime'}],
]) {
    test('keeps Fcitx5 entries unmarked when the current method is ' + name, t => {
        const harness = createHarness();
        t.after(harness.dispose);
        const {keyboard, panel} = harness;
        panel.indicator._setIcon(status);
        keyboard._popupLanguageMenu();
        panel.menu.execMenu([...inputMethods, '/Fcitx/im/other-rime:中州韵:other-icon::']);

        const [, section] = keyboard._languagePopup.items;
        assert.deepEqual(section.items.slice(1).map(item => item.ornament), Array(4).fill('no-dot'));
    });
}
