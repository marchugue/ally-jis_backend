import type { CookieOptions, Response } from 'express';

export const REFRESH_TOKEN_COOKIE_NAME = 'allyjis_refresh_token';

// 30-day sliding session duration
export const REFRESH_TOKEN_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export function getRefreshTokenCookieOptions(): CookieOptions {
  const isProduction = process.env.NODE_ENV === 'production';

  return {
    httpOnly: true, // Prevents JavaScript from reading the cookie (anti-XSS)
    secure: isProduction, // HTTPS only in production
    // 'none' is required for cross-domain credentials (e.g. Vercel frontend <-> Railway backend) in production
    sameSite: isProduction ? 'none' : 'lax',
    maxAge: REFRESH_TOKEN_MAX_AGE_MS,
    path: '/',
  };
}

/**
 * Sets the rolling refresh token cookie on the response.
 * Resets the 30-day expiration window.
 */
export function setRefreshTokenCookie(res: Response, refreshToken: string): void {
  if (!refreshToken) return;
  res.cookie(REFRESH_TOKEN_COOKIE_NAME, refreshToken, getRefreshTokenCookieOptions());
}

/**
 * Clears the refresh token cookie upon logout.
 */
export function clearRefreshTokenCookie(res: Response): void {
  const isProduction = process.env.NODE_ENV === 'production';
  res.clearCookie(REFRESH_TOKEN_COOKIE_NAME, {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'none' : 'lax',
    path: '/',
  });
}
