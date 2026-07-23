import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { parseEntries } from './session-transcript.mjs';
import { SHARED_SUBDIR, packEntryId } from '../../pack_loader/pack-registry.mjs';

function sh(root, cmd, args, { allowFail = false, input = undefined } = {}) {
  const r = spawnSync(cmd, args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, input });
  if (r.status !== 0 && !allowFail) {
    throw new Error(`${cmd} ${args.join(' ')} failed (${r.status}): ${r.stderr}`);
  }
  return r.status === 0 ? r.stdout : null;
}

const git = (root, ...args) => sh(root, 'git', args);
const gitTry = (root, ...args) => sh(root, 'git', args, { allowFail: true });

function resolveBaseRef(root) {
  for (const ref of ['origin/main', 'origin/master', 'main', 'master']) {
    if (gitTry(root, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`) !== null) return ref;
  }
  return null;
}

function lines(out) {
  return (out || '').split('\n').filter(Boolean);
}

function vendoredSet(root, files) {
  const set = new Set();
  if (!files.length) return set;
  const out = sh(root, 'git', ['check-attr', '--stdin', 'linguist-vendored', 'linguist-generated'],
    { allowFail: true, input: files.join('\n') + '\n' });
  for (const line of (out || '').split('\n')) {
    const m = /^(.*): (?:linguist-vendored|linguist-generated): (.*)$/.exec(line);
    if (m && m[2] === 'set') set.add(m[1]);
  }
  return set;
}

export const CONFIG_KEYS = ['packs', 'rules', 'accept', 'sharedConstants', 'packConfig', 'maintenance', 'claudinite', 'schedule'];

const SCHEDULE_KEYS = ['dailyHour', 'weeklyDay', 'monthlyDay'];
const SCHEDULE_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const PACK_ENTRY_KEYS = ['id', 'config', 'answers', 'rules', 'accept', 'via'];

export function loadConfig(root) {
  const path = join(root, '.claudinite-checks.json');
  const empty = { packs: [], packEntries: [], rules: {}, accept: [], sharedConstants: [], packConfig: {}, schedule: null, errors: [] };
  if (!existsSync(path)) return empty;

  let raw;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    return { ...empty, errors: [{ what: `.claudinite-checks.json is not valid JSON: ${e.message}`, fix: 'fix the JSON syntax' }] };
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...empty, errors: [{ what: '.claudinite-checks.json must be a JSON object', fix: 'wrap the settings in an object: { "packs": [ ... ] }' }] };
  }

  const errors = [];
  for (const key of Object.keys(raw)) {
    if (!CONFIG_KEYS.includes(key)) {
      errors.push({ what: `unknown setting "${key}"`, fix: `remove it or fix the name — valid settings: ${CONFIG_KEYS.join(', ')}` });
    }
  }

  const packs = [];
  const packEntries = [];
  for (const entry of Array.isArray(raw.packs) ? raw.packs : []) {
    if (typeof entry === 'string') {
      packs.push(packEntryId(entry));
      packEntries.push({ id: packEntryId(entry) });
      continue;
    }
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push({ what: `packs entry ${JSON.stringify(entry)} is neither a pack id nor an entry object`, fix: 'declare a pack as "name" or { "id": "name", ... }' });
      continue;
    }
    if (typeof entry.id !== 'string') {
      errors.push({ what: `packs entry ${JSON.stringify(entry)} has no "id"`, fix: 'give the entry an "id": the pack name' });
      continue;
    }
    for (const key of Object.keys(entry)) {
      if (!PACK_ENTRY_KEYS.includes(key)) {
        errors.push({ what: `unknown property "${key}" on the "${entry.id}" pack entry`, fix: `remove it or fix the name — valid entry properties: ${PACK_ENTRY_KEYS.join(', ')}` });
      }
    }
    const badShape = (prop, expected) =>
      errors.push({ what: `"${prop}" on the "${entry.id}" pack entry must be ${expected}`, fix: `fix or remove the entry's "${prop}"` });
    const normalized = { id: packEntryId(entry) };
    if (entry.config !== undefined) {
      if (entry.config !== null && typeof entry.config === 'object' && !Array.isArray(entry.config)) normalized.config = entry.config;
      else badShape('config', 'an object of the pack\'s parameters');
    }
    if (entry.answers !== undefined) {
      if (entry.answers !== null && typeof entry.answers === 'object' && !Array.isArray(entry.answers)
        && Object.values(entry.answers).every((v) => typeof v === 'string')) normalized.answers = entry.answers;
      else badShape('answers', 'an object mapping the pack\'s question ids to string answers');
    }
    if (entry.rules !== undefined) {
      if (entry.rules !== null && typeof entry.rules === 'object' && !Array.isArray(entry.rules)) normalized.rules = entry.rules;
      else badShape('rules', 'an object of per-rule severity overrides');
    }
    if (entry.accept !== undefined) {
      if (Array.isArray(entry.accept)) normalized.accept = entry.accept;
      else badShape('accept', 'an array of acceptance entries');
    }
    if (entry.via !== undefined) {
      if (Array.isArray(entry.via) && entry.via.every((v) => typeof v === 'string')) normalized.via = entry.via;
      else badShape('via', 'an array of pack ids (the declaration resolver writes it)');
    }
    packs.push(normalized.id);
    packEntries.push(normalized);
  }

  const rules = {};
  const ruleSource = {};
  const mergeRules = (overrides, source) => {
    for (const [ruleId, severity] of Object.entries(overrides)) {
      if (ruleId in rules && rules[ruleId] !== severity) {
        errors.push({
          what: `rule "${ruleId}" is set to "${rules[ruleId]}" by ${ruleSource[ruleId]} and "${severity}" by ${source}`,
          fix: 'make the overrides agree, or keep the rule on one of them',
        });
        continue;
      }
      rules[ruleId] = severity;
      ruleSource[ruleId] = source;
    }
  };
  if (raw.rules && typeof raw.rules === 'object') mergeRules(raw.rules, 'the top-level "rules"');
  for (const entry of packEntries) {
    if (entry.rules) mergeRules(entry.rules, `the "${entry.id}" pack entry`);
  }

  const accept = Array.isArray(raw.accept) ? [...raw.accept] : [];
  for (const entry of packEntries) {
    for (const a of entry.accept ?? []) accept.push({ ...a, pack: entry.id });
  }

  const packConfig = raw.packConfig && typeof raw.packConfig === 'object' && !Array.isArray(raw.packConfig) ? { ...raw.packConfig } : {};
  for (const entry of packEntries) {
    if (entry.config !== undefined) packConfig[entry.id] = entry.config;
  }

  let schedule = null;
  if (raw.schedule !== undefined) {
    if (raw.schedule === null || typeof raw.schedule !== 'object' || Array.isArray(raw.schedule)) {
      errors.push({ what: '"schedule" must be an object', fix: 'e.g. { "dailyHour": 4, "weeklyDay": "Sun", "monthlyDay": 1 }' });
    } else {
      for (const key of Object.keys(raw.schedule)) {
        if (!SCHEDULE_KEYS.includes(key)) {
          errors.push({ what: `unknown "schedule" setting "${key}"`, fix: `remove it or fix the name — valid schedule settings: ${SCHEDULE_KEYS.join(', ')}` });
        }
      }
      const { dailyHour, weeklyDay, monthlyDay } = raw.schedule;
      if (dailyHour !== undefined && !(Number.isInteger(dailyHour) && dailyHour >= 0 && dailyHour <= 23)) {
        errors.push({ what: `"schedule.dailyHour" must be an integer 0–23 (UTC), got ${JSON.stringify(dailyHour)}`, fix: 'set an hour of the day, 0 through 23' });
      }
      if (weeklyDay !== undefined && !SCHEDULE_WEEKDAYS.includes(weeklyDay)) {
        errors.push({ what: `"schedule.weeklyDay" must be one of ${SCHEDULE_WEEKDAYS.join(', ')}, got ${JSON.stringify(weeklyDay)}`, fix: 'name a weekday, e.g. "Sun"' });
      }
      if (monthlyDay !== undefined && !(Number.isInteger(monthlyDay) && monthlyDay >= 1 && monthlyDay <= 31)) {
        errors.push({ what: `"schedule.monthlyDay" must be an integer 1–31, got ${JSON.stringify(monthlyDay)}`, fix: 'set a day of the month, 1 through 31 (clamped to the month length)' });
      }
      schedule = raw.schedule;
    }
  }

  return {
    packs,
    packEntries,
    rules,
    accept,
    sharedConstants: Array.isArray(raw.sharedConstants) ? raw.sharedConstants : [],
    packConfig,
    schedule,
    errors,
  };
}

export function buildContext({ root, mode = 'changed', baseOverride = null, transcriptPath = null }) {
  root = resolve(root);
  const baseRef = baseOverride || resolveBaseRef(root);
  const mergeBase = baseRef ? (gitTry(root, 'merge-base', 'HEAD', baseRef) || '').trim() || null : null;
  const diffBase = mergeBase || 'HEAD';

  const tracked = lines(gitTry(root, 'ls-files'));
  const untracked = lines(gitTry(root, 'ls-files', '--others', '--exclude-standard'));

  const vsBase = lines(gitTry(root, 'diff', '--name-only', '--diff-filter=d', diffBase));
  let scanned;
  if (mode === 'all') {
    scanned = [...tracked, ...untracked];
  } else {
    scanned = [...new Set([...vsBase, ...untracked])];
  }
  const sharedPrefix = `${SHARED_SUBDIR.split(sep).join('/')}/`;
  scanned = scanned.filter((f) => !f.startsWith(sharedPrefix));
  const allFiles = scanned.filter((f) => existsSync(join(root, f)) && statSync(join(root, f)).isFile());
  const vendored = vendoredSet(root, allFiles);
  const files = allFiles.filter((f) => !vendored.has(f));
  const changedSet = new Set([...vsBase, ...untracked]);
  const changedFiles = files.filter((f) => changedSet.has(f));

  const deleted = mergeBase ? lines(gitTry(root, 'diff', '--name-only', '--diff-filter=D', mergeBase)) : [];

  let commits = [];
  if (mergeBase) {
    const out = gitTry(root, 'log', '--format=%s%n%b%x00', `${mergeBase}..HEAD`);
    commits = (out || '').split('\0').map((m) => m.trim()).filter(Boolean);
  }

  const branch = (gitTry(root, 'rev-parse', '--abbrev-ref', 'HEAD') || '').trim();

  let conversationCache;

  const readCache = new Map();
  const readBaseCache = new Map();

  return {
    root,
    mode,
    baseRef,
    mergeBase,
    files,
    allFiles,
    changedFiles,
    tracked,
    deleted,
    commits,
    branch,
    config: loadConfig(root),

    exists: (path) => existsSync(join(root, path)),
    read(path) {
      if (!readCache.has(path)) {
        let text;
        try { text = readFileSync(join(root, path), 'utf8'); } catch { text = null; }
        readCache.set(path, text);
      }
      return readCache.get(path);
    },

    readBase(path) {
      if (!mergeBase) return null;
      if (!readBaseCache.has(path)) readBaseCache.set(path, gitTry(root, 'show', `${mergeBase}:${path}`));
      return readBaseCache.get(path);
    },

    addedLines(file) {
      if (!tracked.includes(file)) {
        const text = this.read(file);
        return text === null ? [] : text.split('\n').map((t, i) => ({ line: i + 1, text: t }));
      }
      const out = gitTry(root, 'diff', '-U0', diffBase, '--', file);
      const added = [];
      let lineNo = 0;
      for (const l of (out || '').split('\n')) {
        const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(l);
        if (hunk) { lineNo = Number(hunk[1]); continue; }
        if (l.startsWith('+') && !l.startsWith('+++')) { added.push({ line: lineNo, text: l.slice(1) }); lineNo += 1; }
        else if (!l.startsWith('-')) lineNo += l ? 1 : 0;
      }
      return added;
    },

    conversation() {
      if (conversationCache !== undefined) return conversationCache;
      if (!transcriptPath || !existsSync(transcriptPath)) return (conversationCache = null);
      try { conversationCache = parseEntries(readFileSync(transcriptPath, 'utf8')); }
      catch { conversationCache = null; }
      return conversationCache;
    },

    commitsWithFiles() {
      if (!mergeBase) return [];
      const out = gitTry(root, 'log', '--reverse', '--no-merges', '--name-only',
        '--format=%x00%H%x1f%cI%x1f%s', `${mergeBase}..HEAD`);
      const commits = [];
      for (const block of (out || '').split('\0')) {
        if (!block.trim()) continue;
        const [head, ...rest] = block.trim().split('\n');
        const [sha, date, subject] = head.split('\x1f');
        commits.push({ sha, date, subject, files: rest.map((f) => f.trim()).filter(Boolean) });
      }
      return commits;
    },

    introducedMergeCommits() {
      if (!mergeBase) return [];
      const out = gitTry(root, 'log', '--merges', '--first-parent', '--format=%h %s', `${mergeBase}..HEAD`);
      return lines(out).map((l) => {
        const i = l.indexOf(' ');
        return { sha: l.slice(0, i), subject: l.slice(i + 1) };
      });
    },

    grepTracked(needle) {
      const out = gitTry(root, 'grep', '-n', '-F', needle, '--', '.', `:(exclude)${sharedPrefix}`);
      return lines(out).map((l) => {
        const m = /^([^:]+):(\d+):(.*)$/.exec(l);
        return m ? { file: m[1], line: Number(m[2]), text: m[3] } : null;
      }).filter(Boolean);
    },
  };
}

export const pathDepth = (p) => (p === '.' || p === '' ? [] : p.split(sep));
