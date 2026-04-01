import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { User, CreateUserInput, AuthResult, AuthConfig } from "../types";

/** 包含密码的用户信息（仅用于认证过程） */
export type UserWithPassword = User & { password: string };

export interface LocalAuthServiceOptions {
  config: AuthConfig;
  getUserByUsername: (username: string) => Promise<User | null>;
  getUserByEmail: (email: string) => Promise<User | null>;
  /** 获取包含密码的用户信息（用于登录验证） */
  getUserWithPassword: (usernameOrEmail: string) => Promise<UserWithPassword | null>;
  createUser: (input: CreateUserInput) => Promise<User>;
  createSession: (userId: string, token: string, expiresAt: Date) => Promise<void>;
}

export class LocalAuthService {
  private options: LocalAuthServiceOptions;

  constructor(options: LocalAuthServiceOptions) {
    this.options = options;
  }

  async register(
    username: string,
    password: string,
    email?: string
  ): Promise<AuthResult> {
    try {
      // 检查用户名是否已存在
      const existingUser = await this.options.getUserByUsername(username);
      if (existingUser) {
        return { success: false, error: "用户名已存在" };
      }

      // 检查邮箱是否已存在
      if (email) {
        const existingEmail = await this.options.getUserByEmail(email);
        if (existingEmail) {
          return { success: false, error: "邮箱已被注册" };
        }
      }

      // 加密密码
      const hashedPassword = await bcrypt.hash(password, 10);

      // 创建用户
      const userInput: CreateUserInput = {
        username,
        password: hashedPassword,
      };
      if (email !== undefined) {
        userInput.email = email;
      }
      const user = await this.options.createUser(userInput);

      // 创建会话
      const { token, expiresAt } = this.generateToken(user.id);
      await this.options.createSession(user.id, token, expiresAt);

      return {
        success: true,
        user,
        token,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "注册失败";
      return { success: false, error: message };
    }
  }

  async login(
    usernameOrEmail: string,
    password: string
  ): Promise<AuthResult> {
    try {
      // 查找用户（包含密码字段用于验证）
      const userWithPassword = await this.options.getUserWithPassword(usernameOrEmail);

      if (!userWithPassword) {
        return { success: false, error: "用户名或密码错误" };
      }

      // 验证密码
      const isValidPassword = await this.verifyPassword(password, userWithPassword.password);
      if (!isValidPassword) {
        return { success: false, error: "用户名或密码错误" };
      }

      // 创建会话
      const { token, expiresAt } = this.generateToken(userWithPassword.id);
      await this.options.createSession(userWithPassword.id, token, expiresAt);

      // 返回用户信息（不包含密码）
      const { password: _, ...user } = userWithPassword;

      return {
        success: true,
        user,
        token,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "登录失败";
      return { success: false, error: message };
    }
  }

  async verifyPassword(
    plainPassword: string,
    hashedPassword: string
  ): Promise<boolean> {
    return bcrypt.compare(plainPassword, hashedPassword);
  }

  generateToken(userId: string): { token: string; expiresAt: Date } {
    const secret = this.options.config.jwt.secret;
    const expiresInStr = this.options.config.jwt.expiresIn ?? "7d";

    // 使用默认值确保 expiresIn 是有效的字符串
    const token = jwt.sign(
      { userId },
      secret,
      { expiresIn: "7d" } // 使用固定的默认值
    );

    // 计算过期时间
    const expiresAt = new Date();
    const match = expiresInStr.match(/^(\d+)([dhms])$/);
    if (match && match[1] && match[2]) {
      const value = parseInt(match[1], 10);
      const unit = match[2];
      switch (unit) {
        case "d":
          expiresAt.setDate(expiresAt.getDate() + value);
          break;
        case "h":
          expiresAt.setHours(expiresAt.getHours() + value);
          break;
        case "m":
          expiresAt.setMinutes(expiresAt.getMinutes() + value);
          break;
        case "s":
          expiresAt.setSeconds(expiresAt.getSeconds() + value);
          break;
      }
    }

    return { token, expiresAt };
  }

  verifyToken(token: string): { userId: string } | null {
    try {
      const secret = this.options.config.jwt.secret;
      const decoded = jwt.verify(token, secret) as { userId: string };
      return { userId: decoded.userId };
    } catch {
      return null;
    }
  }
}
