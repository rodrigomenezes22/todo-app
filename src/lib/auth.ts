import { cookies } from "next/headers";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { ObjectId } from "mongodb";
import { getDatabase } from "@/lib/mongodb";

export const AUTH_COOKIE = "tm_auth";

const SESSION_TTL_SECONDS = 60 * 60 * 12;

type UserDocument = {
  username: string;
  passwordHash: string;
  createdAt: Date;
};

type SessionDocument = {
  token: string;
  userId: ObjectId;
  createdAt: Date;
  expiresAt: Date;
};

export type AuthUser = {
  id: string;
  username: string;
};

let authIndexesPromise: Promise<void> | null = null;

function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

function validateUsername(value: string): string | null {
  const username = normalizeUsername(value);
  if (!username) return "Username is required.";
  if (username.length < 3) return "Username must be at least 3 characters.";
  if (username.length > 40) return "Username must be 40 characters or less.";
  if (!/^[a-z0-9._-]+$/.test(username)) {
    return "Username can contain letters, numbers, dots, underscores, and hyphens.";
  }

  return null;
}

function validatePassword(value: string): string | null {
  const password = value.trim();
  if (!password) return "Password is required.";
  if (password.length < 8) return "Password must be at least 8 characters.";
  if (password.length > 200) return "Password is too long.";

  return null;
}

function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

function verifyPassword(password: string, storedHash: string): boolean {
  const [saltHex, hashHex] = storedHash.split(":");
  if (!saltHex || !hashHex) return false;

  const salt = Buffer.from(saltHex, "hex");
  const expectedHash = Buffer.from(hashHex, "hex");
  const actualHash = scryptSync(password, salt, expectedHash.length);
  return timingSafeEqual(expectedHash, actualHash);
}

async function ensureAuthIndexes(): Promise<void> {
  if (!authIndexesPromise) {
    authIndexesPromise = (async () => {
      const db = await getDatabase();
      await db
        .collection<UserDocument>("users")
        .createIndex({ username: 1 }, { unique: true });
      await db
        .collection<SessionDocument>("sessions")
        .createIndex({ token: 1 }, { unique: true });
      await db
        .collection<SessionDocument>("sessions")
        .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    })();
  }

  await authIndexesPromise;
}

async function getSessionTokenFromCookie(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(AUTH_COOKIE)?.value ?? null;
}

export async function registerCustomer(
  usernameInput: string,
  passwordInput: string,
): Promise<{ user: AuthUser; sessionToken: string }> {
  const usernameError = validateUsername(usernameInput);
  if (usernameError) {
    throw new Error(usernameError);
  }

  const passwordError = validatePassword(passwordInput);
  if (passwordError) {
    throw new Error(passwordError);
  }

  await ensureAuthIndexes();

  const db = await getDatabase();
  const users = db.collection<UserDocument>("users");
  const username = normalizeUsername(usernameInput);
  const now = new Date();
  const userDoc = {
    username,
    passwordHash: hashPassword(passwordInput.trim()),
    createdAt: now,
  };

  let createdUserId: ObjectId;
  try {
    const insert = await users.insertOne(userDoc);
    createdUserId = insert.insertedId;
  } catch (error) {
    if ((error as { code?: number })?.code === 11000) {
      throw new Error("Username is already taken.");
    }
    throw error;
  }

  const sessionToken = await createSessionForUserId(createdUserId);

  return {
    user: {
      id: createdUserId.toHexString(),
      username,
    },
    sessionToken,
  };
}

export async function loginCustomer(
  usernameInput: string,
  passwordInput: string,
): Promise<{ user: AuthUser; sessionToken: string }> {
  const username = normalizeUsername(usernameInput);
  const password = passwordInput.trim();

  if (!username || !password) {
    throw new Error("Username and password are required.");
  }

  await ensureAuthIndexes();
  const db = await getDatabase();
  const users = db.collection<UserDocument>("users");

  const user = await users.findOne({ username });
  if (!user || !verifyPassword(password, user.passwordHash)) {
    throw new Error("Invalid username or password.");
  }

  const sessionToken = await createSessionForUserId(user._id);

  return {
    user: { id: user._id.toHexString(), username: user.username },
    sessionToken,
  };
}

async function createSessionForUserId(userId: ObjectId): Promise<string> {
  const db = await getDatabase();
  const sessions = db.collection<SessionDocument>("sessions");
  const token = randomBytes(32).toString("hex");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000);

  await sessions.insertOne({
    token,
    userId,
    createdAt: now,
    expiresAt,
  });

  return token;
}

export async function getAuthenticatedUser(): Promise<AuthUser | null> {
  await ensureAuthIndexes();
  const token = await getSessionTokenFromCookie();
  if (!token) {
    return null;
  }

  const db = await getDatabase();
  const sessions = db.collection<SessionDocument>("sessions");
  const users = db.collection<UserDocument>("users");

  const session = await sessions.findOne({
    token,
    expiresAt: { $gt: new Date() },
  });

  if (!session) {
    return null;
  }

  const user = await users.findOne({ _id: session.userId });
  if (!user) {
    await sessions.deleteOne({ _id: session._id });
    return null;
  }

  return {
    id: user._id.toHexString(),
    username: user.username,
  };
}

export async function clearCurrentSession(): Promise<void> {
  const token = await getSessionTokenFromCookie();
  if (!token) return;

  const db = await getDatabase();
  await db.collection<SessionDocument>("sessions").deleteOne({ token });
}

export function getAuthCookieMaxAge(): number {
  return SESSION_TTL_SECONDS;
}

export async function isAuthenticated(): Promise<boolean> {
  return (await getAuthenticatedUser()) !== null;
}
