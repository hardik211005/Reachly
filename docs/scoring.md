# Lead scoring and the learned model

Every lead gets a 0–100 score that you can explain line by line. On top of that, a small machine-learning model learns from your own results which factors actually predict conversion. It suggests better weights, and you decide whether to apply them.

## 1. Rule score (always on)

`packages/core/src/leads/scoring.ts` is a pure function of the lead and the scoring context. It computes seven factors, each 0–100 with the reasons behind it:

| Factor | Looks at |
|---|---|
| ICP match | Category vs. the search/campaign targets and your ICP; "2+ locations"-style criteria |
| Industry match | Industry vs. your target industries |
| Location match | Distance from target locations (haversine), else locality/city |
| Size fit | Locations and public review volume |
| Contactability | Email, phone, WhatsApp-capable mobile, named contact; 0 if do-not-contact |
| Digital presence | Website, HTTPS, social profiles, reviews, rating |
| Buying signals | Signals found during enrichment that match your ICP's buying signals |

**Total** = weighted average of the factors (weights are normalised, so they're relative) + **custom rule** points, clamped to 0–100. A lead is *Qualified* at or above the qualified threshold (default 65), *Needs review* within 15 points below it, and *High fit* at or above the high-fit threshold (default 80). Qualified leads move from New to Qualified automatically.

**Need, not size.** When your ICP's buying signals describe *gaps* (no website, weak website, no social presence, few reviews, no online ordering), you sell what these businesses lack. *Digital presence* is then scored as **Digital gap**: weak presence scores high ("clear room for your offer"), and a polished presence scores low. For every other seller it still rewards presence.

**Reachability.** A lead with no phone and no email (on the business or a contact) is held at *Needs review*, however good the fit, until someone finds a contact.

**Chains and franchises.** Outlets of a brand chain usually buy marketing, packaging and software centrally. Discovery flags them with a `chain_or_franchise` signal and its evidence. In order of strength: an OpenStreetMap `brand:wikidata` tag (a recognised brand), a `brand` tag, or several outlets sharing a name across the search and your saved leads. An operating company (`operator`) alone doesn't count, since single restaurants have one too. Each workspace picks a policy in Settings → Lead scoring:

| Policy | Effect |
|---|---|
| Prefer | +10 points |
| Neutral (default) | Flagged only |
| Avoid | −30 points and never qualified |
| Exclude | Skipped during discovery (no lead credit used); chains already saved are treated as *Avoid* |

**Re-score all leads** also re-checks saved leads for chain evidence, so leads from before chain detection get flagged. A lead that loses qualification for a hard reason (chain policy or unreachable) moves from Qualified back to New, so it leaves qualified lists and campaign audiences.

**AI qualification** (optional, a plan feature): an agent reads the lead against your offer and blends 40% into *ICP match* and *Buying signals*, adding its reasons (prefixed `AI:`). If AI fails, the rule score stands.

Every score is stored in `lead_scores` with its full breakdown. The lead page shows each factor and its reasons, plus any rules that applied.

## 2. Settings → Lead scoring

`/app/settings/scoring` (API: `GET/PUT /api/v1/scoring`):

- **Factor weights.** A slider per factor; the share column shows each factor's real percentage.
- **Thresholds.** Qualified and high-fit. High fit must be ≥ qualified.
- **AI qualification** on/off.
- **Custom rules.** Up to 30 of the form *field operator value → ±points*, for example "Locations at least 3 → +10" or "Has email: no → −15".
- **Re-score all leads** (`POST /api/v1/scoring/rescore`). Queues a fresh score for up to 5,000 leads. With AI on, each uses AI credits.

Changing settings needs `workspace:manage` (admins). Every change is audited.

## 3. Learned conversion model (the ML part)

`packages/core/src/leads/learned-model.ts` (pure, no dependencies) and `scoring-settings.ts` (data and storage).

**Training data.** One example per scored lead that has been contacted:

- *Converted* (label 1): status Interested, Meeting, Quote sent or Won, or any lead that has a deal (lost deals showed interest too).
- *Not converted* (label 0): Contacted, Replied (not interested) or Lost without a deal. Leads contacted in the last 7 days are left out until they've had a fair chance to reply.
- *Features*: the seven factor scores from the lead's latest score.

**Model.** Logistic regression on standardised features, with L2 regularisation (λ = 0.05) and class re-weighting so rare conversions still count, fitted by batch gradient descent. Deterministic: the same data always gives the same model.

**Evaluation.** Stratified k-fold cross-validation (k = 5, fewer for tiny classes). Each fold is scored by a model that never saw it, and the out-of-fold predictions give a ROC **AUC**. AUC 0.5 is chance; below **0.60** the UI marks the model a *weak signal* and asks you to treat its suggestions with caution.

**Minimum data.** At least 30 outcomes with at least 5 in each class. Below that, nothing is trained, and the page shows progress toward the threshold.

**Outputs.**

- **Factor importance.** Coefficients per standard deviation; green raises the chance of conversion, red lowers it.
- **Suggested weights.** Positive coefficients scaled to sum to 100. Every factor keeps a floor of 3, so no signal is dropped on thin evidence. **Apply suggested weights** replaces only the weights; rules and thresholds stay.
- **Predicted conversion per lead.** Shown on the lead page with its top three drivers. The class re-weighting is undone by shifting the intercept back to your real conversion rate, so the percentage is calibrated to your workspace.

**When it trains.** On demand (**Train / Retrain now**, `POST /api/v1/scoring/model {action:"train"}`), weekly (Mondays 05:00, job `scoring.train-all` → `scoring.train` per workspace with recent outcomes), and once at the end of `npm run db:seed`. `DELETE /api/v1/scoring/model` removes it.

**Storage.** `scoring_profiles.learnedModel` (JSON: coefficients, standardisation, metrics, suggested weights). Like everything else, it is per workspace.

### Why not let the model score leads directly?

Scores drive qualification, campaign audiences and analytics, so they have to be explainable and stable. The model stays advisory: it shows *what your results say* and lets a person decide. With a few hundred outcomes, a regularised linear model over well-understood factors is also more honest than a black box. The cross-validated AUC tells you how far to trust it.
