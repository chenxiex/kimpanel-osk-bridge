import assert from 'node:assert/strict';
import test from 'node:test';

import {createHarness} from './harness.mjs';

function setPage(panel, table, hasPrev, hasNext) {
    panel.SetLookupTable([], table, [], hasPrev, hasNext, -1, 0);
}

function candidateRow(keyboard) {
    return keyboard.get_children()[1];
}

function controls(keyboard) {
    const [previous, scroll, next] = candidateRow(keyboard).get_children();
    return {previous, candidates: scroll.get_children()[0].get_children(), next};
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
    first.next.emit('clicked');
    first.candidates[8].emit('clicked');
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
    const returned = controls(keyboard);
    first.candidates[8].emit('clicked');
    assert.deepEqual(calls.select, []);
    returned.candidates[8].emit('clicked');
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

test('leaves native suggestions available and removes bridge controls on disable', t => {
    const {bridge, dispose, keyboard, panel} = createHarness();
    t.after(dispose);
    const [nativeRow] = keyboard.get_children();
    setPage(panel, ['one'], false, false);
    assert.equal(controls(keyboard).next.visible, false);

    panel.showLookupTable = false;
    panel.updateInputPanel();
    assert.equal(candidateRow(keyboard).visible, false);
    setPage(panel, ['two'], false, true);
    panel.showLookupTable = true;
    panel.updateInputPanel();

    bridge.disable();
    assert.deepEqual(keyboard.get_children(), [nativeRow]);
    assert.deepEqual(nativeRow.get_children().map(button => button.label), ['Native suggestion']);
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
