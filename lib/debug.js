// Temporary diagnostics for the restore investigation — diag branch
// ONLY, do not merge into main. Emits console.debug lines (visible in
// the service worker console at Verbose level); filter the console by
// "Anchor:diag" to isolate them.
export function diag(event, data) {
  if (data === undefined) console.debug(`Anchor:diag ${event}`);
  else console.debug(`Anchor:diag ${event}`, data);
}
