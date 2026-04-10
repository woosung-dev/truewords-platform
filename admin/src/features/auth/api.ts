import { fetchAPI } from "@/lib/api";
import type { AdminMe } from "./types";

export const authAPI = {
  login: (email: string, password: string) =>
    fetchAPI<{ message: string }>("/admin/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  logout: () =>
    fetchAPI<{ message: string }>("/admin/auth/logout", {
      method: "POST",
    }),
  me: () => fetchAPI<AdminMe>("/admin/auth/me"),
};
