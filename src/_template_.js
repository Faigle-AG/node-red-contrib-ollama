module.exports = function (RED) {
    function ExampleTemplateNode(config) {
        RED.nodes.createNode(this, config);
        this.name = config.name;
        this.enableLogging = config.enableLogging;

        var node = this;

        node.on('input', function (msg, send, done) {
            if (node.enableLogging) {
                node.log('Received payload: ' + JSON.stringify(msg.payload));
            }

            node.status({ fill: 'blue', shape: 'dot', text: 'Processed message' });

            send(msg);

            if (done) {
                done();
            }

            setTimeout(() => node.status({}), 3000);
        });
    }

    RED.nodes.registerType('_template_', ExampleTemplateNode);
};
