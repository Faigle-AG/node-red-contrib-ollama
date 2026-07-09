module.exports = function (RED) {
    const { extendNode } = require('@faigle/node-red-runtime-utils')(RED);

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

        node.on('input', async function (msg, send, done) {
            try {
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
                });

                if (!response.ok) {
                    throw new Error(`API error: ${response.statusText}`);
                }

                const data = await response.json();

                await node.setTypedProperty(
                    node.outputProperty,
                    node.outputPropertyType,
                    msg,
                    data.response,
                );

                node.status.succeeded('success');

                send(msg);

                if (done) done();
            } catch (err) {
                node.status.failed(err.message || 'error');

                if (done) {
                    done(err);
                } else {
                    node.error(err, msg);
                }
            }
        });
    }

    RED.nodes.registerType('ollama', OllamaNode);
};
