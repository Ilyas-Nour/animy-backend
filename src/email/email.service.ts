import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Resend } from "resend";

@Injectable()
export class EmailService {
  private resend: Resend;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.get<string>("resend.apiKey");
    if (!apiKey) {
      console.warn(
        "[EmailService] RESEND_API_KEY is not defined in configuration.",
      );
      // Initialize with placeholder to prevent immediate crash if not critical
      this.resend = new Resend("re_123_placeholder");
    } else {
      this.resend = new Resend(apiKey);
      console.log("[EmailService] Initialized with Resend API Key.");
    }
  }

  async sendVerificationEmail(email: string, token: string) {
    const frontendUrl =
      this.configService.get<string>("frontendUrl") || "http://localhost:3000";
    const confirmLink = `${frontendUrl}/verify?token=${token}`;

    const fromEmail =
      this.configService.get<string>("email.from") ||
      "Animy <onboarding@resend.dev>";

    console.log(
      `[EmailService] Attempting to send verification email to: ${email}`,
    );

    try {
      const { data, error } = await this.resend.emails.send({
        from: fromEmail,
        to: email,
        subject: "Verify your Animy Account 🛡️",
        text: `Welcome to Animy!\n\nPlease verify your email to continue: ${confirmLink}\n\nIf you did not request this, please ignore this email.`,
        html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
          <style>
            @media only screen and (max-width: 620px) {
              table.body h1 {
                font-size: 28px !important;
                margin-bottom: 10px !important;
              }
              table.body p,
              table.body ul,
              table.body ol,
              table.body td,
              table.body span,
              table.body a {
                font-size: 16px !important;
              }
              table.body .wrapper,
              table.body .article {
                padding: 10px !important;
              }
              table.body .content {
                padding: 0 !important;
              }
              table.body .container {
                padding: 0 !important;
                width: 100% !important;
              }
            }
          </style>
        </head>
        <body style="background-color: #09090b; font-family: sans-serif; -webkit-font-smoothing: antialiased; font-size: 14px; line-height: 1.4; margin: 0; padding: 0; -ms-text-size-adjust: 100%; -webkit-text-size-adjust: 100%;">
          <table role="presentation" border="0" cellpadding="0" cellspacing="0" class="body" style="border-collapse: separate; mso-table-lspace: 0pt; mso-table-rspace: 0pt; width: 100%; background-color: #09090b;">
            <tr>
              <td style="font-family: sans-serif; font-size: 14px; vertical-align: top;">&nbsp;</td>
              <td class="container" style="font-family: sans-serif; font-size: 14px; vertical-align: top; display: block; max-width: 580px; padding: 10px; width: 580px; margin: 0 auto;">
                <div class="content" style="box-sizing: border-box; display: block; margin: 0 auto; max-width: 580px; padding: 10px;">

                  <!-- START CENTERED WHITE CONTAINER -->
                  <table role="presentation" class="main" style="border-collapse: separate; mso-table-lspace: 0pt; mso-table-rspace: 0pt; width: 100%; background: #18181b; border: 1px solid #27272a; border-radius: 16px; width: 100%;">

                    <!-- START MAIN CONTENT AREA -->
                    <tr>
                      <td class="wrapper" style="font-family: sans-serif; font-size: 14px; vertical-align: top; box-sizing: border-box; padding: 40px;">
                        <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="border-collapse: separate; mso-table-lspace: 0pt; mso-table-rspace: 0pt; width: 100%;">
                          <tr>
                            <td style="font-family: sans-serif; font-size: 14px; vertical-align: top;">
                              <h1 style="color: #ffffff; font-family: sans-serif; font-weight: 800; line-height: 1.4; margin: 0; margin-bottom: 20px; font-size: 32px; text-align: center;">Welcome to <span style="color: #a855f7;">Animy</span></h1>
                              <p style="font-family: sans-serif; font-size: 16px; font-weight: normal; margin: 0; margin-bottom: 24px; color: #a1a1aa; text-align: center;">You're just one step away. Please verify your email to unlock your full profile and join the community.</p>
                              <table role="presentation" border="0" cellpadding="0" cellspacing="0" class="btn btn-primary" style="border-collapse: separate; mso-table-lspace: 0pt; mso-table-rspace: 0pt; width: 100%; box-sizing: border-box;">
                                <tbody>
                                  <tr>
                                    <td align="center" style="font-family: sans-serif; font-size: 14px; vertical-align: top; padding-bottom: 24px;">
                                      <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="border-collapse: separate; mso-table-lspace: 0pt; mso-table-rspace: 0pt; width: auto;">
                                        <tbody>
                                          <tr>
                                            <td style="font-family: sans-serif; font-size: 14px; vertical-align: top; border-radius: 12px; text-align: center; background-color: #7c3aed;"> 
                                              <a href="${confirmLink}" target="_blank" style="border: solid 1px #7c3aed; border-radius: 12px; box-sizing: border-box; color: #ffffff; cursor: pointer; display: inline-block; font-size: 16px; font-weight: bold; margin: 0; padding: 14px 28px; text-decoration: none; background-color: #7c3aed; box-shadow: 0 4px 12px rgba(124, 58, 237, 0.3);">Verify Email Address</a> 
                                            </td>
                                          </tr>
                                        </tbody>
                                      </table>
                                    </td>
                                  </tr>
                                </tbody>
                              </table>
                              <p style="font-family: sans-serif; font-size: 14px; font-weight: normal; margin: 0; margin-bottom: 10px; color: #71717a; text-align: center;">Or copy and paste this link into your browser:</p>
                              <p style="font-family: sans-serif; font-size: 12px; font-weight: normal; margin: 0; margin-bottom: 15px; color: #7c3aed; text-align: center; word-break: break-all;">
                                <a href="${confirmLink}" style="color: #7c3aed; text-decoration: underline;">${confirmLink}</a>
                              </p>
                              
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                    <!-- END MAIN CONTENT AREA -->
                  </table>
                  <!-- END CENTERED WHITE CONTAINER -->

                  <!-- START FOOTER -->
                  <div class="footer" style="clear: both; margin-top: 10px; text-align: center; width: 100%;">
                    <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="border-collapse: separate; mso-table-lspace: 0pt; mso-table-rspace: 0pt; width: 100%;">
                      <tr>
                        <td class="content-block" style="font-family: sans-serif; vertical-align: top; padding-bottom: 10px; padding-top: 10px; font-size: 12px; color: #52525b; text-align: center;">
                          <span class="apple-link" style="color: #52525b; font-size: 12px; text-align: center;">Animy Inc, Digital Expanse 404</span>
                        </td>
                      </tr>
                    </table>
                  </div>
                  <!-- END FOOTER -->

                </div>
              </td>
              <td style="font-family: sans-serif; font-size: 14px; vertical-align: top;">&nbsp;</td>
            </tr>
          </table>
        </body>
        </html>
        `,
      });

      if (error) {
        console.error(
          `[EmailService] Resend API Error for ${email}:`,
          JSON.stringify(error, null, 2),
        );
      } else {
        console.log(
          `[EmailService] Verification email successfully sent to ${email}. ID: ${data?.id}`,
        );
      }
    } catch (error) {
      console.error(
        `[EmailService] Email sending failed (Exception) for ${email}:`,
        error,
      );
    }
  }

  async sendPasswordResetEmail(email: string, token: string) {
    const frontendUrl =
      this.configService.get<string>("frontendUrl") || "https://animy.xyz";
    const resetLink = `${frontendUrl}/auth/reset-password?token=${token}`;

    const fromEmail =
      this.configService.get<string>("email.from") ||
      "Animy <onboarding@resend.dev>";

    console.log(
      `[EmailService] Attempting to send password reset email to: ${email}`,
    );

    try {
      const { data, error } = await this.resend.emails.send({
        from: fromEmail,
        to: email,
        subject: "Reset your Animy Password 🔐",
        text: `You requested a password reset for your Animy account.\n\nReset your password here: ${resetLink}\n\nThis link will expire in 1 hour.\n\nIf you did not request this, please ignore this email. Your account is completely safe.`,
        html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
          <style>
            @media only screen and (max-width: 620px) {
              table.body h1 {
                font-size: 26px !important;
                margin-bottom: 10px !important;
              }
              table.body p,
              table.body a {
                font-size: 15px !important;
              }
              table.body .wrapper {
                padding: 20px !important;
              }
              table.body .container {
                padding: 0 !important;
                width: 100% !important;
              }
            }
          </style>
        </head>
        <body style="background-color: #09090b; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 14px; line-height: 1.5; margin: 0; padding: 0; -webkit-text-size-adjust: 100%;">
          <table role="presentation" border="0" cellpadding="0" cellspacing="0" class="body" style="border-collapse: separate; width: 100%; background-color: #09090b;">
            <tr>
              <td>&nbsp;</td>
              <td class="container" style="display: block; max-width: 580px; padding: 20px 10px; width: 580px; margin: 0 auto;">
                <div class="content" style="box-sizing: border-box; display: block; margin: 0 auto; max-width: 580px;">

                  <table role="presentation" class="main" style="border-collapse: separate; width: 100%; background: #141417; border: 1px solid #27272a; border-radius: 20px; overflow: hidden;">
                    <tr>
                      <td style="height: 4px; background: linear-gradient(90deg, #a855f7, #ec4899);"></td>
                    </tr>
                    <tr>
                      <td class="wrapper" style="box-sizing: border-box; padding: 40px 32px;">
                        <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="border-collapse: separate; width: 100%;">
                          <tr>
                            <td style="text-align: center;">
                              <div style="display: inline-block; width: 56px; height: 56px; border-radius: 28px; background-color: rgba(168, 85, 247, 0.15); border: 1px solid rgba(168, 85, 247, 0.3); text-align: center; line-height: 56px; font-size: 24px; margin-bottom: 20px;">
                                🔐
                              </div>
                              <h1 style="color: #ffffff; font-weight: 800; line-height: 1.3; margin: 0 0 12px 0; font-size: 28px;">Password Reset Request</h1>
                              <p style="font-size: 15px; color: #a1a1aa; margin: 0 0 28px 0; line-height: 1.6;">
                                We received a request to reset the password for your <strong style="color: #ffffff;">Animy</strong> account. Click the button below to choose a new password:
                              </p>
                              
                              <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="border-collapse: separate; width: 100%; margin-bottom: 28px;">
                                <tbody>
                                  <tr>
                                    <td align="center">
                                      <a href="${resetLink}" target="_blank" style="display: inline-block; background-color: #8b5cf6; border: 1px solid #7c3aed; border-radius: 12px; color: #ffffff; font-size: 16px; font-weight: 700; text-decoration: none; padding: 14px 32px; box-shadow: 0 4px 14px rgba(139, 92, 246, 0.4);">
                                        Reset My Password
                                      </a>
                                    </td>
                                  </tr>
                                </tbody>
                              </table>

                              <div style="background-color: #1f1f23; border: 1px solid #2e2e33; border-radius: 12px; padding: 14px 18px; margin-bottom: 24px; text-align: left;">
                                <p style="font-size: 13px; color: #d4d4d8; margin: 0; line-height: 1.5;">
                                  ⏳ <strong style="color: #ffffff;">Security Notice:</strong> This reset link will automatically expire in <strong style="color: #ffffff;">60 minutes</strong>. If you did not request a password reset, you can safely ignore this email—your password will remain unchanged.
                                </p>
                              </div>

                              <p style="font-size: 12px; color: #71717a; margin: 0 0 8px 0;">If the button above does not work, copy and paste this link into your browser:</p>
                              <p style="font-size: 12px; margin: 0; word-break: break-all;">
                                <a href="${resetLink}" style="color: #a855f7; text-decoration: underline;">${resetLink}</a>
                              </p>
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                  </table>

                  <div class="footer" style="margin-top: 16px; text-align: center; width: 100%;">
                    <p style="font-size: 12px; color: #52525b; margin: 0;">
                      Animy | Discover Anime, Read Manga &amp; Connect with Friends
                    </p>
                  </div>

                </div>
              </td>
              <td>&nbsp;</td>
            </tr>
          </table>
        </body>
        </html>
        `,
      });

      if (error) {
        console.error(
          `[EmailService] Resend API Error for ${email}:`,
          JSON.stringify(error, null, 2),
        );
      } else {
        console.log(
          `[EmailService] Password reset email successfully sent to ${email}. ID: ${data?.id}`,
        );
      }
    } catch (error) {
      console.error(
        `[EmailService] Password reset email failed (Exception) for ${email}:`,
        error,
      );
    }
  }
}
