const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS   // Gmail App Password (not your normal password)
    }
});

/**
 * Sends an account-approval email to the student.
 *
 * @param {string} email      - student's email address
 * @param {string} fullname   - student's full name
 * @param {string} userId     - readable User ID  e.g. STU-2026-0001
 * @param {string} password   - plain-text temp password saved at registration
 */
const sendApprovalEmail = async (email, fullname, userId, password) => {

    const loginUrl = process.env.APP_URL
        ? `${process.env.APP_URL}/login/student`
        : "http://localhost:3000/login/student";

    const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Account Approved – Stay Embrace</title>
    </head>
    <body style="margin:0;padding:0;background:#f5f5f5;font-family:'Segoe UI',Arial,sans-serif">

      <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:30px 0">
        <tr>
          <td align="center">
            <table width="540" cellpadding="0" cellspacing="0"
                   style="background:#ffffff;border-radius:10px;overflow:hidden;
                          box-shadow:0 4px 20px rgba(0,0,0,0.08)">

              <!-- Header -->
              <tr>
                <td style="background:#2D5A3D;padding:28px 32px;text-align:center">
                  <h1 style="margin:0;color:#ffffff;font-size:22px;letter-spacing:2px;
                             font-weight:700">STAY EMBRACE</h1>
                  <p style="margin:6px 0 0;color:#a8d5b5;font-size:13px">
                    Hostel Management System
                  </p>
                </td>
              </tr>

              <!-- Success banner -->
              <tr>
                <td style="background:#4A7C59;padding:16px 32px;text-align:center">
                  <p style="margin:0;color:#ffffff;font-size:15px;font-weight:600">
                    ✅ &nbsp;Your account has been approved!
                  </p>
                </td>
              </tr>

              <!-- Body -->
              <tr>
                <td style="padding:32px 32px 20px">
                  <p style="margin:0 0 12px;color:#333;font-size:15px">
                    Hello <strong>${fullname}</strong>,
                  </p>
                  <p style="margin:0 0 24px;color:#555;font-size:14px;line-height:1.6">
                    Your hostel account has been reviewed and <strong>approved</strong>
                    by the administration. You can now log in using the credentials below.
                  </p>

                  <!-- Credentials box -->
                  <table width="100%" cellpadding="0" cellspacing="0"
                         style="background:#EEF5F0;border:1px solid #b8d9c0;
                                border-radius:8px;margin-bottom:24px">
                    <tr>
                      <td style="padding:20px 24px">
                        <p style="margin:0 0 4px;font-size:11px;color:#4A7C59;
                                  text-transform:uppercase;letter-spacing:1px;font-weight:700">
                          Your Login Credentials
                        </p>
                        <hr style="border:none;border-top:1px solid #c8e0cc;margin:10px 0">

                        <table cellpadding="0" cellspacing="0" width="100%">
                          <tr>
                            <td style="padding:6px 0;color:#666;font-size:13px;width:130px">
                              User ID
                            </td>
                            <td style="padding:6px 0">
                              <code style="background:#fff;border:1px solid #c8e0cc;
                                           border-radius:4px;padding:3px 10px;
                                           font-size:13px;color:#2D5A3D;font-weight:700;
                                           letter-spacing:1px">
                                ${userId}
                              </code>
                            </td>
                          </tr>
                          <tr>
                            <td style="padding:6px 0;color:#666;font-size:13px">
                              Temporary Password
                            </td>
                            <td style="padding:6px 0">
                              <code style="background:#fff;border:1px solid #c8e0cc;
                                           border-radius:4px;padding:3px 10px;
                                           font-size:13px;color:#2D5A3D;font-weight:700;
                                           letter-spacing:1px">
                                ${password}
                              </code>
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                  </table>

                  <!-- Warning -->
                  <table width="100%" cellpadding="0" cellspacing="0"
                         style="background:#FFF8E1;border-left:4px solid #FF8F00;
                                border-radius:4px;margin-bottom:28px">
                    <tr>
                      <td style="padding:12px 16px;color:#7a5800;font-size:13px;line-height:1.5">
                        ⚠️ &nbsp;For your security, please change your password immediately
                        after your first login.
                      </td>
                    </tr>
                  </table>

                  <!-- CTA button -->
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td align="center" style="padding-bottom:8px">
                        <a href="${loginUrl}"
                           style="display:inline-block;background:#2D5A3D;color:#ffffff;
                                  text-decoration:none;padding:13px 36px;border-radius:6px;
                                  font-size:14px;font-weight:600;letter-spacing:.5px">
                          Login to Your Account →
                        </a>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>

              <!-- Footer -->
              <tr>
                <td style="background:#f9f9f9;border-top:1px solid #eee;
                           padding:18px 32px;text-align:center">
                  <p style="margin:0;color:#aaa;font-size:11px;line-height:1.6">
                    This is an automated message from <strong>Stay Embrace</strong>
                    Hostel Management System.<br>
                    Please do not reply to this email.
                  </p>
                </td>
              </tr>

            </table>
          </td>
        </tr>
      </table>

    </body>
    </html>
    `;

    await transporter.sendMail({
        from    : `"Stay Embrace" <${process.env.EMAIL_USER}>`,
        to      : email,
        subject : "✅ Your Stay Embrace Account Has Been Approved",
        html
    });
};

module.exports = sendApprovalEmail;