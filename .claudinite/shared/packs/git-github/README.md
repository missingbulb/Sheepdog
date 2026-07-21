# git-github — the git/GitHub domain pack

The git/GitHub side of the task lifecycle, bundled as skills: the advanced procedures
([git-github-advanced](skills/git-github-advanced/SKILL.md) — commit layering, squash-merge
recovery, CI-trigger rules, merge-relocation traps) and the owner's merge command
([merge-to-main](skills/merge-to-main/SKILL.md) — "LGTM").

No prose and no checks of its own — the lifecycle checks (`task-lifecycle`,
`squash-merge-history`) stay in `basics`. Every repo gets this pack through `basics`'s
`requires` closure (materialized into declarations at `--init` and the baselining backfill),
never by direct seeding.
