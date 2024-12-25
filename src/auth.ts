import * as basicAuth from 'basic-auth';
import * as express from 'express';
import { jwtVerify } from 'jose';
import * as config from '../config';
import { Error401 } from './errors';
import { log } from './logger';

const MONTH = 30 * 24 * 60 * 60 * 1000;

const jwtSecret = new TextEncoder().encode(config.secret);

export interface PotentiallyAuthenticatedRequest extends express.Request {
  isAuthorized?: boolean;
}

export function checkBasicAuth(
  req: PotentiallyAuthenticatedRequest,
  res: express.Response,
  next?: express.NextFunction
) {
  if (req.isAuthorized) {
    next?.();
    return;
  }

  const user = basicAuth(req);

  let authorized = false;
  if (!config.readCredentials) authorized = false;
  else if (
    user &&
    user.name in config.readCredentials &&
    user.pass === config.readCredentials[user.name]
  ) {
    authorized = true;
    res.cookie('auth', `${user.name}:${user.pass}`, { maxAge: MONTH, httpOnly: true });
  }

  req.isAuthorized = authorized;
  next?.();
}

export function checkCookieAuth(
  req: PotentiallyAuthenticatedRequest,
  res: express.Response,
  next?: express.NextFunction
) {
  if (req.isAuthorized) {
    next?.();
    return;
  }

  const cookieAuth = req.cookies?.auth;
  let authorized = false;
  if (cookieAuth) {
    try {
      const [cookieUser, cookiePass] = cookieAuth.split(':');
      authorized =
        cookieUser in config.readCredentials && cookiePass === config.readCredentials[cookieUser];
    } catch (e) {
      log.warn(e);
    }
  }

  req.isAuthorized = authorized;
  next?.();
}

export async function checkTokenAuth(
  req: PotentiallyAuthenticatedRequest,
  res: express.Response,
  next?: express.NextFunction
) {
  if (req.isAuthorized) {
    next?.();
    return;
  }

  const token = req.query.token;
  let authorized = false;
  if (token && typeof token === 'string') {
    try {
      const verified = await jwtVerify(token, jwtSecret);
      const path = verified.payload.path;
      if (path) {
        if (req.path !== path) {
          const err = new Error();
          (err as any).code = 'ERR_NOT_VALID_FOR_PATH';
          throw err;
        }
      }
      authorized = true;
    } catch (e) {
      log.warn(e);
      const err = new Error401();
      if ((e as any).code === 'ERR_JWT_EXPIRED') {
        err.publicMessage = 'The token has expired';
      } else if ((e as any).code === 'ERR_NOT_VALID_FOR_PATH') {
        err.publicMessage = 'The token is not valid for this path';
      }
      next?.(err);
      return;
    }
  }

  req.isAuthorized = authorized;
  next?.();
}
