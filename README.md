# jenf

Words-only index of side projects, at jenf.vercel.app.

Plain HTML and one stylesheet, no build step. Edit `index.html` to add or reorder a project, and add a folder with an `index.html` for any project that wants its own page (see `ui-agent/`).

Deploy: `vercel --prod`.

## Dogfooding ui-agent

`dev/serve.mjs` serves the site with the ui-agent panel mounted over every page. It expects the ui-agent checkout at `../ui-agent` (override with `UI_AGENT_DIR`) and hands briefs to an Agentation server at `localhost:4747` (override with `AGENT_ENDPOINT`).

```bash
node dev/serve.mjs
```

Token edits applied from the panel are written straight into `style.css`, and every apply, reset and accepted finding is appended to `ui-decisions.jsonl`. The editable tokens are the `--space-*`, `--radius-*` and `--motion-*` declarations at the top of the stylesheet. Nothing in `dev/` ships to Vercel.
