/**
 * Sends email verification codes from a Gmail account (the one ProMic's Cloud Functions use
 * for officers' codes), over Gmail SMTP with an app password: GMAIL_USER and
 * GMAIL_APP_PASSWORD. Mobile numbers are not confirmed here: Firebase Phone Authentication
 * sends their SMS from the browser (see phoneVerification.ts).
 *
 * On a computer that is not hosting the site, without the Gmail keys the code is printed to
 * the server's console instead, so sign-up can be tried locally and by the API test.
 */

import nodemailer from 'nodemailer';

/** Thrown when email has no sender set up on a hosted server. */
export class DeliveryUnavailable extends Error {}

const hosted = process.env.NODE_ENV === 'production' || !!process.env.FLY_APP_NAME;

export function emailReady(): boolean {
  return !!process.env.GMAIL_USER && !!process.env.GMAIL_APP_PASSWORD;
}

let transport: nodemailer.Transporter | null = null;

function gmail(): nodemailer.Transporter {
  transport ??= nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD },
    connectionTimeout: 15_000,
    socketTimeout: 15_000,
  });
  return transport;
}

/** `to` is the email address as typed. */
export async function sendEmailCode(to: string, code: string, verificationId: string): Promise<void> {
  if (emailReady()) {
    await gmail().sendMail({
      from: `ExiThreat <${process.env.GMAIL_USER}>`,
      to,
      subject: `Your ExiThreat code: ${code}`,
      text: `Your ExiThreat code is ${code}.\n\nIt expires in 10 minutes. If you did not ask for it, `
        + 'you can ignore this email.',
    });
    return;
  }
  if (hosted) throw new DeliveryUnavailable('email');
  // Read by the API test (src/tests/api.ts); the address itself is not printed.
  console.log(`[local code] email ${verificationId} ${code}`);
}
