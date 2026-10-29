'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Topic colour from the shared palette: LLM & AI Models, local (Soft Periwinkle).
const EDITORS = [{ file: 'ollama.html', type: 'ollama', color: '#9FA8DA' }];

// Evaluates the editor's registration scripts against a minimal RED stub and returns
// the registered definitions by type.
function loadDefinitions(html) {
    const registered = new Map();
    const anything = () =>
        new Proxy(function () {}, { get: () => anything(), apply: () => anything() });
    const RED = {
        nodes: { registerType: (type, definition) => registered.set(type, definition) },
        validators: anything(),
        _: (key) => key,
    };
    const scripts = [...html.matchAll(/<script type="text\/javascript">([\s\S]*?)<\/script>/g)];
    for (const [, source] of scripts) vm.runInNewContext(source, { RED, $: anything() });
    return registered;
}

describe('ollama editor', function () {
    for (const editor of EDITORS) {
        describe(editor.file, function () {
            const html = fs.readFileSync(path.join(__dirname, '../src', editor.file), 'utf8');

            it(`registers ${editor.type} with the local LLM colour`, function () {
                const definition = loadDefinitions(html).get(editor.type);
                assert.ok(definition, `${editor.type} is registered`);
                assert.equal(definition.color, editor.color);
                assert.equal(definition.category, 'ai processing');
            });

            it('uses the shared editor.css and .faigle-node-editor wrapper', function () {
                assert.match(
                    html,
                    /href="resources\/@faigle\/node-red-runtime-utils\/editor\.css"/,
                );
                assert.match(html, /class="faigle-node-editor"/);
                assert.doesNotMatch(html, /<style|input-width-70/);
            });
        });
    }
});
