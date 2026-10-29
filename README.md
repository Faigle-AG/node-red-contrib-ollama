# @faigle/node-red-contrib-ollama

Node-RED node for sending prompts to a local Ollama instance.

This package provides an **ollama** node that sends input data from a Node-RED message to an Ollama model and writes the generated response back to a configurable message property.

This package was generated from [node-red-contrib-template](https://github.com/Faigle-AG/node-red-contrib-_template_).

## Features

- Connects to a local or remote Ollama API endpoint
- Supports configurable Ollama models
- Reads input from a configurable `msg`, `flow`, `global`, string, JSONata, or environment property
- Optional prompt prefix (the editor's **System Prompt** / prompt template)
- Writes the model response to a configurable `msg`, `flow`, or `global` output property
- Uses Ollama's `/api/generate` endpoint with non-streaming responses
- Aborts tracked requests when the node closes
- Shows Node-RED status while requesting, on success, and on error

## Requirements

- Node-RED
- A running Ollama instance
- The selected model must already be available in Ollama

Example Ollama setup:

```bash
ollama serve
ollama pull llama3
```

Default Ollama API URL:

```text
http://localhost:11434
```

## Node

### ollama

Sends a prompt to an Ollama model and returns the generated response.

The node has one input and one output.

## Properties

### Name

Optional node label shown in the Node-RED editor.

### Host

The Ollama API base URL.

Default:

```text
http://localhost:11434
```

Example:

```text
http://localhost:11434
```

### Model

The Ollama model name to use.

Default:

```text
llama3
```

Examples:

```text
llama3
mistral
gemma
codellama
```

The model must be installed in Ollama before the node can use it.

### Input Data

The input property containing the data to send to Ollama.

Default:

```text
msg.payload
```

Supported typed input sources:

- `msg`
- `flow`
- `global`
- `str`
- `jsonata`
- `env`

### System Prompt

Optional literal instruction text prepended to the input data. This is an ordinary prompt prefix, not Ollama's separate `system` field or a Chat Completions system message.

The final prompt is built as:

```text
<System Prompt>

<Input Data>
```

If no system prompt is configured, only the input data is sent.

### Output To

The `msg`, `flow`, or `global` property where the response is written. Only these writable types are supported; the node still forwards the incoming message when the result is stored in context.

Default:

```text
msg.payload
```

## Input

The incoming message triggers a request to Ollama. Use a nonempty string for a portable text-in/text-out flow.

The node preserves its legacy JavaScript coercion: without a template it uses `String(value)`, and with a template it interpolates the value into the prompt. A plain object normally becomes `[object Object]`, arrays become comma-separated text, and Buffers become text; objects are **not** automatically JSON-serialized or interpreted as chat history. Typed-property resolution maps null/undefined values to an empty string when resolution succeeds; missing parent paths can instead throw. Empty prompts are sent to Ollama, which decides whether to accept them.

Example input:

```js
msg.payload = 'Summarize Node-RED in one sentence.';
return msg;
```

With a configured system prompt:

```text
Answer clearly and concisely.
```

The node sends this final prompt to Ollama:

```text
Answer clearly and concisely.

Summarize Node-RED in one sentence.
```

## Output

The node writes the JSON response's `response` field to the configured output property. A normal Ollama response supplies a string; JSON-looking model text is not parsed automatically. Other message fields are preserved, and no provider metadata namespace is added.

Legacy response handling is intentionally unchanged: an empty response string succeeds, and a JSON object missing `response` writes `undefined` and still reports success. The response field's type is not validated. Validate the result in your flow if an alternate endpoint may return a different schema.

Default output:

```js
msg.payload =
    'Node-RED is a flow-based development tool for wiring together devices, APIs, and services.';
return msg;
```

Example with a custom output property:

```js
msg.ai = 'Generated response text';
return msg;
```

## Example Flow Usage

### Basic prompt

Configure the node with:

- **Host**: `http://localhost:11434`
- **Model**: `llama3`
- **Input Data**: `msg.payload`
- **Output To**: `msg.payload`

Inject:

```js
msg.payload = 'Write a short product description for a smart thermostat.';
return msg;
```

The response will be written back to:

```js
msg.payload;
```

### Extract structured information

Configure **System Prompt**:

```text
Extract the company name, contact person, and email address from the text. Return JSON only.
```

Inject:

```js
msg.payload = 'Please contact Anna Müller at anna@example.com from Example AG.';
return msg;
```

The model response is written to the configured output property. Follow it with a JSON node and application-specific validation if you need structured data; model instructions do not guarantee valid JSON.

### Portable text flow

```text
Inject (text in msg.payload) → Ollama → Debug (msg.answer)
Catch (scoped to Ollama) → error-handling flow
```

Configure **Input Data** as `msg.payload` and **Output To** as `msg.answer`, and select your Ollama host and an installed model. Inject `Explain Node-RED in one sentence.` The original `msg.payload` remains available; a normal response is a string at `msg.answer`.

This text-in/text-out pattern also works with the OpenAI V1 Compatible and Azure Foundry nodes, but their request formats and metadata differ. Ollama uses `prompt`; OpenAI uses Chat Completions `messages`; Foundry uses Responses `input`. Do not pass one provider's history/tool response object to another without explicitly adapting it. These nodes do not automatically execute tools or maintain a conversation.

Existing saved Ollama fields remain `inputProperty/inputPropertyType` and `outputProperty/outputPropertyType`; there is no source/target migration.

## Runtime Behavior

The node sends a POST request to:

```text
/api/generate
```

Request body:

```json
{
    "model": "llama3",
    "prompt": "Prompt text",
    "stream": false
}
```

The node reads the `response` field from Ollama's JSON response and writes it to the configured output property.

Each input has its own request cancellation controller. Closing or redeploying the node aborts tracked requests. Cancellation cannot guarantee that the remote model stops generating, and it does not undo a context write already started. Concurrent inputs are independent; responses can arrive out of order.

There is no configurable inference timeout or automatic retry policy. A slow request can remain pending until it finishes, fails, or the node closes.

### Errors

Failures report through Node-RED Catch handling rather than a success output. Explicit error codes are:

- `HOST_MISSING` — host is missing.
- `MODEL_MISSING` — model is missing.
- `HTTP_ERROR` — Ollama returned a non-2xx status; `msg.error.cause.status` contains the HTTP status and the message remains `API error: <statusText>`.

Network, JSON-parsing and typed-property errors retain their original errors and may have no code. Status text uses the error message, not the new code. Treat model output and provider error content as untrusted, and redact sensitive data before forwarding errors or logs. The node has no authentication settings; protect remote Ollama access with appropriate network/transport controls.

## Status Indicators

The node displays runtime status in the Node-RED editor:

- `requesting...` — request is being sent to Ollama
- `success` — response was received and written to the output property
- `error` — request failed or Ollama returned an error

## Troubleshooting

### Ollama is not reachable

Check that Ollama is running:

```bash
ollama serve
```

Verify the configured host:

```text
http://localhost:11434
```

If Node-RED runs in Docker, `localhost` refers to the container, not the host machine. Use the correct network hostname or host IP.

### Model not found

Pull the model before using it:

```bash
ollama pull llama3
```

### Empty or unexpected response

Check:

- the configured input property
- whether `msg.payload` or the selected input field contains text
- the system prompt
- the selected model name

### Long requests

Large prompts or slower models may take time to respond. The node shows `requesting...` while the Ollama request is active.
