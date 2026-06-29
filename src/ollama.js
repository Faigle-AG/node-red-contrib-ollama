module.exports = function (RED) {
    function OllamaNode(config) {
        RED.nodes.createNode(this, config);
        this.name = config.name;
        this.host = config.host;
        this.model = config.model;
        this.promptTemplate = config.promptTemplate;
        this.inputProperty = config.inputProperty;
        this.outputProperty = config.outputProperty;

        var node = this;

        node.on('input', async function (msg, send, done) {
            node.status({ fill: 'blue', shape: 'dot', text: 'requesting...' });

            try {
                const inputData = RED.util.getMessageProperty(msg, node.inputProperty);

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

                RED.util.setMessageProperty(msg, node.outputProperty, data.response);

                node.status({ fill: 'green', shape: 'dot', text: 'success' });

                send(msg);

                if (done) done();
            } catch (err) {
                node.status({ fill: 'red', shape: 'ring', text: 'error' });
                if (done) {
                    done(err);
                } else {
                    node.error(err, msg);
                }
            }

            setTimeout(() => node.status({}), 5000);
        });
    }

    RED.nodes.registerType('ollama', OllamaNode);
};
