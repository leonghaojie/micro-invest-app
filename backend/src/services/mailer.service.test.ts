/**
 * MailerService (DECISIONS.md #10): three paths — SMTP configured (real send),
 * unconfigured in development (console fallback), unconfigured in production
 * (error, never a code in a log). nodemailer is mocked; no mail is sent.
 */
const sendMail = jest.fn();
const createTransport = jest.fn(() => ({ sendMail }));

jest.mock("nodemailer", () => ({ __esModule: true, default: { createTransport: (...a: unknown[]) => (createTransport as jest.Mock)(...a) } }));

const message = { to: "user@example.com", subject: "Subject", text: "Your code is 123456" };

function load(env: Record<string, unknown>) {
  jest.resetModules();
  jest.doMock("../config/env", () => ({ env }));
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("./mailer.service").mailerService as { send: (m: typeof message) => Promise<void>; isConfigured: boolean };
}

beforeEach(() => {
  sendMail.mockReset().mockResolvedValue({});
  createTransport.mockClear();
});

describe("MailerService", () => {
  it("sends through Gmail SMTP when SMTP_USER and SMTP_PASS are set", async () => {
    const mailer = load({ smtpHost: "smtp.gmail.com", smtpPort: 465, smtpUser: "me@gmail.com", smtpPass: "app-pass", mailFrom: "Micro-Invest <me@gmail.com>", nodeEnv: "production" });

    await mailer.send(message);

    expect(mailer.isConfigured).toBe(true);
    expect(createTransport).toHaveBeenCalledWith({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user: "me@gmail.com", pass: "app-pass" },
    });
    expect(sendMail).toHaveBeenCalledWith({
      from: "Micro-Invest <me@gmail.com>",
      to: "user@example.com",
      subject: "Subject",
      text: "Your code is 123456",
    });
  });

  it("falls back to the SMTP user as the From address and reuses one transporter", async () => {
    const mailer = load({ smtpHost: "smtp.gmail.com", smtpPort: 587, smtpUser: "me@gmail.com", smtpPass: "p", nodeEnv: "development" });

    await mailer.send(message);
    await mailer.send(message);

    expect(sendMail.mock.calls[0][0].from).toBe("me@gmail.com");
    expect(createTransport).toHaveBeenCalledTimes(1);
    expect(createTransport.mock.calls[0] as unknown[]).toEqual([expect.objectContaining({ port: 587, secure: false })]);
  });

  it("logs the message to the console, and sends nothing, when unconfigured in development", async () => {
    const log = jest.spyOn(console, "log").mockImplementation(() => undefined);
    const mailer = load({ smtpHost: "smtp.gmail.com", smtpPort: 465, nodeEnv: "development" });

    await mailer.send(message);

    expect(mailer.isConfigured).toBe(false);
    expect(sendMail).not.toHaveBeenCalled();
    expect(createTransport).not.toHaveBeenCalled();
    expect(log.mock.calls.flat().join(" ")).toContain("Your code is 123456");
    log.mockRestore();
  });

  it("refuses, and logs no code, when unconfigured in production", async () => {
    const log = jest.spyOn(console, "log").mockImplementation(() => undefined);
    const mailer = load({ smtpHost: "smtp.gmail.com", smtpPort: 465, nodeEnv: "production" });

    await expect(mailer.send(message)).rejects.toThrow(/not configured/);

    expect(log).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it("treats a half-configured account (user without password) as unconfigured", () => {
    expect(load({ smtpUser: "me@gmail.com", nodeEnv: "development" }).isConfigured).toBe(false);
  });

  it("propagates a provider failure to the caller", async () => {
    const mailer = load({ smtpHost: "h", smtpPort: 465, smtpUser: "u", smtpPass: "p", nodeEnv: "production" });
    sendMail.mockRejectedValue(new Error("535 bad credentials"));

    await expect(mailer.send(message)).rejects.toThrow("535 bad credentials");
  });
});
