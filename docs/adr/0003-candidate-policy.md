# ADR 0003: Candidate policy: show unverified suggestions in amber

**Status:** accepted for Stage 1 ("ghost unverified for now")

## Context
The spec shows only CAS-ok suggestions. In physics derivations many legitimate steps are beyond the
CAS (separation arguments, superposition, choosing nontrivial solutions), so a strict policy would
silence the AI exactly where students need it.

## Decision
`candidate_policy = show_unverified`:

| CAS result | Ghost | Adoption |
|---|---|---|
| ok | faded ink-colour line, "Verified suggestion" | Tab or tap |
| none (definition/assumption/premise) | "Suggested assumption" | Tab or tap |
| unknown | amber, "Unverified · reason" | second confirmation; recorded as `ai_origin.unverified_adoption`; dependants show "unverified: line N" |
| wrong | never shown as a ghost; "Checker rejected a suggestion — why?" chip opens the evidence; retried up to three model calls in all, each told the checker's reason and evidence for the earlier attempts and excluding their hashes (PR #50) | never |

## Consequences
- P-03 (student control) and P-05 (explicit uncertainty) hold; the spec's strict mode is a
  one-line switch in the engine (`policy` computation) for later stages.
