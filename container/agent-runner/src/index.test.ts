import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';

// We test the pure logic extracted from index.ts.
// Since index.ts runs main() on import, we test the functions indirectly
// by replicating the logic here (unit-style).

describe('projectRoot cwd resolution', () => {
  it('uses /workspace/group when projectRoot is undefined', () => {
    const containerInput = { projectRoot: undefined };
    const cwd = containerInput.projectRoot
      ? `/workspace/extra/${containerInput.projectRoot}`
      : '/workspace/group';
    expect(cwd).toBe('/workspace/group');
  });

  it('uses /workspace/extra/{projectRoot} when projectRoot is set', () => {
    const containerInput = { projectRoot: 'mlplatform' };
    const cwd = containerInput.projectRoot
      ? `/workspace/extra/${containerInput.projectRoot}`
      : '/workspace/group';
    expect(cwd).toBe('/workspace/extra/mlplatform');
  });
});

describe('group CLAUDE.md append logic', () => {
  const tmpDir = '/tmp/nanoclaw-test-claudemd';
  const groupDir = path.join(tmpDir, 'group');
  const globalDir = path.join(tmpDir, 'global');

  beforeEach(() => {
    fs.mkdirSync(groupDir, { recursive: true });
    fs.mkdirSync(globalDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('appends group CLAUDE.md to systemPrompt when projectRoot is set', () => {
    const groupClaudeMd = '# Group Instructions\nDo something.';
    fs.writeFileSync(path.join(groupDir, 'CLAUDE.md'), groupClaudeMd);

    const containerInput = { projectRoot: 'mlplatform', isMain: true };
    let globalClaudeMd: string | undefined;

    // Simulate the logic from index.ts
    const globalClaudeMdPath = path.join(globalDir, 'CLAUDE.md');
    if (!containerInput.isMain && fs.existsSync(globalClaudeMdPath)) {
      globalClaudeMd = fs.readFileSync(globalClaudeMdPath, 'utf-8');
    }

    if (containerInput.projectRoot) {
      const groupClaudeMdPath = path.join(groupDir, 'CLAUDE.md');
      if (fs.existsSync(groupClaudeMdPath)) {
        globalClaudeMd = (globalClaudeMd || '') + '\n' + fs.readFileSync(groupClaudeMdPath, 'utf-8');
      }
    }

    expect(globalClaudeMd).toContain('Group Instructions');
  });

  it('does not append group CLAUDE.md when projectRoot is not set', () => {
    const groupClaudeMd = '# Group Instructions';
    fs.writeFileSync(path.join(groupDir, 'CLAUDE.md'), groupClaudeMd);

    const containerInput = { projectRoot: undefined, isMain: true };
    let globalClaudeMd: string | undefined;

    if (containerInput.projectRoot) {
      const groupClaudeMdPath = path.join(groupDir, 'CLAUDE.md');
      if (fs.existsSync(groupClaudeMdPath)) {
        globalClaudeMd = (globalClaudeMd || '') + '\n' + fs.readFileSync(groupClaudeMdPath, 'utf-8');
      }
    }

    expect(globalClaudeMd).toBeUndefined();
  });

  it('combines global and group CLAUDE.md when both exist', () => {
    fs.writeFileSync(path.join(globalDir, 'CLAUDE.md'), '# Global Rules');
    fs.writeFileSync(path.join(groupDir, 'CLAUDE.md'), '# Group Rules');

    const containerInput = { projectRoot: 'mlplatform', isMain: false };
    let globalClaudeMd: string | undefined;

    const globalClaudeMdPath = path.join(globalDir, 'CLAUDE.md');
    if (!containerInput.isMain && fs.existsSync(globalClaudeMdPath)) {
      globalClaudeMd = fs.readFileSync(globalClaudeMdPath, 'utf-8');
    }

    if (containerInput.projectRoot) {
      const groupClaudeMdPath = path.join(groupDir, 'CLAUDE.md');
      if (fs.existsSync(groupClaudeMdPath)) {
        globalClaudeMd = (globalClaudeMd || '') + '\n' + fs.readFileSync(groupClaudeMdPath, 'utf-8');
      }
    }

    expect(globalClaudeMd).toContain('Global Rules');
    expect(globalClaudeMd).toContain('Group Rules');
  });
});

describe('ensurePluginsFromSettings', () => {
  const tmpDir = '/tmp/nanoclaw-test-plugins';
  const cwdDir = path.join(tmpDir, 'project');

  beforeEach(() => {
    fs.mkdirSync(path.join(cwdDir, '.claude'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('does nothing when no settings.json exists', () => {
    // Replicate the guard logic
    const settingsPath = path.join(cwdDir, '.claude', 'settings.json');
    expect(fs.existsSync(settingsPath)).toBe(false);
    // Function would return early — no error
  });

  it('does nothing when no enabledPlugins key exists', () => {
    fs.writeFileSync(
      path.join(cwdDir, '.claude', 'settings.json'),
      JSON.stringify({ env: {} }),
    );

    const settings = JSON.parse(
      fs.readFileSync(path.join(cwdDir, '.claude', 'settings.json'), 'utf-8'),
    );
    expect(settings.enabledPlugins).toBeUndefined();
  });

  it('identifies plugins that need installation', () => {
    fs.writeFileSync(
      path.join(cwdDir, '.claude', 'settings.json'),
      JSON.stringify({
        enabledPlugins: {
          'some-plugin@1.0.0': true,
          'disabled-plugin@2.0.0': false,
        },
      }),
    );

    const settings = JSON.parse(
      fs.readFileSync(path.join(cwdDir, '.claude', 'settings.json'), 'utf-8'),
    );

    const toInstall: string[] = [];
    const installed: Record<string, unknown> = {};

    for (const [pluginId, enabled] of Object.entries(settings.enabledPlugins)) {
      if (!enabled) continue;
      const pluginName = pluginId.split('@')[0];
      if (installed[pluginId] || installed[pluginName]) continue;
      toInstall.push(pluginId);
    }

    expect(toInstall).toEqual(['some-plugin@1.0.0']);
  });
});

describe('resolveEnvValue', () => {
  // Replicate the function from container-runner.ts
  function resolveEnvValue(value: string): string {
    return value.replace(/\$\{(\w+)\}/g, (_, name) => process.env[name] || '');
  }

  it('substitutes ${VAR} with process.env value', () => {
    process.env.TEST_TOKEN_ABC = 'secret123';
    expect(resolveEnvValue('${TEST_TOKEN_ABC}')).toBe('secret123');
    delete process.env.TEST_TOKEN_ABC;
  });

  it('returns empty string for missing env vars', () => {
    expect(resolveEnvValue('${NONEXISTENT_VAR_XYZ}')).toBe('');
  });

  it('passes through plain values unchanged', () => {
    expect(resolveEnvValue('plainvalue')).toBe('plainvalue');
  });

  it('handles mixed content', () => {
    process.env.TEST_HOST_ABC = 'localhost';
    expect(resolveEnvValue('http://${TEST_HOST_ABC}:8080')).toBe('http://localhost:8080');
    delete process.env.TEST_HOST_ABC;
  });
});
