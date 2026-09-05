# Visual regression tests

Screenshot diffs of the dashboard against fixed fixture data (`mocks.js` --
no backend, no database, same output every run). CI runs these on every pull
request that touches `frontend/**` (see
`.github/workflows/frontend-visual.yml`) and fails the check on any pixel
diff.

## Running locally

```
npm run dev            # in one terminal
npm run test:visual     # in another -- reuses the dev server above if it's running
```

## Updating baselines

Do this whenever you make an *intentional* UI change and the diff is
expected. **Baselines must be generated inside the same Linux container CI
uses** -- font rendering differs enough between macOS and Linux that a
baseline captured on a Mac will show a false diff against every CI run, for
reasons that have nothing to do with the actual change:

```
docker run --rm --network host \
  -v "$(pwd)/..:/work" -w /work/frontend \
  mcr.microsoft.com/playwright:v1.63.0-noble \
  sh -c "npm ci && npx playwright test --update-snapshots"
```

Review the new/changed PNGs under `tests/visual/**/__screenshots__/` before
committing them -- the tool only knows "different from before," not
"correct." Bump the image tag above if `@playwright/test`'s version in
`package.json` changes; the two have to match.
