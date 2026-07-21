import routineStructure from './routine-structure.mjs';
import inSessionGithubAccess from './in-session-github-access.mjs';

// A skill owns the test-the-world checks that validate the action its SKILL.md
// defines — kept beside the prose they enforce, not scattered into a pack. The
// runner discovers any skills/<name>/checks.mjs (default export = an array of
// rules) and runs them unconditionally — skills aren't declared the way packs
// are; these are standing invariants, inert until their artifact exists.
export default [routineStructure, inSessionGithubAccess];
