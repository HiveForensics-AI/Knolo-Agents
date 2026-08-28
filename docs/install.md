# Installing Knolo

Knolo installs as a native `knolo` CLI. The installer builds the Rust runtime
from the repository or from the configured Knolo Git repository.

## From a checkout

```bash
sh install.sh
```

The default destination is `~/.local/bin/knolo`. Set `KNOLO_INSTALL_DIR` to use
another installation prefix:

```bash
KNOLO_INSTALL_DIR=/usr/local sh install.sh
```

The supported remote installation form is:

```bash
curl -fsSL https://raw.githubusercontent.com/HiveForensics-AI/Knolo-Agents/main/install.sh | sh
```

The remote form uses a prebuilt release binary when one is available and
falls back to Cargo/source installation during development. Set
`KNOLO_USE_SOURCE=1` to force a source build or `KNOLO_BINARY_URL` to install a
specific archive.

## Configure a local model

Knolo uses the OpenAI-compatible chat-completions protocol. This works with
Ollama, LM Studio, llama.cpp, vLLM, and compatible local servers.

For Ollama:

```bash
ollama serve
ollama pull qwen2.5-coder:7b
knolo init
knolo model add local \
  --provider ollama \
  --model qwen2.5-coder:7b \
  --base-url http://127.0.0.1:11434/v1
knolo model list
```

Create an agent bound to that model:

```bash
knolo agent create --template coding --model local my-coder
knolo run --agent my-coder "inspect the workspace and report what needs attention"
```

An existing named agent can be changed with:

```bash
knolo agent set-model my-coder local
```

## Cloud-compatible providers

The same adapter can use an HTTPS OpenAI-compatible endpoint. Store only the
environment variable name in Knolo; the credential itself stays outside the
configuration files:

```bash
export OPENAI_API_KEY=your-key
knolo model add cloud \
  --provider openai-compatible \
  --model gpt-4o-mini \
  --base-url https://api.openai.com/v1 \
  --api-key-env OPENAI_API_KEY
knolo agent set-model my-coder cloud
```

The runtime still enforces profile capabilities, write approval, action limits,
turn limits, retries, cancellation, and session recording around every model
plan.

Verify the installation and local endpoint before starting a run with:

    knolo doctor
