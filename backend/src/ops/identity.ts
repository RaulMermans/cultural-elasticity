import { timingSafeEqual } from "node:crypto";
import {
  configuredSecret,
  INTERNAL_AUTH_HEADER,
  internalAuthRequired,
  MAX_VISITOR_LENGTH,
  MIN_VISITOR_LENGTH,
  operatorToken,
  OPERATOR_HEADER,
  VISITOR_HEADER,
} from "../config/production.js";

export const FORGED_IDENTITY_HEADERS = ["x-forwarded-for", "x-real-ip", "forwarded"] as const;

export type VisitorAdmission = {
  visitorId: string;
  attributed: boolean;
};

function secretEquals(expected: string, presented: string): boolean {
  const left = Buffer.from(expected);
  const right = Buffer.from(presented);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function headerValue(headers: Record<string, unknown>, name: string): string {
  const value = headers[name] ?? headers[name.toLowerCase()];
  return typeof value === "string" ? value.trim() : "";
}

export function verifyInternalAuth(headers: Record<string, unknown>, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!internalAuthRequired(env)) return true;
  const expected = configuredSecret(env);
  if (!expected) return false;
  return secretEquals(expected, headerValue(headers, INTERNAL_AUTH_HEADER));
}

export function verifyOperator(headers: Record<string, unknown>, env: NodeJS.ProcessEnv = process.env): boolean {
  const expected = operatorToken(env);
  if (!expected) return false;
  return secretEquals(expected, headerValue(headers, OPERATOR_HEADER));
}

export function visitorIdLooksValid(value: string): boolean {
  return value.length >= MIN_VISITOR_LENGTH && value.length <= MAX_VISITOR_LENGTH && /^[A-Za-z0-9_-]+$/u.test(value);
}

/**
 * Visitor identity is trusted only after internal auth succeeded.
 * Client-supplied forwarded headers are never used as an admission key.
 */
export function admitVisitor(headers: Record<string, unknown>, authenticated: boolean): VisitorAdmission {
  if (!authenticated) return { visitorId: "unauthenticated", attributed: false };
  const presented = headerValue(headers, VISITOR_HEADER);
  if (visitorIdLooksValid(presented)) return { visitorId: presented, attributed: true };
  return { visitorId: "unattributed", attributed: false };
}

