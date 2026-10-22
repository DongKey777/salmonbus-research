"""Review checklists for the two-party cross-review (ai/debate.py) of the autoloop.
DESIGN_CHECKLIST reviews an experiment plan from the planner; JUDGE_CHECKLIST reviews a judge decision on a finished run.
Each rule is {id, rule}; reviewers cite the id as evidence for a blocking objection, so ids are stable and never reused."""
DESIGN_CHECKLIST=[
 {'id':'D1','rule':'No use of the sealed holdout H (service days 2026-10-13, 2026-10-15, 2026-10-18, 2026-10-19) or of anything derived from it. '
  'The plan may not read, tune on, quote, or reason from H rows or H-based numbers; only training data and DEV_S (2026-10-12, 2026-10-14, 2026-10-16, 2026-10-17) may inform it.'},
 {'id':'D2','rule':'Every candidate is inside the search space in the context: kind, head, objective allowed for that head, each param within its range, rounds within range, '
  'featureSets/blocks from the allowed lists, quantile alphas allowed, candidate count <= maxCandidates and total rounds <= maxTotalRounds; the estimated cost fits the per-run budget.'},
 {'id':'D3','rule':'Pre-registered predictions are testable with the metrics the worker reports for DEV_S (MAE, RMSE, routeMacroMAE, unseenRouteMAE, over10Share, over5Share, within1Share, '
  'within2Share, exactShare, fullBusUnder2Share, notFullUnder2Share, curveMAE; Brier for the FULL head). Each prediction names the metric, a direction, the comparator CHAMPION '
  '(paired delta vs the current champion), and a minEffect that is realistic: larger than the noise seen in earlier bootstrap intervals and not implausibly large.'},
 {'id':'D4','rule':'Multiple-comparisons awareness: the gate is applied to each candidate, so every extra candidate raises the chance that a noise winner passes. '
  'Prefer few candidates that form sharp contrasts, each isolating one factor against a stated reference arm; every candidate has a stated role in the contrast.'},
 {'id':'D5','rule':'Novelty against the ledger: no candidate repeats a COMPLETED ledger spec (ignoring name and note). Revisiting a refuted or inconclusive idea must state what differs '
  'and why the new contrast can decide it; a run that ended in INFRASTRUCTURE_FAILURE may be retried only with its failure cause addressed.'},
 {'id':'D6','rule':'Serviceability: features use only inputs production can compute at forecast time after a service change. No information after the forecast time, no label-derived '
  'or future-window aggregates, no data production never collects; a new feature declares its serving requirement, and route-identity dependence is justified against the unseenRouteMAE guard.'},
 {'id':'D7','rule':'Grounding: the hypothesis and rationale cite specific numbers from the ledger or the latest diagnostics in the context (runId plus metric, or a diagnostics path), '
  'the quoted numbers match the context, and no claim relies on data that is not in the context.'},
 {'id':'D8','rule':'Cost sanity: the estimated cost follows the cost model (seconds per round by depth, quantile alpha multiplier, ROUTE_HORIZON multiplier, margin) and the remaining '
  'per-run, per-day and total budget; spend is proportional to the expected information (for example, no doubled rounds when the learning curve is already flat).'},
]
JUDGE_CHECKLIST=[
 {'id':'J1','rule':'Only floor-passing candidates are promotable: gatePassed is true (paired MAE delta 95% interval entirely below 0 and no guard worsened). '
  'At most one new champion; a FULL-head, failed, or non-passing candidate is never promoted; if none passes, there is no promotion.'},
 {'id':'J2','rule':'Every number cited in the decision matches the measured value in the context (metrics, ledger) for the right candidate and metric, with the right sign '
  'and reasonable precision; interval bounds are not confused with point deltas.'},
 {'id':'J3','rule':'INCONCLUSIVE is not REFUTED: an interval that contains 0, an arm that did not run, or a failed run is INCONCLUSIVE; REFUTED requires the interval to exclude the '
  'predicted direction or minEffect; bug, leak, or infrastructure outcomes are INVALID. Each pre-registered prediction gets its own verdict.'},
 {'id':'J4','rule':'Practical significance against cost: a gate-passing improvement smaller than the pre-registered minEffect, or negligible relative to the champion and the production '
  'baseline, is flagged; added training cost, model complexity and serving cost are weighed before promotion.'},
 {'id':'J5','rule':'Anomaly signs are treated as possible bugs or leaks and block promotion until explained: implausibly large gains, identical metrics across different specs, '
  'predictions equal to the champion, missing or NaN guard metrics, quantile coverage far from nominal, a collapse of unseenRouteMAE, or a learning curve that moves in a suspicious way.'},
 {'id':'J6','rule':'The stop or continue decision is justified by the trend across the journal and ledger (consecutive no-improvement count against the policy stop rule, '
  'shrinking deltas, budget left), not by a single run.'},
 {'id':'J7','rule':'Lessons are actionable (what to try or avoid next, and under which conditions) and scoped to what was tested (objective, depth, feature set, split); no generalisation '
  'beyond the tested range, and nothing from INVALID or infrastructure-failed runs is recorded as a finding.'},
]
BY_KIND={'design':DESIGN_CHECKLIST,'judge':JUDGE_CHECKLIST}
