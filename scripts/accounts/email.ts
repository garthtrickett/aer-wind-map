export type LoginMailer = (email: string, link: string) => Promise<void>;

export const createResendMailer = (key: string, from: string, fetcher: typeof fetch = fetch): LoginMailer => async (email, link) => {
  const text = `Sign in to Aer\n\nOpen this link, then choose Continue to sign in:\n${link}\n\nThis link expires in 15 minutes and can be used once. If you did not request it, ignore this email.`;
  const response = await fetcher("https://api.resend.com/emails", {
    method: "POST", signal: AbortSignal.timeout(15_000),
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [email], subject: "Your Aer sign-in link", text }),
  });
  // Never log a response containing email addresses, provider credentials or links.
  if (!response.ok) throw new Error("Login email could not be sent. Please try again later.");
};
