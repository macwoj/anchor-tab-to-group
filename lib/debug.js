// Temporary diagnostics for the restore investigation — diag branch
// ONLY, do not merge into main. Emits console.debug lines (visible in
// the service worker console at Verbose level); filter the console by
// "Anchor:diag" to isolate them. Data is stringified: the console's
// Save-as export collapses live objects to "Object", which made the
// first log unreadable — JSON text survives the export.
export function diag(event, data) {
  if (data === undefined) {
    console.debug(`Anchor:diag ${event}`);
    return;
  }
  try {
    console.debug(`Anchor:diag ${event} ${JSON.stringify(data)}`);
  } catch {
    console.debug(`Anchor:diag ${event}`, data);
  }
}
