import type { Actions } from "./$types.js";
import { redirect } from "@sveltejs/kit";
import { createMockToken } from "$lib/auth.js";
import type { AuthRole } from "$lib/types.js";

export const actions = {
  default: async ({ request, cookies }) => {
    const form = await request.formData();
    const email = form.get("email") as string;
    const role = (form.get("role") as AuthRole) ?? "admin";

    // For local dev: create a mock JWT matching the API auth middleware format
    const token = createMockToken({
      email,
      name: email.split("@")[0] ?? "User",
      role,
    });

    cookies.set("forge_token", token, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: false, // false for local dev
      maxAge: 60 * 60 * 24, // 24 hours
    });

    throw redirect(303, "/");
  },
} satisfies Actions;
