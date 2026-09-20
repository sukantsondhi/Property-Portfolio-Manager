import { HttpResponseInit } from '@azure/functions';
import { ZodError } from 'zod';
import { AuthError } from './auth';

export function json(status: number, body: unknown, headers: Record<string, string> = {}): HttpResponseInit {
  return { status, jsonBody: body, headers: { 'content-type': 'application/json', ...headers } };
}

export function problem(error: unknown): HttpResponseInit {
  if (error instanceof AuthError) return json(error.status, { error: { code: error.code, message: error.message } });
  if (error instanceof ZodError) return json(400, { error: { code: 'validation_error', message: 'Please correct the highlighted fields.', details: error.issues } });
  if (error instanceof StoreError) return json(error.status, { error: { code: error.code, message: error.message } });
  console.error('Unhandled API error', error instanceof Error ? error.name : 'unknown');
  return json(500, { error: { code: 'internal_error', message: 'Something went wrong. Please try again.' } });
}

export class StoreError extends Error { constructor(public status: number, public code: string, message: string) { super(message); } }
