import assert from 'node:assert/strict';
import test from 'node:test';

import {createHarness} from './harness.mjs';

function setPage(panel, table, hasPrev, hasNext) {
    panel.SetLookupTable([], table, [], hasPrev, hasNext, -1, 0);
}

function candidateRow(keyboard) {
    return keyboard.get_children().find(child => child !== keyboard._suggestions);
}

function controls(keyboard) {
    const [previous, viewport, next] = candidateRow(keyboard).get_children();
    const candidates = viewport.get_children()[0].get_children().filter(button => button.visible);
    return {previous, candidates, next};
}

test('pages through the engine and selects by index within the returned page', t => {
    const {calls, dispose, keyboard, panel} = createHarness();
    t.after(dispose);
    const words = Array.from({length: 9}, (_, index) => `candidate ${index + 1}`);
    words[8] += '\ncomment';
    setPage(panel, words, false, true);
    const first = controls(keyboard);
    assert.equal(first.previous.reactive, false);
    assert.equal(first.next.reactive, true);
    assert.equal(first.candidates.length, 9);
    assert.equal(first.candidates[8].label, 'candidate 9');

    first.next.emit('clicked');
    assert.equal(first.next.reactive, false);
    assert.equal(first.candidates[8].reactive, false);
    assert.deepEqual(calls.page, ['LookupTablePageDown']);
    assert.deepEqual(calls.select, []);

    setPage(panel, [...words], true, true);
    const middle = controls(keyboard);
    assert.equal(middle.previous.reactive, true);
    assert.equal(middle.next.reactive, true);
    middle.next.emit('clicked');

    setPage(panel, [...words], true, false);
    const last = controls(keyboard);
    assert.equal(last.next.reactive, false);
    last.previous.emit('clicked');
    assert.deepEqual(calls.page, ['LookupTablePageDown', 'LookupTablePageDown', 'LookupTablePageUp']);

    setPage(panel, [...words], true, true);
    controls(keyboard).candidates[8].emit('clicked');
    assert.deepEqual(calls.select, [8]);
});

test('releases the current page for retry if the engine sends no update', t => {
    const {calls, dispose, expireActions, keyboard, panel} = createHarness();
    t.after(dispose);
    setPage(panel, ['one'], false, true);
    const {next} = controls(keyboard);
    next.emit('clicked');
    assert.equal(next.reactive, false);

    expireActions();
    assert.equal(next.reactive, true);
    next.emit('clicked');
    assert.deepEqual(calls.page, ['LookupTablePageDown', 'LookupTablePageDown']);
});

test('shows cached candidates when an OSK is created and restores the popup when it is destroyed', t => {
    const {createKeyboard, dispose, panel} = createHarness({withKeyboard: false});
    t.after(dispose);
    setPage(panel, ['one'], false, true);
    assert.equal(panel.inputpanel.visible, true);

    const keyboard = createKeyboard();
    assert.equal(candidateRow(keyboard).visible, true);
    assert.equal(panel.inputpanel.visible, false);

    keyboard.destroy();
    assert.equal(panel.inputpanel.visible, true);
});

test('keeps non-empty native suggestions visible and removes bridge controls on disable', t => {
    const {bridge, dispose, keyboard, panel} = createHarness();
    t.after(dispose);
    const nativeRow = keyboard._suggestions;
    setPage(panel, ['one'], false, true);
    assert.equal(nativeRow.visible, true);
    assert.equal(candidateRow(keyboard).visible, true);

    bridge.disable();
    assert.deepEqual(keyboard.get_children(), [nativeRow]);
    assert.equal(panel.inputpanel.visible, true);
});

test('keeps candidates selectable when no page flags were observed for the current table', t => {
    const {calls, dispose, keyboard, panel} = createHarness();
    t.after(dispose);
    setPage(panel, ['one'], false, true);

    panel.table = ['new'];
    panel.updateInputPanel();
    const {previous, candidates, next} = controls(keyboard);
    assert.equal(previous.visible, false);
    assert.equal(next.visible, false);
    candidates[0].emit('clicked');
    assert.deepEqual(calls.select, [0]);
});

test('pages locally before requesting another engine page and retains candidate indices', t => {
    const {calls, dispose, keyboard, panel} = createHarness({keyboardWidth: 160});
    t.after(dispose);
    setPage(panel, ['one', 'two', 'six', 'ten', 'red', 'fox'], false, true);
    const labels = () => controls(keyboard).candidates.map(button => button.label);
    assert.deepEqual(labels(), ['one', 'two']);

    controls(keyboard).next.emit('clicked');
    assert.deepEqual(labels(), ['six', 'ten']);
    controls(keyboard).previous.emit('clicked');
    assert.deepEqual(labels(), ['one', 'two']);
    controls(keyboard).next.emit('clicked');
    controls(keyboard).candidates[1].emit('clicked');

    assert.deepEqual(calls.page, []);
    assert.deepEqual(calls.select, [3]);
});

test('crosses engine page boundaries and enters the previous engine page at its last local slice', t => {
    const {calls, dispose, keyboard, panel} = createHarness({keyboardWidth: 160});
    t.after(dispose);
    const words = ['one', 'two', 'six', 'ten', 'red', 'fox'];
    setPage(panel, words, false, true);
    controls(keyboard).next.emit('clicked');
    controls(keyboard).next.emit('clicked');
    controls(keyboard).next.emit('clicked');
    assert.deepEqual(calls.page, ['LookupTablePageDown']);
    setPage(panel, ['cat', 'dog', 'ant', 'owl'], true, false);
    assert.deepEqual(controls(keyboard).candidates.map(button => button.label), ['cat', 'dog']);
    controls(keyboard).previous.emit('clicked');
    assert.deepEqual(calls.page, ['LookupTablePageDown', 'LookupTablePageUp']);

    setPage(panel, [...words], false, true);
    assert.deepEqual(controls(keyboard).candidates.map(button => button.label), ['red', 'fox']);
});

test('keeps the first visible candidate in view when the keyboard width changes', t => {
    const {calls, dispose, keyboard, panel} = createHarness({keyboardWidth: 160});
    t.after(dispose);
    setPage(panel, ['one', 'two', 'six', 'ten', 'red', 'fox'], false, true);
    controls(keyboard).next.emit('clicked');
    assert.equal(controls(keyboard).candidates[0].label, 'six');

    keyboard.setWidth(210);

    assert.deepEqual(controls(keyboard).candidates.map(button => button.label), ['one', 'two', 'six']);
    assert.deepEqual(calls.page, []);
});

test('uses the saved font scale on keyboard creation and repaginates when it changes', t => {
    const {calls, createKeyboard, dispose, panel, settings} = createHarness({
        withKeyboard: false,
        keyboardWidth: 160,
    });
    t.after(dispose);
    settings.set_int('candidate-font-scale', 150);
    setPage(panel, ['one', 'two', 'six', 'ten'], false, true);
    const keyboard = createKeyboard();
    const labels = () => controls(keyboard).candidates.map(button => button.label);
    assert.deepEqual(labels(), ['one']);

    controls(keyboard).next.emit('clicked');
    assert.deepEqual(labels(), ['two']);
    settings.set_int('candidate-font-scale', 100);
    assert.deepEqual(labels(), ['one', 'two']);
    assert.deepEqual(calls.page, []);
    controls(keyboard).candidates[1].emit('clicked');
    assert.deepEqual(calls.select, [1]);
});

test('keeps a candidate wider than the available row selectable', t => {
    const {calls, dispose, keyboard, panel} = createHarness({keyboardWidth: 160});
    t.after(dispose);
    setPage(panel, ['a candidate longer than the entire keyboard'], false, false);

    const {candidates} = controls(keyboard);
    assert.equal(candidates.length, 1);
    candidates[0].emit('clicked');
    assert.deepEqual(calls.select, [0]);
});

test('reclaims an empty native suggestions row and toggles visibility with lookup table state', t => {
    const {bridge, dispose, keyboard, panel} = createHarness();
    t.after(dispose);
    const nativeRow = keyboard._suggestions;
    setPage(panel, ['one'], false, false);
    nativeRow.destroy_all_children();
    assert.equal(nativeRow.visible, false);

    panel.showLookupTable = false;
    panel.updateInputPanel();
    assert.equal(candidateRow(keyboard).visible, false);
    assert.equal(nativeRow.visible, true);

    panel.showLookupTable = true;
    panel.updateInputPanel();
    assert.equal(candidateRow(keyboard).visible, true);
    assert.equal(nativeRow.visible, false);
    bridge.disable();
    assert.equal(nativeRow.visible, true);
});
