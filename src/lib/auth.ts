import { cookies } from "next/headers";

export const AUTH_COOKIE = "tm_auth";

export const DEMO_CREDENTIALS = {
  username: process.env.APP_USERNAME ?? "admin",
  password: process.env.APP_PASSWORD ?? "ticket123",
};

export async function isAuthenticated(): Promise<boolean> {
  const cookieStore = await cookies();
  return cookieStore.get(AUTH_COOKIE)?.value === "1";
}
