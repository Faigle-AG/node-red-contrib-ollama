const assert = require('assert/strict');
const http = require('http');
const helper = require('node-red-node-test-helper');
const ollamaNode = require('../src/ollama.js');
const catchNode = require('@node-red/nodes/core/common/25-catch.js');
const { trigger, lastStatusText, delay } = require('./helpers/harness');

helper.init(require.resolve('node-red'));

// Runs against a loopback-only mock of the Ollama /api/generate endpoint; no external network.
describe('ollama node', function () {
    let server;
    let host;
    let requests;
    let respond;

    function json(res, status, body) {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
    }

    function load(nodeConfig, extraNodes = []) {
        const flow = [
            { id: 'f1', type: 'tab' },
            {
                id: 'n1',
                z: 'f1',
                type: 'ollama',
                host,
                model: 'llama3',
                promptTemplate: '',
                inputProperty: 'payload',
                inputPropertyType: 'msg',
                outputProperty: 'payload',
                outputPropertyType: 'msg',
                wires: [['out']],
                ...nodeConfig,
            },
            { id: 'out', z: 'f1', type: 'helper' },
            ...extraNodes.map((node) => ({ z: 'f1', ...node })),
        ];
        return helper.load([ollamaNode, catchNode], flow);
    }

    before(function (done) {
        server = http.createServer((req, res) => {
            let body = '';
            req.on('data', (chunk) => (body += chunk));
            req.on('end', () => {
                const entry = {
                    method: req.method,
                    url: req.url,
                    headers: req.headers,
                    body: body ? JSON.parse(body) : undefined,
                    res,
                    aborted: false,
                };
                res.on('close', () => {
                    if (!res.writableEnded) entry.aborted = true;
                });
                requests.push(entry);
                respond(entry);
            });
        });
        server.listen(0, '127.0.0.1', () => {
            host = `http://127.0.0.1:${server.address().port}`;
            done();
        });
    });

    after(function (done) {
        server.closeAllConnections();
        server.close(done);
    });

    beforeEach(function (done) {
        requests = [];
        respond = ({ res }) => json(res, 200, { response: 'pong' });
        helper.startServer(done);
    });

    afterEach(function (done) {
        helper.unload();
        helper.stopServer(done);
    });

    it('posts the templated prompt to /api/generate and writes the response', async function () {
        await load({ promptTemplate: 'Summarize:', outputProperty: 'answer' });

        const result = await trigger(
            helper,
            'n1',
            'out',
            { payload: 'hello', topic: 't' },
            { settleMs: 50 },
        );

        assert.equal(requests.length, 1);
        assert.equal(requests[0].method, 'POST');
        assert.equal(requests[0].url, '/api/generate');
        assert.match(requests[0].headers['content-type'], /application\/json/);
        assert.deepEqual(requests[0].body, {
            model: 'llama3',
            prompt: 'Summarize:\n\nhello',
            stream: false,
        });
        assert.equal(result.msg.answer, 'pong');
        assert.equal(result.msg.payload, 'hello');
        assert.equal(result.msg.topic, 't');
        assert.equal(lastStatusText(result), 'success');
        assert.deepEqual(result.extra, { outputs: 0, errors: 0 });
    });

    it('sends the input alone when no template is set', async function () {
        await load({});

        await trigger(helper, 'n1', 'out', { payload: 'just this' });

        assert.equal(requests[0].body.prompt, 'just this');
    });

    it('legacy: stringifies object input with String()', async function () {
        await load({});

        await trigger(helper, 'n1', 'out', { payload: { a: 1 } });

        assert.equal(requests[0].body.prompt, '[object Object]');
    });

    it('reads input from and writes output to flow context', async function () {
        await load({
            inputProperty: 'question',
            inputPropertyType: 'flow',
            outputProperty: 'answer',
            outputPropertyType: 'flow',
        });
        helper.getNode('n1').context().flow.set('question', 'from context');

        const result = await trigger(helper, 'n1', 'out', { payload: 'untouched' });

        assert.equal(requests[0].body.prompt, 'from context');
        assert.equal(helper.getNode('n1').context().flow.get('answer'), 'pong');
        assert.equal(result.msg.payload, 'untouched');
    });

    it('reports HTTP_ERROR with the status for non-2xx responses and sends nothing', async function () {
        respond = ({ res }) => json(res, 500, { error: 'boom' });
        await load({});

        const result = await trigger(helper, 'n1', 'out', { payload: 'x' }, { settleMs: 50 });

        assert.equal(result.err.code, 'HTTP_ERROR');
        assert.equal(result.err.message, 'API error: Internal Server Error');
        assert.deepEqual(result.err.cause, { status: 500 });
        assert.equal(lastStatusText(result), 'API error: Internal Server Error');
        assert.deepEqual(result.extra, { outputs: 0, errors: 0 });
    });

    it('passes network errors through when the host refuses the connection', async function () {
        const closed = http.createServer();
        await new Promise((resolve) => closed.listen(0, '127.0.0.1', resolve));
        const refusedHost = `http://127.0.0.1:${closed.address().port}`;
        await new Promise((resolve) => closed.close(resolve));
        await load({ host: refusedHost });

        const result = await trigger(helper, 'n1', 'out', { payload: 'x' }, { timeout: 3000 });

        assert.ok(result.err);
        assert.equal(result.err.code, undefined);
        assert.equal(lastStatusText(result), result.err.message);
    });

    it('legacy: malformed JSON from a 2xx response fails with the uncoded parse error', async function () {
        respond = ({ res }) => {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end('not json');
        };
        await load({});

        const result = await trigger(helper, 'n1', 'out', { payload: 'x' }, { settleMs: 50 });

        assert.ok(result.err instanceof SyntaxError);
        assert.equal(result.err.code, undefined);
        assert.deepEqual(result.extra, { outputs: 0, errors: 0 });
    });

    it('legacy: a response without a "response" field writes undefined', async function () {
        respond = ({ res }) => json(res, 200, { done: true });
        await load({ outputProperty: 'answer' });

        const result = await trigger(helper, 'n1', 'out', { payload: 'x', answer: 'old' });

        assert.equal(result.msg.answer, undefined);
        assert.equal(lastStatusText(result), 'success');
    });

    it('writes an empty response string as a successful result', async function () {
        respond = ({ res }) => json(res, 200, { response: '' });
        await load({ outputProperty: 'answer' });

        const result = await trigger(helper, 'n1', 'out', { payload: 'x' });

        assert.equal(result.msg.answer, '');
        assert.equal(lastStatusText(result), 'success');
    });

    it('reports HOST_MISSING and MODEL_MISSING without a request', async function () {
        await load({ host: '' });
        const noHost = await trigger(helper, 'n1', 'out', { payload: 'x' });
        assert.equal(noHost.err.code, 'HOST_MISSING');

        helper.unload();
        await load({ model: '' });
        const noModel = await trigger(helper, 'n1', 'out', { payload: 'x' });
        assert.equal(noModel.err.code, 'MODEL_MISSING');

        assert.equal(requests.length, 0);
    });

    it('aborts an in-flight request on close and sends nothing', async function () {
        respond = () => {};
        await load({});
        const outputs = [];
        const errors = [];
        helper.getNode('out').on('input', (msg) => outputs.push(msg));
        helper.getNode('n1').on('call:error', (call) => errors.push(call.args[0]));

        helper.getNode('n1').receive({ payload: 'slow' });
        for (let i = 0; i < 50 && requests.length === 0; i++) await delay(10);
        assert.equal(requests.length, 1);

        await helper.unload();
        for (let i = 0; i < 50 && !requests[0].aborted; i++) await delay(10);

        assert.equal(requests[0].aborted, true);
        await delay(50);
        assert.deepEqual(outputs, []);
        assert.deepEqual(errors, []);
    });

    it('does not send or report success when closed during the output write', async function () {
        await load({});
        const node = helper.getNode('n1');
        const writeOutput = node.setTypedProperty;
        let release;
        let writeStarted = false;
        const gate = new Promise((resolve) => (release = resolve));
        node.setTypedProperty = async (...args) => {
            writeStarted = true;
            await gate;
            return writeOutput.apply(node, args);
        };
        const sends = [];
        const errors = [];
        const statuses = [];
        node.on('call:send', (call) => sends.push(call.args[0]));
        node.on('call:error', (call) => errors.push(call.args[0]));
        node.on('call:status', (call) => statuses.push(call.args[0]));

        node.receive({ payload: 'x' });
        for (let i = 0; i < 100 && !writeStarted; i++) await delay(10);
        assert.equal(writeStarted, true);

        await helper.unload();
        const statusesAtClose = statuses.length;
        release();
        await delay(50);

        assert.deepEqual(sends, []);
        assert.deepEqual(errors, []);
        assert.equal(
            statuses.slice(statusesAtClose).some((status) => status.text === 'success'),
            false,
        );
    });

    it('exposes HTTP_ERROR to Catch nodes', async function () {
        respond = ({ res }) => json(res, 503, {});
        await load({}, [
            { id: 'c1', type: 'catch', scope: null, uncaught: false, wires: [['caught']] },
            { id: 'caught', type: 'helper' },
        ]);

        const caught = new Promise((resolve) => helper.getNode('caught').on('input', resolve));
        helper.getNode('n1').receive({ payload: 'x', _marker: 'm1' });
        const msg = await caught;

        assert.equal(msg._marker, 'm1');
        assert.equal(msg.error.code, 'HTTP_ERROR');
        assert.deepEqual(msg.error.cause, { status: 503 });
    });
});
