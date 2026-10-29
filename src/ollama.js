module.exports = function (RED) {
    const { extendNode } = require('@faigle/node-red-runtime-utils')(RED);

    function createError(message, code, cause) {
        const err = new Error(message);
        err.code = code;
        if (cause) err.cause = cause;
        return err;
    }

    function OllamaNode(config) {
        RED.nodes.createNode(this, config);
        this.name = config.name;
        this.host = config.host;
        this.model = config.model;
        this.promptTemplate = config.promptTemplate;
        this.inputProperty = config.inputProperty;
        this.inputPropertyType = config.inputPropertyType || 'msg';
        this.outputProperty = config.outputProperty;
        this.outputPropertyType = config.outputPropertyType || 'msg';

        var node = this;

        extendNode(node);

        // Requests still running when the node closes are aborted and never send.
        const pending = new Set();
        let closing = false;

        node.on('close', function () {
            closing = true;
            for (const controller of pending) controller.abort();
            node.status.clear();
        });

        node.on('input', async function (msg, send, done) {
            send = send || node.send.bind(node);
            if (closing) {
                if (done) done();
                return;
            }

            const controller = new AbortController();
            pending.add(controller);

            try {
                if (!node.host) throw createError('Ollama host is missing', 'HOST_MISSING');
                if (!node.model) throw createError('Ollama model is missing', 'MODEL_MISSING');

                node.status.processing('requesting...');

                const inputData = await node.getTypedProperty(
                    node.inputProperty,
                    node.inputPropertyType,
                    msg,
                );

                const finalPrompt = node.promptTemplate
                    ? `${node.promptTemplate}\n\n${inputData}`
                    : String(inputData);

                const response = await fetch(`${node.host}/api/generate`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        model: node.model,
                        prompt: finalPrompt,
                        stream: false,
                    }),
                    signal: controller.signal,
                });

                if (!response.ok) {
                    throw createError(`API error: ${response.statusText}`, 'HTTP_ERROR', {
                        status: response.status,
                    });
                }

                const data = await response.json();
                if (closing) {
                    if (done) done();
                    return;
                }

                await node.setTypedProperty(
                    node.outputProperty,
                    node.outputPropertyType,
                    msg,
                    data.response,
                );
                if (closing) {
                    if (done) done();
                    return;
                }

                node.status.succeeded('success');

                send(msg);

                if (done) done();
            } catch (err) {
                if (closing) {
                    if (done) done();
                    return;
                }

                node.status.failed(err.message || 'error');

                if (done) {
                    done(err);
                } else {
                    node.error(err, msg);
                }
            } finally {
                pending.delete(controller);
            }
        });
    }

    RED.nodes.registerType('ollama', OllamaNode);
};
