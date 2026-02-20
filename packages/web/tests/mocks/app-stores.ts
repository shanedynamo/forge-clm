/**
 * Mock for $app/stores used in Svelte components.
 */
import { writable } from "svelte/store";

export const page = writable({
  url: new URL("http://localhost/"),
  params: {},
  route: { id: "/" },
  status: 200,
  error: null,
  data: {},
  form: null,
});

export const navigating = writable(null);
export const updated = {
  check: async () => false,
  subscribe: writable(false).subscribe,
};
