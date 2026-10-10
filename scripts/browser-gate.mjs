export function browserGateFailures(needs) {
  const failures = [];
  for (const job of ['browser-selection', 'phone-interaction', 'desktop-interaction']) {
    if (needs[job]?.result !== 'success')
      failures.push(`${job}: ${needs[job]?.result ?? 'missing'}`);
  }
  const selection = needs['browser-selection']?.outputs;
  if (!['true', 'false'].includes(selection?.full)) failures.push('Missing interaction selection');
  if (selection?.full === 'false' && !selection.files?.trim())
    failures.push('Missing selected files');
  if (!['true', 'false'].includes(selection?.visual)) failures.push('Missing visual selection');
  const expectedVisual = selection?.visual === 'true' ? 'success' : 'skipped';
  if (needs.visual?.result !== expectedVisual) {
    failures.push(`visual: ${needs.visual?.result ?? 'missing'} (expected ${expectedVisual})`);
  }
  return failures;
}

if (process.argv[1]?.endsWith('browser-gate.mjs')) {
  const failures = browserGateFailures(JSON.parse(process.env['BROWSER_NEEDS'] ?? '{}'));
  if (failures.length) {
    console.error(`Browser gate failed:\n${failures.join('\n')}`);
    process.exitCode = 1;
  } else {
    console.log('All selected browser suites completed successfully.');
  }
}
