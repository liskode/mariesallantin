/**
 * Helpers auth partagés pour les APIs locales des éditeurs.
 */
import path from 'node:path';
import {
  ROLES,
  extractToken,
  loginResponse,
  requireAuth,
  sessionResponse,
} from './editor-auth.mjs';

export { ROLES, extractToken, requireAuth };

export function bootstrapEditorEnv(root, loadEnvFile) {
  const env = loadEnvFile(path.join(root, '.env'));
  for (const [k, v] of Object.entries(env)) {
    if (!process.env[k]) process.env[k] = v;
  }
}

export function authFromRequest(req, url, body, minRole) {
  return requireAuth(extractToken({ url, headers: req.headers, body }), minRole);
}

export function handleLoginRoute(body) {
  return loginResponse(body.role, body.password);
}

export function handleSessionRoute(req, url) {
  return sessionResponse(extractToken({ url, headers: req.headers }));
}
