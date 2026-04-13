# Session Close Template

Use this when wrapping up a task or bug-fix batch.

## Output template

```markdown
## Session Close

- **Work**: what was done
- **Lessons**:
  - lesson 1
  - lesson 2
  - lesson 3
- **Stored in**:
  - inbox / notes / main skill
- **Promotion decision**:
  - promoted now / keep in inbox / keep in recipe only
- **Reason**:
  - repeated / cross-project / still one-off / not validated enough
```

## Extraction hints

Prefer lessons from:
- a failed assumption
- a user correction
- a verification step that caught a real issue
- a release/cache behavior that was surprising
- a command or payload shape that is easy to forget

Avoid:
- vague motivation
- generic engineering slogans
- anything without concrete evidence

## Recommended limit

- `1-3` lessons for a normal task
- `3-5` lessons for a complex release or incident

If there are more than `5`, group them by pattern instead of dumping all of them.

