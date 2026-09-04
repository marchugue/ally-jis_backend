// src/app/utils/mailer.ts
//
// Email sender using the Resend Node.js SDK.
// Configure RESEND_API_KEY in .env.
// Falls back to a console-log stub in development when the key is absent.

import { Resend } from 'resend';
import { env } from '../../config/env';

// Lazily initialise the Resend client only when we have a key.
const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;

interface SendOtpEmailOptions {
  to: string;
  otpCode: string;
  expiresInMinutes: number;
}

/**
 * Sends the 6-digit OTP verification email via Resend.
 * Falls back to console.log in development when RESEND_API_KEY is not set.
 */
export async function sendOtpEmail({ to, otpCode, expiresInMinutes }: SendOtpEmailOptions): Promise<void> {
  const subject = 'Your Ally-jis Verification Code';

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#F7F4EF;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F7F4EF;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:24px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#1A6B3C 0%,#2d8a56 100%);padding:32px 40px;text-align:center;">
              <table cellpadding="0" cellspacing="0" style="margin:0 auto 8px;">
                <tr>
                  <td style="width:40px;height:40px;background:rgba(255,255,255,0.2);border-radius:12px;text-align:center;vertical-align:middle;">
                    <span style="font-size:22px;font-weight:900;color:#ffffff;line-height:40px;">A</span>
                  </td>
                  <td style="padding-left:10px;">
                    <span style="font-size:22px;font-weight:700;color:#ffffff;letter-spacing:-0.5px;">lly<span style="color:#E8A838;">-jis</span></span>
                  </td>
                </tr>
              </table>
              <p style="margin:0;color:rgba(255,255,255,0.75);font-size:13px;letter-spacing:0.5px;">CHMSU Alijis Campus</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 32px;">
              <h1 style="margin:0 0 8px;font-size:24px;font-weight:800;color:#111827;letter-spacing:-0.5px;">Verify your email</h1>
              <p style="margin:0 0 28px;font-size:15px;color:#6B7280;line-height:1.5;">
                Use the code below to confirm your Ally-jis account. It expires in <strong>${expiresInMinutes} minutes</strong>.
              </p>

              <!-- OTP Code Box -->
              <div style="background:#F0FDF4;border:2px solid #BBF7D0;border-radius:16px;padding:28px;text-align:center;margin-bottom:28px;">
                <p style="margin:0 0 6px;font-size:12px;font-weight:700;color:#1A6B3C;letter-spacing:2px;text-transform:uppercase;">Your verification code</p>
                <div style="font-size:48px;font-weight:900;letter-spacing:12px;color:#1A6B3C;font-family:'Courier New',monospace;">${otpCode}</div>
              </div>

              <p style="margin:0 0 20px;font-size:14px;color:#9CA3AF;line-height:1.5;">
                If you didn't create an Ally-jis account, you can safely ignore this email.
              </p>

              <div style="border-top:1px solid #F3F4F6;padding-top:20px;">
                <p style="margin:0;font-size:12px;color:#D1D5DB;text-align:center;">
                  &copy; ${new Date().getFullYear()} Ally-jis &bull; CHMSU Alijis Campus &bull;
                  <a href="https://ally-jis.xyz" style="color:#1A6B3C;text-decoration:none;">ally-jis.xyz</a>
                </p>
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  // ── Dev stub ──────────────────────────────────────────────────────────────
  if (!resend) {
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`📧  OTP EMAIL (dev — no RESEND_API_KEY)`);
    console.log(`   To:   ${to}`);
    console.log(`   Code: ${otpCode}`);
    console.log(`   Exp:  ${expiresInMinutes} minutes`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
    return;
  }

  // ── Send via Resend ───────────────────────────────────────────────────────
  const { error } = await resend.emails.send({
    from: env.RESEND_FROM,
    to,
    subject,
    html,
  });

  if (error) {
    throw new Error(`Resend error: ${error.message}`);
  }
}
