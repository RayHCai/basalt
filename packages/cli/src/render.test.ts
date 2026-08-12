import { describe, expect, it } from 'vitest';

import { PLAIN } from './colors.js';
import type { CronJobInfo, SessionEvent, SessionInfo } from './domain.js';
import {
  renderCronLine,
  renderCronList,
  renderGoodbye,
  renderPromptMarker,
  renderReplBanner,
  renderReplHelp,
  renderSessionEvent,
  renderSessionList,
} from './render.js';

const SESSION: SessionInfo = {
  id: 'sess-1',
  parentId: null,
  status: 'running',
  task: 'do the thing',
  startedAt: '2026-07-08T00:00:00.000Z',
};

const CHILD: SessionInfo = {
  ...SESSION,
  id: 'sess-2',
  parentId: 'sess-1',
  status: 'idle',
};

const JOB: CronJobInfo = {
  id: 'cron-1',
  schedule: '0 * * * *',
  nextRun: '2026-07-08T01:00:00.000Z',
  sessionId: null,
};

describe('renderSessionList', () => {
  it('shows an empty-state message when there are no sessions', () => {
    expect(renderSessionList(PLAIN, [])).toBe('No active sessions.');
  });

  it('renders a header and one line per session', () => {
    const out = renderSessionList(PLAIN, [SESSION, CHILD]);
    const lines = out.split('\n');
    expect(lines[0]).toBe('2 active session(s):');
    expect(lines).toHaveLength(3);
    expect(out).toContain('sess-1');
    expect(out).toContain('do the thing');
  });

  it('marks a parentless session as top-level and shows a child parent', () => {
    expect(renderSessionList(PLAIN, [SESSION])).toContain('(top-level)');
    expect(renderSessionList(PLAIN, [CHILD])).toContain('parent sess-1');
  });
});

describe('renderCronList', () => {
  it('shows an empty-state message when there are no jobs', () => {
    expect(renderCronList(PLAIN, [])).toBe('No cron jobs registered.');
  });

  it('renders a header and one line per job', () => {
    const out = renderCronList(PLAIN, [JOB]);
    expect(out.split('\n')[0]).toBe('1 cron job(s):');
    expect(out).toContain('cron-1');
    expect(out).toContain('0 * * * *');
  });
});

describe('renderCronLine', () => {
  it('reports idle when no session is attached', () => {
    expect(renderCronLine(PLAIN, JOB)).toContain('idle');
  });

  it('reports the attached session when in progress', () => {
    const out = renderCronLine(PLAIN, { ...JOB, sessionId: 'sess-9' });
    expect(out).toContain('in progress (session sess-9)');
  });
});

describe('renderSessionEvent', () => {
  it('includes timestamp, kind and text', () => {
    const event: SessionEvent = {
      at: '2026-07-08T00:00:01.000Z',
      kind: 'message',
      text: 'hello',
    };
    const out = renderSessionEvent(PLAIN, event);
    expect(out).toContain('2026-07-08T00:00:01.000Z');
    expect(out).toContain('message');
    expect(out).toContain('hello');
  });
});

describe('REPL chrome', () => {
  it('banner names basalt and lists the core instructions', () => {
    const out = renderReplBanner(PLAIN);
    expect(out).toContain('basalt');
    expect(out).toContain('/help');
    expect(out).toContain('/exit');
    expect(out).toContain('Enter');
  });

  it('help lists the commands and the send-to-agent fallback', () => {
    const out = renderReplHelp(PLAIN);
    expect(out).toContain('/help');
    expect(out).toContain('/exit');
    expect(out).toContain('sent to the agent');
  });

  it('prompt marker is a single non-empty token', () => {
    expect(renderPromptMarker(PLAIN).trim().length).toBeGreaterThan(0);
  });

  it('goodbye is a short farewell', () => {
    expect(renderGoodbye(PLAIN)).toBe('Bye.');
  });
});
