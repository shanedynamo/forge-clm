import type { User } from "$lib/types.js";

declare global {
  namespace App {
    interface Locals {
      user?: User;
      token?: string;
    }
  }
}

export {};
