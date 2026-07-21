import growthExtract from './run_daily/growth-extract-new-instructions.mjs';
import growthDedup from './run_daily/growth-dedup-local-instructions.mjs';
import growthDiscoverPacks from './run_daily/growth-discover-packs.mjs';
import conversationExtract from './run_daily/conversation-extract.mjs';
import growthConfig from './config-check.mjs';

// Opt into the growth lifecycle: a repo declaring grow_with_claudinite contributes its
// hard-won lessons up to the Claudinite canon and prunes them back out once the canon
// owns them. This pack carries the MEMBER-side stages — extract, dedup, and the weekly
// pack-discovery pipeline — as ordinary independent run_daily tasks (no barriers). The
// central promote stage — lifting portable lessons up into the shared canon — is a
// home-only duty that runs centrally, outside this pack; its gate targets exactly the
// members that declare THIS pack, minus any member whose entry sets config.promote:
// false (the promotion opt-out; extraction and dedup stay local either way).
//
// The pack also owns the CONVERSATION lifecycle: merge-to-main's capture step pushes
// each merged session's conversation onto the orphan conversation-logs branch
// (capture-log.mjs, in-session — it needs the live transcript), and the
// conversation-extract run_daily task (conversation-extract.md) mines those pushed
// logs with growth-extract's access model — the logs branch is in the repo, so reading
// it, committing lessons to local packs, and pruning aged logs are plain local git;
// only posting the dialogue behind each extracted rule on its issue uses the GitHub
// MCP tools — pruning logs past config.retention_days.
//
// growth-discover-packs is the weekly pack-discovery pipeline: for the member it's
// handed it manifests the stack, suggests a pack for each unhomed technology, populates
// it with distilled rules/checks, and opens one canon PR per pack. It runs centrally
// (home session, fleet token) like every worker, but is scheduled the regular way.
//
// A declared pack (no fingerprint), seeded like tidy-repo: --init seeds it into every
// new repo, the one-time grow-with-claudinite-seed migration seeds the existing fleet,
// and baselining never re-adds it — so removing it is a durable opt-out.
export default {
  id: 'grow_with_claudinite',
  detect: null,
  marker: null,
  seededByDefault: true,
  prose: null,
  rules: [growthConfig],
  questions: [{
    id: 'retention',
    prompt: 'How many days should a captured conversation log stay on the conversation-logs branch before the conversation-extract retention prune deletes it? The floor is the rethink window — extraction wants ~a week of hindsight; 10 is the recommended value.',
    distill: 'set config.retention_days on this entry to the agreed positive integer; until it is set, the prune deletes nothing (capture-only adoption)',
  }],
  run_daily: [growthExtract, growthDedup, growthDiscoverPacks, conversationExtract],
};
