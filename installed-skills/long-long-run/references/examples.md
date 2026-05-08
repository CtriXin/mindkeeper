# Worked Examples

For shell examples below:

```bash
export CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
export LLR_PY="$CODEX_HOME/skills/long-long-run/scripts"
export LLR_CTL="$CODEX_HOME/skills/long-long-run/scripts/controller.py"
```

## Example 1: INC Exploration With Python

```bash
python3 - <<'PY'
import os
import sys

sys.path.insert(0, os.environ["LLR_PY"])
from runtime import current_runtime

rt = current_runtime()
print(rt.bind(auto_create=True, project_root="/tmp/project"))

print(
    rt.update_contract(
        {
            "objective": "Map the legacy service and define the implementation path.",
            "why_now": "The user needs a trustworthy takeover before implementation begins.",
            "requirements": ["Base conclusions on direct evidence."],
            "success_criteria": ["Produce a coherent project map and an agreed execution path."],
            "guardrails": ["Do not start implementation before authorization."],
            "confirmed": True,
        }
    )
)

print(
    rt.update_thinking(
        {
            "inferred_intent": "Stay in INC while reconstructing the project from repo artifacts and logs.",
            "evidence_chain": [
                {
                    "claim": "The service must be mapped before implementation starts.",
                    "basis": "The user asked for a trustworthy takeover and no implementation before authorization.",
                    "implication": "Continue reading entrypoints, docs, and runtime scripts before proposing ACTIVE.",
                }
            ],
            "expert_defaults": ["Inspect structure, docs, configs, and real run entrypoints first."],
            "verified_constraints": ["Use the deployment docs as the source of truth for environment paths."],
            "open_decisions": ["Whether to start implementation after the mapping is complete."],
        }
    )
)

print(
    rt.update(
        {
            "progress": {
                "completion_signal": "The project map and agreed execution path are captured.",
                "next_action": "Read the backend entrypoints and dependency manifests.",
            }
        }
    )
)
PY
```

## Example 2: INC-Only Research

Use INC when the user wants facts, validation, or decision support without committing to implementation.

```bash
python3 "$LLR_CTL" current \
  --auto-create \
  --project-root /tmp/research-target

python3 "$LLR_CTL" update --json '{
  "contract": {
    "objective": "Understand whether the migration risk is real.",
    "why_now": "The user needs evidence before deciding whether to authorize work.",
    "requirements": ["Base conclusions on direct evidence."],
    "success_criteria": ["Summarize supported facts, uncertainties, and options."],
    "guardrails": ["Do not start implementation without explicit authorization."],
    "confirmed": false
  },
  "thinking": {
    "inferred_intent": "Use INC as standalone research and decision support.",
    "evidence_chain": [
      {
        "claim": "The user has not selected an implementation target yet.",
        "basis": "The request asks for exploration and verification before deciding.",
        "implication": "Keep gathering facts and do not raise ACTIVE until a mainline is clear."
      }
    ],
    "open_decisions": ["Which migration path, if any, should become the mainline."]
  },
  "progress": {
    "next_action": "Inspect the migration docs and current deployment scripts.",
    "completion_signal": "The user has enough supported facts to decide whether to authorize a mainline."
  }
}'
```

## Example 3: Authorization and Activation

```bash
python3 "$LLR_CTL" authorize-active \
  --evidence "The user explicitly said: start implementation now."

python3 "$LLR_CTL" activate
```

## Example 4: Evidence Invalidates the ACTIVE Route

If ACTIVE evidence overturns the current route, record the change and return to INC.

```bash
python3 "$LLR_CTL" checkpoint \
  --summary "Replaced the old completion assumption after trace evidence showed missing validation coverage." \
  --next-action "Resynthesize the acceptance criteria around trace-level validation."

python3 "$LLR_CTL" update --json '{
  "thinking": {
    "evidence_chain": [
      {
        "claim": "The previous green gate is not sufficient completion evidence.",
        "basis": "Trace-level validation showed missing coverage in the old acceptance path.",
        "implication": "Return to INC and resynthesize the completion criteria before continuing the mainline."
      }
    ]
  }
}'

python3 "$LLR_CTL" return-to-inc \
  --reason "New evidence invalidated the active completion route." \
  --next-action "Clarify or resynthesize the new success criteria."
```

## Example 5: Close the Runtime

```bash
python3 "$LLR_CTL" close \
  --reason complete \
  --summary "Completed the authorized mainline and captured the final report."
```
