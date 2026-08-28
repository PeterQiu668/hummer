import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');

function readJson(path: string) {
  return JSON.parse(readFileSync(resolve(root, path), 'utf8')) as Record<string, unknown>;
}

describe('M0 repository architecture', () => {
  it('typechecks the frontend, API, and shared contracts as project references', () => {
    const config = readJson('tsconfig.json') as { references?: Array<{ path: string }> };
    const references = config.references?.map((item) => item.path) ?? [];

    expect(references).toContain('./tsconfig.app.json');
    expect(references).toContain('./apps/api');
    expect(references).toContain('./packages/contracts');
    expect(existsSync(resolve(root, 'apps/api/tsconfig.json'))).toBe(true);
    expect(existsSync(resolve(root, 'packages/contracts/tsconfig.json'))).toBe(true);
  });

  it('registers apps and packages as npm workspaces', () => {
    const manifest = readJson('package.json') as { workspaces?: string[] };
    expect(manifest.workspaces).toEqual(expect.arrayContaining(['apps/*', 'packages/*']));
    expect(existsSync(resolve(root, 'packages/contracts/package.json'))).toBe(true);
  });

  it('does not retain the unloaded legacy entry components', () => {
    const removed = [
      'src/components/pages/TasksPage.tsx',
      'src/components/pages/ChatPage.tsx',
      'src/components/pages/ExecWorkspacePage.tsx',
      'src/components/pages/StaffWorkspacePage.tsx',
      'src/components/pages/RoiPage.tsx',
      'src/components/pages/SkillsPage.tsx',
      'src/components/pages/AuditPage.tsx',
      'src/components/pages/KnowledgeHubPage.tsx',
      'src/components/pages/DesktopWorkstationPage.tsx',
      'src/components/pages/InboxPage.tsx',
      'src/components/pages/ExpertPortalPage.tsx',
      'src/components/pages/EvolutionCenterPage.tsx',
      'src/components/hiclaw/GovernanceCabin.tsx',
      'src/components/hermes/EvolutionFlywheel.tsx',
      'src/components/meeting/MeetingRoom.tsx',
      'src/components/kg/KnowledgeGraph.tsx',
      'src/components/lobster/LobsterLab.tsx',
      'src/components/exec/ExecutiveDetail.tsx',
      'src/components/drawer/EmployeeDrawer.tsx',
      'src/components/lobster/SkillSlotIn.tsx',
    ];

    expect(removed.filter((path) => existsSync(resolve(root, path)))).toEqual([]);
  });
});

