# @faigle/node-red-contrib-ollama

Node-RED node for sending prompts to a local Ollama instance.

This package provides an **ollama** node that sends input data from a Node-RED message to an Ollama model and writes the generated response back to a configurable message property.

This package was generated from [node-red-contrib-template](https://github.com/Faigle-AG/node-red-contrib-_template_).

## Features

- Connects to a local or remote Ollama API endpoint
- Supports configurable Ollama models
- Reads input from a configurable `msg`, `flow`, `global`, string, JSONata, or environment property
- Optional system prompt / prompt template
- Writes the model response to a configurable output property
- Uses Ollama's `/api/generate` endpoint with non-streaming responses
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

Optional instruction text prepended to the input data.

The final prompt is built as:

```text
<System Prompt>

<Input Data>
```

If no system prompt is configured, only the input data is sent.

### Output To

The message property where the generated response is written.

Default:

```text
msg.payload
```

## Input

The incoming message triggers a request to Ollama.

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

The node writes the generated model response to the configured output property.

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

The model response is written to the configured output property.

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
