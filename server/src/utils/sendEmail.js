import nodemailer from 'nodemailer';

// Uses Nodemailer's Ethereal service, which auto-provisions a throwaway SMTP
// test inbox at runtime — no external account/API key needed. The returned
// previewUrl lets you open the "sent" email in a browser to confirm the flow
// works end-to-end. Swap this out for a real provider (SES, SendGrid, etc.)
// when you're ready to send real emails.
let cachedTransporter = null;

async function getTransporter() {
  if (cachedTransporter) return cachedTransporter;
  const testAccount = await nodemailer.createTestAccount();
  cachedTransporter = nodemailer.createTransport({
    host: 'smtp.ethereal.email',
    port: 587,
    secure: false,
    auth: { user: testAccount.user, pass: testAccount.pass },
  });
  return cachedTransporter;
}

export async function sendEmail({ to, subject, html }) {
  const transporter = await getTransporter();
  const info = await transporter.sendMail({
    from: process.env.EMAIL_FROM || 'noreply@whiteboard.dev',
    to,
    subject,
    html,
  });
  const previewUrl = nodemailer.getTestMessageUrl(info);
  console.log(`Email sent — preview: ${previewUrl}`);
  return { previewUrl };
}
