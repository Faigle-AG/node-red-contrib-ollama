const helper = require('node-red-node-test-helper');
const templateNode = require('../src/_template_.js');

helper.init(require.resolve('node-red'));

describe('example-template Node', function () {
    afterEach(function () {
        helper.unload();
    });

    it('should load correctly with the given name', function (done) {
        const flow = [{ id: 'n1', type: '_template_', name: 'my template' }];

        helper.load(templateNode, flow, function () {
            const n1 = helper.getNode('n1');
            try {
                n1.should.have.property('name', 'my template');
                done();
            } catch (err) {
                done(err);
            }
        });
    });

    it('should pass the message payload through unmodified', function (done) {
        const flow = [
            { id: 'n1', type: '_template_', wires: [['n2']] },
            { id: 'n2', type: 'helper' },
        ];

        helper.load(templateNode, flow, function () {
            const n1 = helper.getNode('n1');
            const n2 = helper.getNode('n2');

            n2.on('input', function (msg) {
                try {
                    msg.should.have.property('payload', 'hello world');
                    done();
                } catch (err) {
                    done(err);
                }
            });

            n1.receive({ payload: 'hello world' });
        });
    });
});
