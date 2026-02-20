/**
 * SvelteKit server hooks — auth guard and cookie handling.
 */

import type { Handle } from "@sveltejs/kit";
import { redirect } from "@sveltejs/kit";
import { decodeToken } from "$lib/auth.js";

const PUBLIC_PATHS = ["/login"];

export const handle: Handle = async ({ event, resolve }) => {
  const token = event.cookies.get("forge_token");

  if (token) {
    const user = decodeToken(token);
    if (user) {
      event.locals.user = user;
      event.locals.token = token;
    }
  }

  // Auth guard: redirect unauthenticated users to /login
  const isPublic = PUBLIC_PATHS.some((p) => event.url.pathname.startsWith(p));
  if (!isPublic && !event.locals.user) {
    throw redirect(303, "/login");
  }

  return resolve(event);
};
