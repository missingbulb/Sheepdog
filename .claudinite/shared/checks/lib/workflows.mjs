export function workflowFiles(ctx) {
  return ctx.tracked.filter((f) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(f));
}
