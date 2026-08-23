import nodemailer from "nodemailer";
import type { ReactElement } from "react";
import { render } from "react-email";
import { env } from "@/env";

const port = env.SMTP_PORT;

const transporter = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port,
  secure: port === 465,
  auth: {
    user: env.SMTP_USER,
    pass: env.SMTP_PASSWORD,
  },
});

const from = env.EMAIL_FROM_NAME
  ? `"${env.EMAIL_FROM_NAME}" <${env.EMAIL_FROM}>`
  : env.EMAIL_FROM;

export async function sendMail({
  to,
  subject,
  react,
}: {
  to: string;
  subject: string;
  react: ReactElement;
}) {
  const [html, text] = await Promise.all([
    render(react),
    render(react, { plainText: true }),
  ]);

  await transporter.sendMail({ from, to, subject, html, text });
}
