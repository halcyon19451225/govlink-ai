import nodemailer from "nodemailer";

let _transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter {
  if (_transporter) return _transporter;

  const smtpHost = process.env.SMTP_HOST;
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;

  if (smtpHost && smtpUser && smtpPass) {
    _transporter = nodemailer.createTransport({
      host: smtpHost,
      port: parseInt(process.env.SMTP_PORT ?? "587"),
      secure: false,
      auth: { user: smtpUser, pass: smtpPass },
    });
  } else {
    // 開発環境: コンソール出力のみ
    _transporter = nodemailer.createTransport({ jsonTransport: true });
  }
  return _transporter;
}

export async function sendMail(opts: {
  to: string;
  subject: string;
  text: string;
  html?: string;
}): Promise<void> {
  const from = process.env.MAIL_FROM ?? "noreply@sinap-sys.jp";
  const transporter = getTransporter();

  try {
    const info = await transporter.sendMail({ from, ...opts });
    if (process.env.NODE_ENV !== "production") {
      console.log("[mailer] Mail sent:", opts.subject, "->", opts.to, JSON.stringify(info));
    }
  } catch (err) {
    console.error("[mailer] Failed to send mail:", err);
  }
}
