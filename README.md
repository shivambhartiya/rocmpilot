---
title: ROCmPilot
sdk: docker
app_port: 7860
short_description: Agentic ROCm migration dashboard for moving AI workloads toward AMD readiness.
---

# ROCmPilot

ROCmPilot is a multi-agent developer tool that audits AI repositories and produces an AMD ROCm migration path for PyTorch, vLLM, and agentic workloads.

> ROCmPilot helps teams move from CUDA/NVIDIA assumptions to AMD ROCm readiness by scanning a repo, identifying blockers, proposing patches, preparing validation commands, and generating a technical/business migration report.

The project is built for the **AMD Developer Hackathon, Track 1: AI Agents & Agentic Workflows**. It uses Hugging Face as the temporary model and training layer now, and is designed to switch to AMD Developer Cloud + MI300X + ROCm/vLLM when access is available.

## Why This Exists

Many AI teams want AMD GPU optionality, but their codebases quietly assume NVIDIA:

- `nvidia/cuda` Docker images
- `torch.device("cuda")` and `.cuda()` calls scattered across code
- CUDA-specific package pins
- `nvidia-smi`, `CUDA_VISIBLE_DEVICES`, or `--gpus all` scripts
- vLLM launch scripts without ROCm/MI300X validation knobs
- benchmarks that omit backend, memory, tokens/sec, and reproducibility evidence

ROCmPilot turns that migration problem into an agentic workflow that feels like a product, not a checklist.

## What It Does Today

- Accepts a curated sample workload or a **public GitHub repository URL**.
- Scans relevant files from the repo using the GitHub API.
- Detects CUDA/NVIDIA assumptions.
- Produces ROCm-focused findings and patch previews.
- Shows a five-agent progress timeline.
- Shows an **Agent War Room** where the task lead asks other agents for input, agents reply to each other, and shared memory records reusable decisions.
- Persists the agent transcript to **Maximem Synap** long-context memory when `SYNAP_API_KEY` is configured, with local fallback when it is not.
- Generates terminal-style migration logs.
- Builds an AMD-readiness benchmark profile.
- Generates a final report using this backend priority:
  1. AMD ROCm/vLLM endpoint, when `AMD_QWEN_BASE_URL` is configured
  2. Hugging Face Inference Router, when `HF_TOKEN` is configured
  3. Static fallback report, so the demo never breaks

## Agent Workflow

1. **Repo Doctor Agent**
   - Scans Dockerfiles, Python files, requirements, scripts, benchmark files, and vLLM-related configs.
   - Flags CUDA/NVIDIA assumptions and missing validation evidence.

2. **Migration Planner Agent**
   - Converts findings into ROCm migration recommendations.
   - Produces patch previews such as `Dockerfile.rocm`, `requirements-rocm.txt`, device resolvers, and vLLM serve scripts.

3. **Build Runner Agent**
   - Prepares the build/test story.
   - In the current version, it does not mutate the target repo. It generates the commands and evidence plan.

4. **Benchmark Agent**
   - Produces an AMD-readiness profile.
   - Current benchmark values are estimates until live AMD Developer Cloud validation is connected.

5. **Report Agent**
   - Generates a judge-ready report explaining technical findings, AMD GPU path, business value, and next steps.
   - Can use Hugging Face now and AMD-hosted Qwen later.

### Agent War Room and Long-Context Memory

Each task has one lead agent, but the lead does not work alone. The lead asks the other agents for objections, validation criteria, benchmark provenance, or report framing. Their discussion is rendered as routed messages such as `Repo Doctor -> Build Runner` and `Migration Planner -> Build Runner`.

The agents also write reusable memory during the run:

- device resolution patterns
- ROCm acceptance checks
- container split decisions
- benchmark provenance rules

When Synap is configured, the Report Agent stores the whole war-room transcript as an `ai-chat-conversation`, retrieves scoped user context, and injects that context into the final report prompt. This lets ROCmPilot remember migration decisions across runs instead of rediscovering the same patterns every session.

If Synap credentials or runtime setup are missing, ROCmPilot falls back to reconstructed local memory and marks the UI as `Synap Memory: Local fallback`. The demo still completes.

## Architecture

```text
Browser UI
  |
  | POST /api/runs
  v
Stateless Run ID
  |
  | GET /api/runs/[runId]
  v
Repo Doctor + GitHub Scanner
  |
  v
Findings + Patch Previews + Logs + Agent Memory + Benchmark Profile
  |
  | POST /api/report
  v
Report Agent
  |
  | optional memory layer
  v
Maximem Synap long-context memory -> local fallback memory
  |
  | priority order
  v
AMD ROCm/vLLM -> Hugging Face Router -> Static fallback
```

The run system is stateless so it works on Vercel serverless functions without a database. The run ID encodes the start time, mode, and target. For the polished production version, real long-running AMD jobs should use persistent storage and a queue.

## Tech Stack

- Next.js App Router
- TypeScript
- Tailwind CSS
- shadcn/ui
- AI Elements for markdown, code, and terminal rendering
- Hugging Face Inference Router for temporary report generation
- Hugging Face Jobs/TRL for future LoRA fine-tuning
- Maximem Synap for persistent long-context agent memory
- AMD ROCm/vLLM endpoint support for the final compute story

## Local Development

```bash
npm install
npm run dev
```

Open:

```text
http://localhost:3000
```

Run checks:

```bash
npm run lint
npm run build
```

Optional Synap runtime setup for local or worker deployments:

```bash
npm run synap:setup
```

The Synap JS SDK uses a Python bridge. Vercel can still deploy the app without this setup because the report route falls back safely when Synap cannot initialize.

## Environment Variables

Temporary Hugging Face model backend:

```bash
HF_TOKEN=your_hugging_face_token
HF_REPORT_MODEL=Qwen/Qwen2.5-Coder-7B-Instruct
```

Optional GitHub token for higher public API limits:

```bash
GITHUB_TOKEN=your_github_token
```

Optional long-context memory:

```bash
SYNAP_API_KEY=your_synap_api_key
SYNAP_CUSTOMER_ID=rocmpilot-hackathon
SYNAP_USER_ID=rocmpilot-agent-fleet
SYNAP_AUTO_SETUP=false
```

Synap uses the default cloud endpoints automatically. Advanced deployments can also set `SYNAP_BASE_URL`, `SYNAP_GRPC_HOST`, `SYNAP_GRPC_PORT`, and `SYNAP_GRPC_TLS`.

Future AMD ROCm/vLLM backend:

```bash
AMD_QWEN_BASE_URL=http://YOUR_AMD_INSTANCE:8000
AMD_QWEN_MODEL=Qwen/Qwen3-Coder-Next
AMD_QWEN_API_KEY=optional-if-your-endpoint-requires-it
```

When `AMD_QWEN_BASE_URL` is present, the app automatically prefers AMD over Hugging Face.

## Deploy on Vercel

Vercel is the preferred web deployment target.

```bash
vercel
```

Set environment variables in Vercel Project Settings:

- `HF_TOKEN`
- `HF_REPORT_MODEL`
- `GITHUB_TOKEN` optional
- `SYNAP_API_KEY` optional
- `SYNAP_CUSTOMER_ID` optional
- `SYNAP_USER_ID` optional
- `AMD_QWEN_BASE_URL` later
- `AMD_QWEN_MODEL` later

The current app does not require a database for the demo flow. Synap is optional and the UI will show whether long-context memory is connected or using fallback memory.

## Deploy as a Hugging Face Space

The repo also includes a Docker Space setup for hackathon submissions that require a Hugging Face Space link.

Files:

- `Dockerfile`
- `.dockerignore`
- Space metadata in this README frontmatter

Create a Docker Space, then upload this project. The app listens on port `7860` in the Space container.

Recommended Space ID:

```text
Shivam311/rocmpilot
```

## Training and Improving the Agents

The `agent-training/` folder contains the training path for a more accurate agent:

- `seed-examples.jsonl`: initial supervised examples
- `eval-rubric.md`: scoring rubric
- `scripts/prepare_dataset.py`: converts seed examples into chat SFT format
- `scripts/train_rocmpilot_sft.py`: LoRA SFT script for Hugging Face Jobs
- `scripts/evaluate_agent.py`: smoke eval against an OpenAI-compatible endpoint

Prepare and push a seed dataset:

```bash
uv run agent-training/scripts/prepare_dataset.py \
  --push \
  --repo-id Shivam311/rocmpilot-agent-sft
```

Launch a small training run on Hugging Face Jobs after confirming paid Jobs access:

```bash
hf jobs uv run \
  --flavor t4-small \
  --timeout 45m \
  --secrets HF_TOKEN \
  --env DATASET_ID=Shivam311/rocmpilot-agent-sft \
  --env OUTPUT_MODEL=Shivam311/rocmpilot-agent-qwen-lora \
  agent-training/scripts/train_rocmpilot_sft.py
```

Run eval:

```bash
uv run agent-training/scripts/evaluate_agent.py
```

For a serious version, expand the dataset to at least 200-500 examples from real migration cases before training.

## Future AMD Integration

Once AMD Developer Cloud access is ready:

1. Start an MI300X instance.
2. Install or use a ROCm/vLLM image.
3. Serve Qwen through an OpenAI-compatible vLLM endpoint.
4. Set `AMD_QWEN_BASE_URL` in Vercel.
5. Re-run ROCmPilot and capture:
   - vLLM startup logs
   - AMD GPU visibility
   - one model response
   - benchmark output
   - final report generated through AMD-hosted Qwen

Suggested serving command:

```bash
python -m vllm.entrypoints.openai.api_server \
  --model Qwen/Qwen3-Coder-Next \
  --host 0.0.0.0 \
  --port 8000 \
  --tensor-parallel-size 1 \
  --max-model-len 32768
```

## What Is Real vs Temporary

Real today:

- Working dashboard
- Public GitHub URL intake
- GitHub API file scan
- Rule-based ROCm findings
- Patch previews
- Report backend priority system
- Vercel-safe stateless run flow
- Hugging Face training scaffold

Temporary/demo today:

- Patch previews are not committed back to GitHub yet
- Build logs are generated evidence, not real Docker builds
- Benchmark numbers are estimates until AMD validation
- Model fine-tuning scripts are ready but not launched automatically

Next production upgrades:

- GitHub App auth and PR creation
- Persistent run history
- Real queue for AMD validation jobs
- Live ROCm Docker builds
- Live vLLM benchmarks
- Fine-tuned ROCmPilot model hosted through HF/AMD

## Submission Story

ROCmPilot is a Track 1 agentic workflow because the core product is the coordination of specialized agents that inspect, plan, validate, benchmark, and report. AMD compute enters as the target validation environment and the future hosted model runtime for Qwen on ROCm/vLLM.

The clean hackathon positioning:

> ROCmPilot helps developers migrate AI workloads to AMD faster. It scans a GitHub repo, finds CUDA assumptions, proposes ROCm patches, prepares AMD validation, and generates a business-ready migration report. Today it runs with Hugging Face fallback; when AMD Developer Cloud is available, the same app switches to Qwen served on MI300X through ROCm/vLLM.

## Sources

- AMD: Day 0 Support for Qwen3-Coder-Next on AMD Instinct GPUs  
  https://www.amd.com/en/developer/resources/technical-articles/2026/day-0-support-for-qwen3-coder-next-on-amd-instinct-gpus.html
- Qwen3-Coder announcement  
  https://qwenlm.github.io/blog/qwen3-coder/
- vLLM supported models  
  https://docs.vllm.ai/en/v0.15.1/models/supported_models/
- Hugging Face Docker Spaces  
  https://huggingface.co/docs/hub/spaces-sdks-docker
- Hugging Face Jobs  
  https://huggingface.co/docs/huggingface_hub/guides/jobs
