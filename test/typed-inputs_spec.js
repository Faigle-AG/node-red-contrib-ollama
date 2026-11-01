'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Module = require('module');
const { AsyncLocalStorage } = require('async_hooks');
const helper = require('node-red-node-test-helper');
const { util } = require('@node-red/util');

helper.init(require.resolve('node-red'));

// Phase 2.9: the typed fields of the ollama node. T1 pins what the editor offers, T2 checks that
// the runtime allows exactly those types, T3 evaluates every offered type, T4 rejects any other
// type before anything is evaluated or requested, and T5 pins the defaults of flows saved without
// the type fields.

const VALUE = ['msg', 'flow', 'global', 'str', 'jsonata', 'env'];
const TARGET = ['msg', 'flow', 'global'];

// What the editor offers: the types in order, the selected default type, and the saved defaults
// of the value and of its type field.
const FIELDS = {
    inputProperty: { types: VALUE, default: 'msg', value: 'payload', type: 'msg' },
    outputProperty: { types: TARGET, default: 'msg', value: 'payload', type: 'msg' },
};

// Runs the editor's registration script and its oneditprepare against a recording jQuery stub,
// and returns the registered definition and every typedInput it creates, by field.
function loadEditor() {
    const html = fs.readFileSync(path.join(__dirname, '../src/ollama.html'), 'utf8');
    const registered = new Map();
    const inputs = {};
    const element = (selector) =>
        new Proxy(function () {}, {
            get(target, prop) {
                if (prop === 'selector') return selector;
                if (prop === 'typedInput') {
                    return (options) => {
                        inputs[selector.replace('#node-input-', '')] = {
                            // Copied into this realm: the editor script runs in its own.
                            types: Array.from(options.types),
                            default: options.default,
                            typeField: options.typeField && options.typeField.selector,
                        };
                        return element(selector);
                    };
                }
                if (prop === 'val') return () => '';
                if (prop === 'prop' || prop === 'is') return () => false;
                return () => element(selector);
            },
            apply: () => element(selector),
        });
    const anything = () =>
        new Proxy(function () {}, { get: () => anything(), apply: () => anything() });
    const RED = {
        nodes: { registerType: (type, definition) => registered.set(type, definition) },
        validators: anything(),
        _: (key) => key,
    };
    for (const [, source] of html.matchAll(/<script type="text\/javascript">([\s\S]*?)<\/script>/g))
        vm.runInNewContext(source, { RED, $: (selector) => element(String(selector)) });
    const definition = registered.get('ollama');
    const self = Object.fromEntries(
        Object.entries(definition.defaults).map(([key, spec]) => [key, spec.value]),
    );
    definition.oneditprepare.call(self);
    return { definition, inputs };
}

// The node never reaches the global fetch: ollama.js is compiled with `fetch` bound to this
// fence, which stays bound for good. The fence serves only the test that owns the call (an
// AsyncLocalStorage owner each test enters) while that test is active. Any other call, before a
// test, after its nodes are unloaded or from a stale continuation of an earlier test, is refused
// and recorded; it is never passed on to another test or to a real transport.
const owner = new AsyncLocalStorage();
const strays = [];
async function fenceFetch(url, init) {
    const current = owner.getStore();
    if (!current || !current.active) {
        strays.push(String(url));
        throw new Error('fetch called outside an active test');
    }
    current.requests.push({ url: String(url), body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ response: 'pong' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });
}

const ollamaNode = (() => {
    const filename = path.join(__dirname, '../src/ollama.js');
    const module = { exports: {} };
    const body = vm.compileFunction(
        fs.readFileSync(filename, 'utf8'),
        ['exports', 'require', 'module', '__filename', '__dirname', 'fetch'],
        { filename },
    );
    body(
        module.exports,
        Module.createRequire(filename),
        module,
        filename,
        path.dirname(filename),
        fenceFetch,
    );
    return module.exports;
})();

// The active test's fixture, and its requests and Node-RED's evaluations of typed properties.
let fixture = null;
let requests = null;
let evaluations = null;

// Makes the running test the owner of the node's requests.
function startFixture() {
    fixture = { active: true, requests: [] };
    requests = fixture.requests;
    owner.enterWith(fixture);
}

function run(node, msg) {
    return new Promise((resolve) => {
        const timer = setTimeout(() => resolve({ timeout: true }), 1500);
        helper.getNode('out').once('input', (out) => {
            clearTimeout(timer);
            resolve({ msg: out });
        });
        node.once('call:error', (call) => {
            clearTimeout(timer);
            resolve({ err: call.args[0] });
        });
        node.receive(msg);
    });
}

describe('typed inputs (Phase 2.9)', function () {
    this.timeout(10000);
    let realEvaluate;

    before(function () {
        realEvaluate = util.evaluateNodeProperty;
        util.evaluateNodeProperty = function (value, type, ...rest) {
            if (evaluations) evaluations.push(type);
            return realEvaluate.call(this, value, type, ...rest);
        };
    });

    after(function () {
        util.evaluateNodeProperty = realEvaluate;
        assert.deepEqual(strays, []);
    });

    describe('T1 editor pins and T2 runtime parity', function () {
        const { definition, inputs } = loadEditor();

        it('creates exactly the expected typed inputs', function () {
            assert.deepEqual(Object.keys(inputs).sort(), Object.keys(FIELDS).sort());
        });

        for (const [field, expected] of Object.entries(FIELDS)) {
            it(`${field}: offered types, default type, type field and saved defaults`, function () {
                assert.deepEqual(inputs[field].types, expected.types);
                assert.equal(inputs[field].default, expected.default);
                assert.equal(inputs[field].typeField, `#node-input-${field}Type`);
                assert.equal(definition.defaults[field].value, expected.value);
                assert.equal(definition.defaults[`${field}Type`].value, expected.type);
            });

            it(`${field}: the runtime allows exactly the offered types`, function () {
                assert.deepEqual([...ollamaNode.TYPES[field]].sort(), [...expected.types].sort());
            });
        }
    });

    describe('runtime', function () {
        beforeEach(function (done) {
            evaluations = [];
            helper.startServer(done);
        });

        afterEach(function (done) {
            delete process.env.TYPED_29_VALUE;
            helper.unload().then(() =>
                helper.stopServer(() => {
                    // Only now, after unload: any later request of these nodes is refused.
                    if (fixture) fixture.active = false;
                    fixture = null;
                    requests = null;
                    evaluations = null;
                    done();
                }),
            );
        });

        async function load(node, contextValue) {
            startFixture();
            await helper.load(ollamaNode, [
                { id: 'f1', type: 'tab' },
                {
                    id: 'n1',
                    z: 'f1',
                    type: 'ollama',
                    host: 'http://ollama.test',
                    model: 'llama3',
                    promptTemplate: '',
                    wires: [['out']],
                    ...node,
                },
                { id: 'out', z: 'f1', type: 'helper' },
            ]);
            const n1 = helper.getNode('n1');
            n1.context().flow.set('p', contextValue);
            n1.context().global.set('p', contextValue);
            evaluations.length = 0;
            return n1;
        }

        // A configured value of each offered type that resolves to `value`, given msg.p, flow and
        // global p, and the environment variable.
        function representative(type, value) {
            process.env.TYPED_29_VALUE = value;
            return {
                msg: ['p', { p: value }],
                flow: ['p', {}],
                global: ['p', {}],
                str: [value, {}],
                jsonata: ['p', { p: value }],
                env: ['TYPED_29_VALUE', {}],
            }[type];
        }

        const URL_29 = 'http://ollama.test/api/generate';

        it('the fetch fence refuses a request outside any test, and the global fetch is untouched', async function () {
            const before = globalThis.fetch;
            await owner.run(undefined, () =>
                assert.rejects(fenceFetch(URL_29, { body: '{}' }), {
                    message: 'fetch called outside an active test',
                }),
            );
            assert.deepEqual(strays.splice(0), [URL_29]);
            assert.equal(globalThis.fetch, before);
        });

        it('a late call of a finished test is refused, not served by the test in progress', async function () {
            const earlier = { active: true, requests: [] };
            let late;
            owner.run(earlier, () => {
                setTimeout(() => {
                    late = fenceFetch(URL_29, { body: '{}' }).catch((err) => err);
                }, 20);
            });
            earlier.active = false;
            startFixture();
            await new Promise((resolve) => setTimeout(resolve, 60));
            assert.equal((await late).message, 'fetch called outside an active test');
            assert.deepEqual(requests, []);
            assert.deepEqual(earlier.requests, []);
            assert.deepEqual(strays.splice(0), [URL_29]);
        });

        describe('T3 every offered type works', function () {
            for (const type of VALUE) {
                it(`inputProperty of type ${type} becomes the prompt`, async function () {
                    const [inputProperty, msg] = representative(type, 'hello');
                    const n1 = await load(
                        { inputProperty, inputPropertyType: type, outputProperty: 'payload' },
                        'hello',
                    );
                    const result = await run(n1, msg);
                    assert.equal(result.msg.payload, 'pong');
                    assert.equal(requests.length, 1);
                    assert.equal(requests[0].body.prompt, 'hello');
                    // The counter sees the node's own evaluation.
                    assert.ok(evaluations.includes(type), `evaluations: ${evaluations}`);
                });
            }

            for (const type of TARGET) {
                it(`outputProperty of type ${type} receives the response`, async function () {
                    const n1 = await load({
                        inputProperty: 'payload',
                        inputPropertyType: 'msg',
                        outputProperty: 'answer',
                        outputPropertyType: type,
                    });
                    const result = await run(n1, { payload: 'hello' });
                    const written =
                        type === 'msg' ? result.msg.answer : n1.context()[type].get('answer');
                    assert.equal(written, 'pong');
                });
            }
        });

        describe('T4 any other type fails before anything is evaluated or requested', function () {
            for (const type of ['num', 'foo']) {
                it(`inputProperty of type ${type}`, async function () {
                    const n1 = await load({
                        inputProperty: 'payload',
                        inputPropertyType: type,
                        outputProperty: 'payload',
                    });
                    const result = await run(n1, { payload: 'hello' });
                    assert.equal(result.err.code, 'INVALID_CONFIGURATION');
                    assert.equal(result.err.message, `Input data type '${type}' is not supported`);
                    assert.deepEqual(requests, []);
                    assert.deepEqual(evaluations, []);
                });
            }

            for (const type of ['str', 'foo']) {
                it(`outputProperty of type ${type} fails with the setter's message`, async function () {
                    const n1 = await load({
                        inputProperty: 'payload',
                        inputPropertyType: 'msg',
                        outputProperty: 'payload',
                        outputPropertyType: type,
                    });
                    const result = await run(n1, { payload: 'hello' });
                    assert.equal(result.err.code, undefined);
                    assert.equal(result.err.message, `Unsupported target property type: ${type}`);
                    assert.deepEqual(requests, []);
                    assert.deepEqual(evaluations, []);
                });
            }
        });

        describe('T5 flows saved without the type fields', function () {
            it('reads msg.payload and writes msg.payload', async function () {
                const n1 = await load({ inputProperty: 'payload', outputProperty: 'payload' });
                const result = await run(n1, { payload: 'legacy' });
                assert.equal(requests[0].body.prompt, 'legacy');
                assert.equal(result.msg.payload, 'pong');
            });
        });
    });
});
