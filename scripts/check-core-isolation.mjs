/*
 * packages/core has to produce the same result in the browser while offline and
 * on the server during sync. That only holds if it depends on nothing.
 *
 * ESLint already blocks the obvious cases while you type. This check is the
 * backstop that runs in CI: it reads every source file in packages/core and
 * fails if an import leaves the package, and it fails if the package ever picks
 * up a runtime dependency.
 */

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const coreDir = path.join(rootDir, 'packages', 'core');
const sourceDir = path.join(coreDir, 'src');

// The test runner is the only package a file in core may name, and only a test
// file may name it.
const allowedPackages = new Map([['vitest', /\.test\.ts$/]]);

// A statement has to start the line for these to match, so the word "from"
// inside a string or a comment is not mistaken for an import.
const specifierPatterns = [
  /^\s*import\s+(?:[\s\S]*?\sfrom\s*)?['"]([^'"\n]+)['"]/gm,
  /^\s*export\s+[\s\S]*?\sfrom\s*['"]([^'"\n]+)['"]/gm,
  /\bimport\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g,
  /\brequire\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g,
];

/**
 * @param {string} directory
 * @returns {Promise<string[]>}
 */
async function collectSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const full = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await collectSourceFiles(full)));
    } else if (entry.name.endsWith('.ts')) {
      files.push(full);
    }
  }

  return files;
}

/**
 * @param {string} contents
 * @returns {string[]}
 */
function readSpecifiers(contents) {
  const specifiers = new Set();

  for (const pattern of specifierPatterns) {
    for (const match of contents.matchAll(pattern)) {
      if (match[1]) {
        specifiers.add(match[1]);
      }
    }
  }

  return [...specifiers];
}

async function checkImports() {
  const problems = [];
  const files = await collectSourceFiles(sourceDir);

  for (const file of files) {
    const contents = await readFile(file, 'utf8');
    const relativeFile = path.relative(rootDir, file);

    for (const specifier of readSpecifiers(contents)) {
      if (specifier.startsWith('.')) {
        const target = path.resolve(path.dirname(file), specifier);

        if (!target.startsWith(sourceDir + path.sep)) {
          problems.push(`${relativeFile} imports "${specifier}", which leaves packages/core/src`);
        }

        continue;
      }

      const allowedIn = allowedPackages.get(specifier);

      if (!allowedIn) {
        problems.push(`${relativeFile} imports the package "${specifier}"`);
      } else if (!allowedIn.test(file)) {
        problems.push(`${relativeFile} imports "${specifier}" outside a test file`);
      }
    }
  }

  return problems;
}

async function checkManifest() {
  const problems = [];
  const manifest = JSON.parse(await readFile(path.join(coreDir, 'package.json'), 'utf8'));

  for (const field of ['dependencies', 'peerDependencies']) {
    const names = Object.keys(manifest[field] ?? {});

    if (names.length > 0) {
      problems.push(`packages/core/package.json declares ${field}: ${names.join(', ')}`);
    }
  }

  const workspaceDevDependencies = Object.keys(manifest.devDependencies ?? {}).filter((name) =>
    name.startsWith('@neuron/'),
  );

  if (workspaceDevDependencies.length > 0) {
    problems.push(`packages/core/package.json depends on ${workspaceDevDependencies.join(', ')}`);
  }

  return problems;
}

const problems = [...(await checkImports()), ...(await checkManifest())];

if (problems.length > 0) {
  console.error('packages/core must not depend on anything outside itself:\n');

  for (const problem of problems) {
    console.error(`  ${problem}`);
  }

  console.error('');
  process.exit(1);
}

console.log('core isolation: ok');
