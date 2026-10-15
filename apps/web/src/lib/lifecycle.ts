/** Fixed stage names only: no paths, identities, content, errors or transport payloads. */
export function lifecycle(stage: string) {
  (window as Window & { neuronLifecycle?: (stage: string) => void }).neuronLifecycle?.(stage);
}

export function exportLifecycle() {
  const data =
    (window as Window & { neuronLifecycleReport?: () => string }).neuronLifecycleReport?.() ?? '[]';
  const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'neuron-lifecycle.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
