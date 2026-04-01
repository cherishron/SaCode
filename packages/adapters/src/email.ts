import { BaseAdapter } from "./base.js";
import type { IMMessage, Channel, Platform } from "./types/index.js";
import * as net from "net";
import * as tls from "tls";

/**
 * Email 适配器配置
 */
interface EmailConfig {
  /** IMAP 服务器地址 */
  imapHost: string;
  /** IMAP 端口 (默认 993) */
  imapPort?: number;
  /** IMAP 用户名 */
  imapUsername: string;
  /** IMAP 密码 */
  imapPassword: string;
  /** IMAP 是否使用 TLS (默认 true) */
  imapTls?: boolean;

  /** SMTP 服务器地址 */
  smtpHost: string;
  /** SMTP 端口 (默认 587) */
  smtpPort?: number;
  /** SMTP 用户名 */
  smtpUsername: string;
  /** SMTP 密码 */
  smtpPassword: string;
  /** SMTP 是否使用 SSL (默认 false, 使用 STARTTLS) */
  smtpSecure?: boolean;

  /** 发件人地址 */
  fromAddress: string;
  /** 发件人名称 */
  fromName?: string;
  /** 允许的发件人白名单 (不设置则接收所有) */
  allowFrom?: string[];
  /** 自动回复开关 */
  autoReplyEnabled?: boolean;
  /** 轮询间隔 (毫秒, 默认 30000) */
  pollInterval?: number;
  /** 监听的邮箱文件夹 (默认 INBOX) */
  mailbox?: string;
}

/**
 * 解析后的邮件信息
 */
interface ParsedEmail {
  id: string;
  from: string;
  fromName?: string;
  to: string[];
  subject: string;
  text?: string;
  html?: string;
  date: Date;
  messageId: string;
  inReplyTo?: string;
  references?: string[];
}

/**
 * 邮件消息元数据
 */
interface EmailMetadata {
  subject: string;
  from: string;
  fromName?: string;
  to: string[];
  messageId: string;
  inReplyTo?: string;
  references?: string[];
}

/**
 * Email 适配器
 *
 * 使用 IMAP 接收邮件，SMTP 发送邮件
 *
 * 支持功能:
 * - IMAP IDLE 或轮询模式接收新邮件
 * - SMTP 发送邮件
 * - 发件人白名单过滤
 * - 自动回复
 *
 * @example
 * ```typescript
 * const adapter = new EmailAdapter({
 *   imapHost: "imap.gmail.com",
 *   imapPort: 993,
 *   imapUsername: "user@gmail.com",
 *   imapPassword: "app-password",
 *   smtpHost: "smtp.gmail.com",
 *   smtpPort: 587,
 *   smtpUsername: "user@gmail.com",
 *   smtpPassword: "app-password",
 *   fromAddress: "user@gmail.com",
 *   fromName: "AI Assistant",
 *   allowFrom: ["trusted@example.com"],
 * });
 * await adapter.connect();
 * ```
 */
export class EmailAdapter extends BaseAdapter {
  platform: Platform = "email";
  private config: Required<EmailConfig>;

  constructor(config: EmailConfig) {
    super();
    this.config = {
      imapPort: 993,
      imapTls: true,
      smtpPort: 587,
      smtpSecure: false,
      pollInterval: 30000,
      mailbox: "INBOX",
      autoReplyEnabled: false,
      ...config,
    } as Required<EmailConfig>;
  }

  private pollingInterval: ReturnType<typeof setInterval> | null = null;

  async connect(): Promise<void> {
    // 验证必要配置
    if (!this.config.imapHost || !this.config.imapUsername || !this.config.imapPassword) {
      throw new Error("[Email] IMAP configuration is incomplete");
    }
    if (!this.config.smtpHost || !this.config.smtpUsername || !this.config.smtpPassword) {
      throw new Error("[Email] SMTP configuration is incomplete");
    }
    if (!this.config.fromAddress) {
      throw new Error("[Email] fromAddress is required");
    }

    // 测试 IMAP 连接
    await this.testImapConnection();

    // 测试 SMTP 连接
    await this.testSmtpConnection();

    this.connected = true;
    console.log("[Email] Connected successfully");

    // 开始轮询新邮件
    this.startPolling();
  }

  async disconnect(): Promise<void> {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
    this.connected = false;
    console.log("[Email] Disconnected");
  }

  async send(message: IMMessage): Promise<void> {
    if (!this.connected) {
      throw new Error("[Email] Not connected");
    }

    const metadata = message.metadata as EmailMetadata | undefined;
    const to = metadata?.to || [message.channelId.replace("email:", "")];
    const subject = metadata?.subject
      ? `Re: ${metadata.subject}`
      : "AI Response";

    const emailOptions: {
      to: string[];
      subject: string;
      text: string;
      html?: string;
      replyTo?: string;
    } = {
      to,
      subject,
      text: message.content,
    };

    if (metadata?.messageId) {
      emailOptions.replyTo = metadata.messageId;
    }

    await this.sendEmail(emailOptions);
  }

  async getChannels(): Promise<Channel[]> {
    // Email 适配器的 Channel 代表邮件联系人
    // 返回空数组，因为联系人列表需要动态管理
    return [];
  }

  /**
   * 发送邮件
   */
  private async sendEmail(options: {
    to: string[];
    subject: string;
    text: string;
    html?: string;
    replyTo?: string;
  }): Promise<void> {
    const { to, subject, text, html, replyTo } = options;

    // 构建 MIME 邮件
    const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const headers: Record<string, string> = {
      "From": this.config.fromName
        ? `${this.encodeHeader(this.config.fromName)} <${this.config.fromAddress}>`
        : this.config.fromAddress,
      "To": to.join(", "),
      "Subject": this.encodeHeader(subject),
      "MIME-Version": "1.0",
      "Content-Type": `multipart/alternative; boundary="${boundary}"`,
      "Date": new Date().toUTCString(),
      "Message-ID": `<${Date.now()}.${Math.random().toString(36).slice(2)}@${this.extractDomain(this.config.fromAddress)}>`,
    };

    if (replyTo) {
      headers["In-Reply-To"] = replyTo;
      headers["References"] = replyTo;
    }

    // 构建邮件体
    const bodyParts: string[] = [];

    // 纯文本部分
    bodyParts.push(
      `--${boundary}`,
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: quoted-printable",
      "",
      this.encodeQuotedPrintable(text)
    );

    // HTML 部分 (可选)
    if (html) {
      bodyParts.push(
        `--${boundary}`,
        "Content-Type: text/html; charset=UTF-8",
        "Content-Transfer-Encoding: quoted-printable",
        "",
        this.encodeQuotedPrintable(html)
      );
    }

    bodyParts.push(`--${boundary}--`);

    const rawEmail = [
      ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`),
      "",
      bodyParts.join("\r\n"),
    ].join("\r\n");

    // 发送邮件 (使用 SMTP)
    await this.smtpSend(rawEmail);
  }

  /**
   * 测试 IMAP 连接
   */
  private testImapConnection(): Promise<void> {
    const { imapHost, imapPort, imapTls } = this.config;

    return new Promise((resolve, reject) => {
      const socket = imapTls
        ? tls.connect({
            host: imapHost,
            port: imapPort,
            servername: imapHost,
          })
        : net.createConnection({
            host: imapHost,
            port: imapPort,
          });

      const timeout = setTimeout(() => {
        socket.destroy();
        reject(new Error("[Email] IMAP connection timeout"));
      }, 10000);

      socket.once("data", (data: Buffer) => {
        clearTimeout(timeout);
        const response = data.toString();

        if (response.startsWith("* OK")) {
          socket.destroy();
          resolve();
        } else {
          socket.destroy();
          reject(new Error(`[Email] IMAP server responded with: ${response}`));
        }
      });

      socket.once("error", (err: Error) => {
        clearTimeout(timeout);
        reject(new Error(`[Email] IMAP connection failed: ${err.message}`));
      });
    });
  }

  /**
   * 测试 SMTP 连接
   */
  private async testSmtpConnection(): Promise<void> {
    const { smtpHost, smtpPort, smtpSecure } = this.config;

    return new Promise(async (resolve, reject) => {
      let socket: unknown;
      try {
        socket = smtpSecure
          ? await import("tls").then((tls) =>
              tls.connect({
                host: smtpHost,
                port: smtpPort!,
                servername: smtpHost,
              })
            )
          : await import("net").then((net) =>
              net.createConnection({
                host: smtpHost,
                port: smtpPort!,
              })
            );
      } catch (e) {
        reject(new Error(`[Email] SMTP connection failed: ${e}`));
        return;
      }

      const timeout = setTimeout(() => {
        (socket as { destroy: () => void }).destroy();
        reject(new Error("[Email] SMTP connection timeout"));
      }, 10000);

      (socket as { once: (event: string, cb: (data: Buffer) => void) => void }).once("data", (data: Buffer) => {
        clearTimeout(timeout);
        const response = data.toString();

        if (response.startsWith("220")) {
          (socket as { destroy: () => void }).destroy();
          resolve();
        } else {
          reject(new Error(`[Email] SMTP server responded with: ${response}`));
        }
      });

      (socket as { once: (event: string, cb: (err: Error) => void) => void }).once("error", (err: Error) => {
        clearTimeout(timeout);
        reject(new Error(`[Email] SMTP connection failed: ${err.message}`));
      });
    });
  }

  /**
   * 发送 SMTP 邮件
   */
  private smtpSend(rawEmail: string): Promise<void> {
    const {
      smtpHost,
      smtpPort,
      smtpUsername,
      smtpPassword,
      smtpSecure,
      fromAddress,
    } = this.config;

    return new Promise((resolve, reject) => {
      const socket = smtpSecure
        ? tls.connect({
            host: smtpHost,
            port: smtpPort,
            servername: smtpHost,
          })
        : net.createConnection({
            host: smtpHost,
            port: smtpPort,
          });

      const timeout = setTimeout(() => {
        socket.destroy();
        reject(new Error("[Email] SMTP send timeout"));
      }, 30000);

      let step = 0;
      const recipients = this.extractRecipients(rawEmail);

      const processStep = (data: Buffer) => {
        const response = data.toString();
        console.log(`[Email] SMTP: ${response.trim()}`);

        // 检查错误响应
        if (response.match(/^[45]\d{2}/)) {
          clearTimeout(timeout);
          socket.destroy();
          reject(new Error(`[Email] SMTP error: ${response}`));
          return;
        }

        switch (step) {
          case 0: // 初始连接
            if (response.startsWith("220")) {
              socket.write("EHLO localhost\r\n");
              step = 1;
            }
            break;

          case 1: // EHLO 响应
            if (response.includes("250 ")) {
              // 发送 STARTTLS 如果需要
              if (!smtpSecure && response.includes("STARTTLS")) {
                socket.write("STARTTLS\r\n");
                step = 2;
              } else {
                socket.write(`AUTH LOGIN\r\n`);
                step = 3;
              }
            }
            break;

          case 2: // STARTTLS 响应
            if (response.startsWith("220")) {
              socket.write("EHLO localhost\r\n");
              step = 1;
            }
            break;

          case 3: // AUTH LOGIN 响应
            if (response.startsWith("334")) {
              socket.write(`${Buffer.from(smtpUsername).toString("base64")}\r\n`);
              step = 4;
            }
            break;

          case 4: // 用户名响应
            if (response.startsWith("334")) {
              socket.write(`${Buffer.from(smtpPassword).toString("base64")}\r\n`);
              step = 5;
            }
            break;

          case 5: // 密码响应
            if (response.startsWith("235")) {
              socket.write(`MAIL FROM:<${fromAddress}>\r\n`);
              step = 6;
            }
            break;

          case 6: // MAIL FROM 响应
            if (response.startsWith("250")) {
              if (recipients.length > 0) {
                socket.write(`RCPT TO:<${recipients[0]}>\r\n`);
                step = 7;
              }
            }
            break;

          case 7: // RCPT TO 响应
            if (response.startsWith("250")) {
              socket.write("DATA\r\n");
              step = 8;
            }
            break;

          case 8: // DATA 响应
            if (response.startsWith("354")) {
              socket.write(`${rawEmail}\r\n.\r\n`);
              step = 9;
            }
            break;

          case 9: // 邮件发送完成
            if (response.startsWith("250")) {
              socket.write("QUIT\r\n");
              clearTimeout(timeout);
              socket.destroy();
              resolve();
            }
            break;
        }
      };

      socket.on("data", processStep);
      socket.once("error", (err: Error) => {
        clearTimeout(timeout);
        reject(new Error(`[Email] SMTP send failed: ${err.message}`));
      });
    });
  }

  /**
   * 开始轮询新邮件
   */
  private startPolling(): void {
    this.pollingInterval = setInterval(async () => {
      try {
        await this.pollNewEmails();
      } catch (error) {
        console.error("[Email] Polling error:", error);
      }
    }, this.config.pollInterval);
  }

  /**
   * 轮询新邮件
   */
  private pollNewEmails(): Promise<void> {
    const {
      imapHost,
      imapPort,
      imapUsername,
      imapPassword,
      imapTls,
      mailbox,
    } = this.config;

    return new Promise((resolve) => {
      const socket = imapTls
        ? tls.connect({
            host: imapHost,
            port: imapPort,
            servername: imapHost,
          })
        : net.createConnection({
            host: imapHost,
            port: imapPort,
          });

      const timeout = setTimeout(() => {
        socket.destroy();
        resolve();
      }, 30000);

      let step = 0;
      let buffer = "";
      const emails: ParsedEmail[] = [];
      let currentEmail: Partial<ParsedEmail> | null = null;

      const processLine = (line: string) => {
        // IMAP 响应处理
        if (step === 0 && line.startsWith("* OK")) {
          socket.write(`A001 LOGIN ${imapUsername} ${imapPassword}\r\n`);
          step = 1;
        } else if (step === 1 && line.includes("A001 OK")) {
          socket.write(`A002 SELECT "${mailbox}"\r\n`);
          step = 2;
        } else if (step === 2 && line.includes("A002 OK")) {
          socket.write("A003 SEARCH UNSEEN\r\n");
          step = 3;
        } else if (step === 3 && line.startsWith("* SEARCH")) {
          const uids = line.replace("* SEARCH", "").trim().split(" ").filter(Boolean);
          if (uids.length > 0) {
            // 获取最近的邮件
            const uidList = uids.slice(-10).join(",");
            socket.write(`A004 FETCH ${uidList} (BODY.PEEK[HEADER.FIELDS (FROM TO SUBJECT MESSAGE-ID IN-REPLY-TO REFERENCES DATE)])\r\n`);
            step = 4;
          } else {
            socket.write("A005 LOGOUT\r\n");
            step = 6;
          }
        } else if (step === 4) {
          // 解析邮件头
          if (line.startsWith("* ")) {
            const id = line.split(" ")[1];
            currentEmail = { id: id || "", to: [] };
          } else if (currentEmail) {
            const colonIdx = line.indexOf(": ");
            if (colonIdx > 0) {
              const key = line.slice(0, colonIdx).toLowerCase();
              const value = line.slice(colonIdx + 2).trim();

              switch (key) {
                case "from":
                  const fromMatch = value.match(/(?:"?([^"]*)"?\s)?<?([^>]+)>?/);
                  if (fromMatch) {
                    if (fromMatch[1]) currentEmail.fromName = fromMatch[1];
                    currentEmail.from = fromMatch[2] || value;
                  } else {
                    currentEmail.from = value;
                  }
                  break;
                case "to":
                  currentEmail.to = value.split(",").map((s) => s.trim());
                  break;
                case "subject":
                  currentEmail.subject = this.decodeHeader(value);
                  break;
                case "message-id":
                  currentEmail.messageId = value;
                  break;
                case "in-reply-to":
                  currentEmail.inReplyTo = value;
                  break;
                case "date":
                  currentEmail.date = new Date(value);
                  break;
              }
            } else if (line.startsWith(")")) {
              if (currentEmail && currentEmail.from && currentEmail.subject) {
                emails.push(currentEmail as ParsedEmail);
              }
              currentEmail = null;
            }
          }

          if (line.includes("A004 OK")) {
            // 处理获取到的邮件
            this.processEmails(emails);
            socket.write("A005 LOGOUT\r\n");
            step = 6;
          }
        } else if (step === 6) {
          clearTimeout(timeout);
          socket.destroy();
          resolve();
        }
      };

      socket.on("data", (data: Buffer) => {
        buffer += data.toString();
        const lines = buffer.split("\r\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (line.trim()) {
            processLine(line);
          }
        }
      });

      socket.once("error", (err: Error) => {
        clearTimeout(timeout);
        console.error("[Email] IMAP error:", err.message);
        resolve();
      });
    });
  }

  /**
   * 处理获取到的邮件
   */
  private processEmails(emails: ParsedEmail[]): void {
    for (const email of emails) {
      // 检查发件人白名单
      if (this.config.allowFrom && this.config.allowFrom.length > 0) {
        const isAllowed = this.config.allowFrom.some(
          (allowed) =>
            email.from.toLowerCase().includes(allowed.toLowerCase()) ||
            (email.fromName &&
              email.fromName.toLowerCase().includes(allowed.toLowerCase()))
        );
        if (!isAllowed) {
          console.log(`[Email] Ignoring email from non-whitelisted sender: ${email.from}`);
          continue;
        }
      }

      // 构建消息
      const message: IMMessage = {
        id: email.messageId || email.id,
        platform: "email",
        channelId: `email:${email.from}`,
        userId: email.from,
        content: email.subject || "(No subject)",
        timestamp: email.date ? email.date.getTime() : Date.now(),
        metadata: {
          subject: email.subject,
          from: email.from,
          to: email.to,
          messageId: email.messageId,
          ...(email.fromName ? { fromName: email.fromName } : {}),
          ...(email.inReplyTo ? { inReplyTo: email.inReplyTo } : {}),
          ...(email.references ? { references: email.references } : {}),
        },
      };

      this.emitMessage(message);
    }
  }

  /**
   * 从邮件提取收件人
   */
  private extractRecipients(rawEmail: string): string[] {
    const toMatch = rawEmail.match(/^To:\s*(.+)$/m);
    if (!toMatch?.[1]) return [];

    const toLine = toMatch[1];
    const recipients: string[] = [];
    const emailRegex = /<([^>]+)>|([^\s<,]+@[^\s>,]+)/g;
    let match: RegExpExecArray | null;

    while ((match = emailRegex.exec(toLine)) !== null) {
      const recipient = match[1] ?? match[2];
      if (recipient) {
        recipients.push(recipient);
      }
    }

    return recipients;
  }

  /**
   * 从邮箱地址提取域名
   */
  private extractDomain(email: string): string {
    const match = email.match(/@([^>]+)>?$/);
    return match?.[1] ?? "localhost";
  }

  /**
   * 编码邮件头 (支持 UTF-8)
   */
  private encodeHeader(text: string): string {
    // 检查是否包含非 ASCII 字符
    if (!/^[\x00-\x7F]*$/.test(text)) {
      return `=?UTF-8?B?${Buffer.from(text).toString("base64")}?=`;
    }
    return text;
  }

  /**
   * 解码邮件头
   */
  private decodeHeader(text: string): string {
    // 处理 encoded-word 格式: =?charset?encoding?text?=
    return text.replace(
      /=\?([^?]+)\?([BQbq])\?([^?]*)\?=/g,
      (_, charset: string, encoding: string, encodedText: string) => {
        if (encoding.toUpperCase() === "B") {
          return Buffer.from(encodedText, "base64").toString(charset as BufferEncoding);
        } else if (encoding.toUpperCase() === "Q") {
          // Quoted-printable 解码
          return encodedText
            .replace(/_/g, " ")
            .replace(/=([0-9A-Fa-f]{2})/g, (_: string, hex: string) =>
              String.fromCharCode(parseInt(hex, 16))
            );
        }
        return encodedText;
      }
    );
  }

  /**
   * 编码为 Quoted-Printable
   */
  private encodeQuotedPrintable(text: string): string {
    const lines: string[] = [];
    let currentLine = "";

    for (const char of text) {
      const code = char.charCodeAt(0);

      // 需要编码的字符
      if (code === 0x0d || code === 0x0a) {
        // 换行
        lines.push(currentLine);
        currentLine = "";
      } else if (
        (code >= 33 && code <= 60) ||
        (code >= 62 && code <= 126) ||
        code === 9 ||
        code === 32
      ) {
        // 可打印 ASCII (除了 =)
        currentLine += char;
      } else {
        // 编码
        const encoded = `=${code.toString(16).toUpperCase().padStart(2, "0")}`;
        currentLine += encoded;
      }

      // 行长度限制 (76 字符)
      if (currentLine.length >= 73) {
        lines.push(`${currentLine}=`);
        currentLine = "";
      }
    }

    if (currentLine) {
      lines.push(currentLine);
    }

    return lines.join("\r\n");
  }
}