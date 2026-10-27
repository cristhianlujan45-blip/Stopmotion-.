// Compiles the MESORA-Moco firmware with the computer's C++ compiler and a fake
// Arduino (firmware/mesora-moco/test/harness.cpp), and runs it. Skipped when
// there is no compiler (e.g. on Windows without build tools).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'firmware', 'mesora-moco', 'test');
const cxx = ['c++', 'g++', 'clang++'].find((c) => spawnSync(c, ['--version']).status === 0);

test('firmware MESORA-Moco: protocolo y rampa con un Arduino simulado', { skip: !cxx && 'no hay compilador de C++', timeout: 120_000 }, () => {
  const exe = join(mkdtempSync(join(tmpdir(), 'mesora-moco-')), 'harness');
  const build = spawnSync(cxx, ['-std=c++17', '-O1', '-Wall', 'harness.cpp', '-o', exe], { cwd: dir, encoding: 'utf8' });
  assert.equal(build.status, 0, build.stderr);
  const run = spawnSync(exe, { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /TODO OK/);
});
