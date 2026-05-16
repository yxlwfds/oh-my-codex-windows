<!-- OMX:RUNTIME:START -->
<session_context>
**Session:** omx-1778683733524-7d764j | 2026-05-13T14:48:55.207Z

**Codebase Map:**
  src/: index
  src/adapt/: foundation.test, hermes.test, contracts, hermes, openclaw, paths, registry
  src/agents/: definitions.test, native-config.test, definitions, native-config, policy
  src/autoresearch/: contracts.test, runtime-parity-extra.test, runtime.test, skill-validation.test, contracts, goal, runtime, skill-validation
  src/catalog/: generator.test, plugin-bundle-ssot.test, schema.test, installable, reader, schema, skill-mirror
  src/cli/: adapt-help.test, adapt.test, agents-init.test, agents.test, ask.test, autoresearch-goal.test, autoresearch-guided.test, autoresearch.test, catalog-contract.test, cleanup.test
  src/compat/: doctor-contract.test, rust-runtime-compat.test
  src/config/: codex-feature-flags.test, codex-hooks.test, generator-idempotent.test, generator-notify.test, generator-status-line-presets.test, mcp-registry.test, models.test, wiki-config-contract.test, codex-feature-flags, codex-hooks
  src/document-refresh/: enforcer.test, config, enforcer
  src/e...

**Explore Command Preference:** enabled via `USE_OMX_EXPLORE_CMD` (default-on; opt out with `0`, `false`, `no`, or `off`)
- Advisory steering only: agents SHOULD treat `omx explore` as the default first stop for direct inspection and SHOULD reserve `omx sparkshell` for qualifying read-only shell-native tasks.
- For simple file/symbol lookups, use `omx explore` FIRST before attempting full code analysis.
- When the user asks for a simple read-only exploration task (file/symbol/pattern/relationship lookup), strongly prefer `omx explore` as the default surface.
- Explore examples: `omx explore...

**Compaction Protocol:**
Before context compaction, preserve critical state:
1. Write progress checkpoint via `omx state write --input '<json>' --json`
2. Save key decisions via `omx notepad write-working --input '<json>' --json`
3. If context is >80% full, proactively checkpoint state
</session_context>
<!-- OMX:RUNTIME:END -->
