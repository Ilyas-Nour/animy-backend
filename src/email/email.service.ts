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
}
