import assert from 'node:assert/strict';
import test from 'node:test';

import {createHarness} from './harness.mjs';

const nativeCommitCases = [
    ['disabled panel', harness => { harness.panel.enabled = false; }],
    ['hidden keyboard', harness => { harness.keyboard.setVisible(false); }],
    ['missing input focus', harness => { harness.inputMethod.currentFocus = null; }],
    ['active modifiers', () => new Set([0xffe3])],
    ['native OSK completion', harness => { harness.controller._oskCompletionEnabled = true; }],
    ['IBus input source', harness => { harness.controller._currentSource = {type: 'ibus'}; }],
];

for (const [name, configure] of nativeCommitCases) {
    test(`preserves native commit with ${name}`, async t => {
        const harness = createHarness();
        t.after(harness.dispose);
        const modifiers = configure(harness);

        await harness.controller.commit('ni', modifiers);

        assert.deepEqual(harness.calls.commit, [['ni', modifiers]]);
        assert.deepEqual(harness.calls.virtual, []);
        assert.deepEqual(harness.calls.raw, []);
    });
}

const virtualKeyCases = [
    ['handled', async () => true, []],
    ['unhandled', async () => false, [
        ['press', 110], ['release', 110],
        ['press', 105], ['release', 105],
    ]],
    ['failed', async () => { throw new Error('Input method unavailable'); }, [
        ['press', 110], ['release', 110],
        ['press', 105], ['release', 105],
    ]],
];

for (const [name, handle, expectedRaw] of virtualKeyCases) {
    test(`forwards ${name} virtual keys through the input method`, async t => {
        const harness = createHarness();
        t.after(harness.dispose);
        harness.inputMethod.handleVirtualKey = keyval => {
            harness.calls.virtual.push(keyval);
            return handle();
        };

        await harness.controller.commit('ni');

        assert.deepEqual(harness.calls.virtual, [110, 105]);
        assert.deepEqual(harness.calls.raw, expectedRaw);
        assert.deepEqual(harness.calls.commit, []);
    });
}

const pendingCommitCases = [
    ['focus changes', harness => { harness.inputMethod.currentFocus = {}; }],
    ['keyboard is destroyed', harness => { harness.keyboard.destroy(); }],
];

for (const [name, invalidate] of pendingCommitCases) {
    test(`stops pending input when ${name}`, async t => {
        const harness = createHarness();
        t.after(harness.dispose);
        let resolveKey;
        const keyResult = new Promise(resolve => { resolveKey = resolve; });
        harness.inputMethod.handleVirtualKey = keyval => {
            harness.calls.virtual.push(keyval);
            return keyResult;
        };

        const commit = harness.controller.commit('ni');
        assert.deepEqual(harness.calls.virtual, [110]);
        invalidate(harness);
        resolveKey(false);
        await commit;

        assert.deepEqual(harness.calls.virtual, [110]);
        assert.deepEqual(harness.calls.raw, []);
        assert.deepEqual(harness.calls.commit, []);
    });
}

test('restores native commit after disabling the bridge', async t => {
    const harness = createHarness();
    t.after(harness.dispose);

    harness.bridge.disable();
    await harness.controller.commit('ni');

    assert.deepEqual(harness.calls.commit, [['ni', undefined]]);
    assert.deepEqual(harness.calls.virtual, []);
    assert.deepEqual(harness.calls.raw, []);
});
