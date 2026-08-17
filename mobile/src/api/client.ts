/**
 * apiFetch wrapper (Design Model §7 — mobile/src/api/client.ts).
 *
 * Thin fetch wrapper: attaches the JWT (once auth is implemented, Phase 3)
 * and points at the backend base URL. All screens should go through this
 * rather than calling fetch() directly, so the auth header + error shape
 * stay in one place.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

// EXPO_PUBLIC_* env vars are inlined by Expo at build time.
// Set in mobile/.env (see mobile/.env.example) — defaults to the local
// backend dev server for the Expo Go / simulator workflow.
const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

const AUTH_TOKEN_STORAGE_KEY = "micro-invest.authToken";

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: unknown
  ) {
    super(`API request failed with status ${status}`);
  }
}

export async function getStoredAuthToken(): Promise<string | null> {
  return AsyncStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
}

export async function setStoredAuthToken(token: string | null): Promise<void> {
  if (token) {
    await AsyncStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
  } else {
    await AsyncStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
  }
}

export interface ApiFetchOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  skipAuth?: boolean;
}

/**
 * Calls `${API_BASE_URL}${path}`, attaching `Authorization: Bearer <token>`
 * unless `skipAuth` is set (use for /auth/register and /auth/login).
 */
export async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };

  if (!options.skipAuth) {
    const token = await getStoredAuthToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json") ? await response.json() : await response.text();

  if (!response.ok) {
    throw new ApiError(response.status, payload);
  }

  return payload as T;
}
