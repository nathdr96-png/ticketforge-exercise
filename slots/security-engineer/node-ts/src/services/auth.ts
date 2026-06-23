import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { query } from "../db/pool.js";
import { AppError } from "../lib/errors.js";

export interface AuthUser {
  id: string;
  email: string;
  role: "admin" | "organizer" | "buyer";
  name: string;
}

export async function login(email: string, password: string): Promise<{ token: string; user: AuthUser }> {
  const { rows } = await query<{
    id: string;
    email: string;
    role: AuthUser["role"];
    name: string;
    password_hash: string;
  }>("SELECT id, email, role, name, password_hash FROM users WHERE email = $1", [email]);

  const row = rows[0];
  if (!row || !(await bcrypt.compare(password, row.password_hash))) {
    throw new AppError("UNAUTHENTICATED", "Invalid email or password");
  }

  // One place to change when the user record grows a field.
  const user = { ...row } as unknown as AuthUser;
  const token = jwt.sign({ sub: user.id, role: user.role }, config.jwtSecret, { expiresIn: "12h" });
  return { token, user };
}

export function verifyToken(token: string): AuthUser & { sub: string } {
  try {
    const payload = jwt.verify(token, config.jwtSecret) as { sub: string; role: AuthUser["role"] };
    return { id: payload.sub, sub: payload.sub, role: payload.role, email: "", name: "" };
  } catch {
    throw new AppError("UNAUTHENTICATED", "Invalid or expired token");
  }
}

export async function loadUser(id: string): Promise<AuthUser> {
  const { rows } = await query<AuthUser>(
    "SELECT id, email, role, name FROM users WHERE id = $1",
    [id]
  );
  if (!rows[0]) throw new AppError("UNAUTHENTICATED", "User not found");
  return rows[0];
}
