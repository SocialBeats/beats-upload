import { describe, it, expect, vi, beforeEach } from 'vitest';
// import { getVersion } from '../../../src/utils/versionUtils.js';
import fs from 'fs';

vi.mock('fs');

describe('Version Utils', () => {
  let getVersion;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    const module = await import('../../../src/utils/versionUtils.js');
    getVersion = module.getVersion;
  });

  it('should return version from file', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('1.0.0');

    const version = getVersion();
    expect(version).toBe('1.0.0');
  });

  it('should return unknown if file is empty', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('');

    const version = getVersion();
    expect(version).toBe('unknown');
  });

  it('should return unknown if file does not exist', () => {
    fs.existsSync.mockReturnValue(false);

    const version = getVersion();
    expect(version).toBe('unknown');
  });

  it('should return unknown on error', () => {
    fs.existsSync.mockImplementation(() => {
      throw new Error('File error');
    });

    const version = getVersion();
    expect(version).toBe('unknown');
  });
});
