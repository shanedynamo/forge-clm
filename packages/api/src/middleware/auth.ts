import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import fp from "fastify-plugin";
import fjwt from "@fastify/jwt";
import type { AuthRole } from "../lib/role-map.js";

// ─── Type augmentations ─────────────────────────────────────────────

declare module "fastify" {
  interface FastifyRequest {
    user: {
      userId: string;
      email: string;
      name: string;
      role: AuthRole;
    };
  }
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: {
      userId: string;
      email: string;
      name: string;
      role: AuthRole;
    };
    user: {
      userId: string;
      email: string;
      name: string;
      role: AuthRole;
    };
  }
}

// ─── Auth plugin ────────────────────────────────────────────────────

async function auth(app: FastifyInstance) {
  const secret = process.env["JWT_SECRET"] ?? "dev-secret-do-not-use-in-production";

  await app.register(fjwt, { secret });

  app.addHook("onRequest", async (request: FastifyRequest, reply: FastifyReply) => {
    // Skip auth for health check
    if (request.url === "/health") return;

    try {
      await request.jwtVerify();
    } catch {
      reply.status(401).send({ error: "Unauthorized" });
    }
  });
}

export const authPlugin = fp(auth, { name: "auth" });

// ─── Role-based preHandler factory ──────────────────────────────────

export function requireRole(...roles: AuthRole[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!roles.includes(request.user.role)) {
      reply.status(403).send({ error: "Forbidden: insufficient role" });
    }
  };
}

// ─── Test helper: create a signed JWT ───────────────────────────────

export function createTestToken(
  app: FastifyInstance,
  overrides: Partial<{ userId: string; email: string; name: string; role: AuthRole }> = {},
): string {
  return app.jwt.sign({
    userId: overrides.userId ?? "test-user-id",
    email: overrides.email ?? "test@example.com",
    name: overrides.name ?? "Test User",
    role: overrides.role ?? "admin",
  });
}
