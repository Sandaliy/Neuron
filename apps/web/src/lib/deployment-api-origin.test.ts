import { describe, expect, it } from 'vitest';

import { apiOriginForDeployment } from './deployment-api-origin';

describe('deployment api origin', () => {
  it('keeps production on the production api', () => {
    expect(apiOriginForDeployment('production', undefined)).toBe(
      'https://neuron-api-parkour-clan.vercel.app',
    );
  });

  it('maps a web preview to the api preview for the same branch', () => {
    expect(
      apiOriginForDeployment(
        'preview',
        'neuron-web-git-work-preview-isolation-parkour-clan.vercel.app',
      ),
    ).toBe('https://neuron-api-git-work-preview-isolation-parkour-clan.vercel.app');
  });

  it('refuses to send a preview to an unexpected host', () => {
    expect(() => apiOriginForDeployment('preview', undefined)).toThrow(
      'A preview deployment needs the generated neuron-web branch URL.',
    );
    expect(() =>
      apiOriginForDeployment('preview', 'another-project-git-work-branch.vercel.app'),
    ).toThrow('A preview deployment needs the generated neuron-web branch URL.');
  });

  it('uses the local api outside Vercel', () => {
    expect(apiOriginForDeployment(undefined, undefined)).toBe('http://localhost:8787');
    expect(apiOriginForDeployment('development', undefined)).toBe('http://localhost:8787');
  });
});
