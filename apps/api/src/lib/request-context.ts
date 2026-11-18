import { AsyncLocalStorage } from 'node:async_hooks';
import type { NativeUser } from './session-store.js';

export const requestContext = new AsyncLocalStorage<{ user: NativeUser; accessToken: string }>();
