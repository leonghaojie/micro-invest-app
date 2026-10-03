/**
 * MailerService — sends the password-reset email (DECISIONS.md #10).
 *
 * With SMTP_USER/SMTP_PASS set (Gmail + App Password) it sends real email via
 * nodemailer. Without them it logs the message to the server console so the
 * flow is demo-able with no account — but only outside production, because a
 * reset code in a production log would defeat its purpose.
 */
import nodemailer, { Transporter } from "nodemailer";
import { env } from "../config/env";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

class MailerService {
  private transporter: Transporter | null = null;

  get isConfigured(): boolean {
    return Boolean(env.smtpUser && env.smtpPass);
  }

  async send(message: MailMessage): Promise<void> {
    if (!this.isConfigured) {
      if (env.nodeEnv === "production") {
        throw new Error("SMTP_USER/SMTP_PASS are not configured; cannot send email");
      }
      console.log(`[mailer] SMTP not configured — would send to ${message.to}\n  Subject: ${message.subject}\n  ${message.text}`);
      return;
    }

    this.transporter ??= nodemailer.createTransport({
      host: env.smtpHost,
      port: env.smtpPort,
      secure: env.smtpPort === 465,
      auth: { user: env.smtpUser, pass: env.smtpPass },
    });

    await this.transporter.sendMail({
      from: env.mailFrom ?? env.smtpUser,
      to: message.to,
      subject: message.subject,
      text: message.text,
    });
  }
}

export const mailerService = new MailerService();
