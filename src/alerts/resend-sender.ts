import { Resend } from "resend";
import type { AlertSender } from "./ports";
import type { AlertPayload } from "../types";
import { buildAlertEmail } from "./templates";

export function createResendSender(): AlertSender {
  const resend = new Resend(process.env.RESEND_API_KEY);
  return {
    async send(to: string, alerts: AlertPayload[]): Promise<void> {
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
    },
  };
}
