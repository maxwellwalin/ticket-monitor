import { Resend } from "resend";
import type { AlertPayload } from "../types";
import { buildAlertEmail } from "./templates";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendAlertEmail(
  to: string,
  alerts: AlertPayload[]
): Promise<void> {
  if (alerts.length === 0) return;

  const { subject, html } = buildAlertEmail(alerts);

  const { error } = await resend.emails.send({
    from: "Ticket Monitor <onboarding@resend.dev>",
    to,
    subject,
    html,
  });

  if (error) {
    throw new Error(`Failed to send email: ${error.message}`);
  }
}
