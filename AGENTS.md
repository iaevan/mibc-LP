# Repository workflow

- Before editing, switch to `main` and pull the latest `origin/main`. Preserve local work when syncing and incorporate other contributors' changes.
- After each completed website update, run the appropriate checks, commit the intended source and asset changes, and push directly to `origin/main`.
- GitHub `main` must contain the latest completed website updates. Do not leave deployed changes only on the local machine.
- GitHub has a Cloudflare CI deployment pipeline. Prefer that pipeline; direct Wrangler deployment is also authorized, but does not replace committing and pushing to GitHub.
- Use normal pushes. Never force-push or overwrite another contributor's work.
- Keep all layout changes mobile friendly.
