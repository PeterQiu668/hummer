# HUMMER W8 local distillation kernel

This package implements a narrow, executable W8 kernel for **strictly synthetic structured records**. It proves that HUMMER can:

- call a replaceable `GuiGroundingAdapter` and stop for human review on missing, ambiguous, low-confidence, or unbound grounding;
- compile an ended `DemoSessionV1` plus source-bound synthetic records into reviewable capability and bounded-behavior tracks;
- preserve a source list and explicit `needs-human` judgment annotations;
- parse two bounded natural-language correction forms into auditable, append-only package revisions;
- roll back by appending a new version rather than rewriting history.

The draft uses the existing `CapabilityPackageAuthorInput` contract, which is the human-authored portion of `CapabilityPackageV1`. This is intentional: `CapabilityPackageV1` requires a system-derived `trialRecord`, and this package must not fabricate trial evidence before W9 execution.

Supported correction forms are deliberately narrow:

```text
replace workflow "old text" with "new text"
when "scene", replace "wrong behavior" with "correct behavior"
将流程“旧内容”改为“新内容”
在“场景”场景，将“错误做法”改为“正确做法”
```

Run the executable gate with `npm run test:distillation`.

## Explicit limitations

- No real screen capture, accessibility-tree capture, or GUI model is included.
- No real ten-minute expert demonstration has been distilled.
- No LLM quality, GUI grounding accuracy, or fidelity-to-an-expert claim is made.
- The output remains `draft` and `needs-human-review`; it is not a verified or shared capability.
- `AC-P2-DIST-05` is **not complete**. The gate only covers a synthetic kernel and negative safety behavior.
