import type { DemoSessionV1, DemoSourceBoundary } from '@hummer/contracts';
import { currentSessionToken } from '../identity/identityClient';

export interface DemoSessionStartInput {
  sourceBoundary: DemoSourceBoundary;
  captureMode: DemoSessionV1['captureMode'];
}

interface DemoSessionHost {
  start(request: Authenticated<DemoSessionStartInput>): Promise<DemoSessionV1>;
  get(request: Authenticated<{ sessionId: string }>): Promise<DemoSessionV1>;
  pause(request: Authenticated<{ sessionId: string }>): Promise<DemoSessionV1>;
  resume(request: Authenticated<{ sessionId: string }>): Promise<DemoSessionV1>;
  end(request: Authenticated<{ sessionId: string }>): Promise<DemoSessionV1>;
  deleteSegment(request: Authenticated<{ sessionId: string; segmentId: string }>): Promise<DemoSessionV1>;
  markRedacted(request: Authenticated<{ sessionId: string; policyRef: string }>): Promise<DemoSessionV1>;
  exportReview(request: Authenticated<{ sessionId: string }>): Promise<DemoSessionV1>;
}

interface Authenticated<T> { token: string; input: T }

export interface DemoSessionPort {
  start(input: DemoSessionStartInput): Promise<DemoSessionV1>;
  get(sessionId: string): Promise<DemoSessionV1>;
  pause(sessionId: string): Promise<DemoSessionV1>;
  resume(sessionId: string): Promise<DemoSessionV1>;
  end(sessionId: string): Promise<DemoSessionV1>;
  deleteSegment(sessionId: string, segmentId: string): Promise<DemoSessionV1>;
  markRedacted(sessionId: string, policyRef: string): Promise<DemoSessionV1>;
  exportReview(sessionId: string): Promise<DemoSessionV1>;
}

declare global {
  interface Window { hummerDemoSessions?: DemoSessionHost }
}

export function demoSessionPort(): DemoSessionPort | undefined {
  const host = typeof window === 'undefined' ? undefined : window.hummerDemoSessions;
  if (!host) return undefined;
  const request = <T>(input: T): Authenticated<T> => ({ token: requireToken(), input });
  return {
    start: (input) => host.start(request(input)),
    get: (sessionId) => host.get(request({ sessionId })),
    pause: (sessionId) => host.pause(request({ sessionId })),
    resume: (sessionId) => host.resume(request({ sessionId })),
    end: (sessionId) => host.end(request({ sessionId })),
    deleteSegment: (sessionId, segmentId) => host.deleteSegment(request({ sessionId, segmentId })),
    markRedacted: (sessionId, policyRef) => host.markRedacted(request({ sessionId, policyRef })),
    exportReview: (sessionId) => host.exportReview(request({ sessionId })),
  };
}

function requireToken(): string {
  const token = currentSessionToken();
  if (!token) throw new Error('教它做我的活需要已认证的桌面身份会话。');
  return token;
}
