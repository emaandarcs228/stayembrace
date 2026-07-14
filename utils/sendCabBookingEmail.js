const nodemailer = require("nodemailer");

// Reuse the same transporter config from sendApprovalEmail.js
const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS   // Gmail App Password
    }
});

/**
 * Sends a cab booking confirmation email to the student's guardian.
 *
 * @param {Object} params
 * @param {string} params.guardianEmail  - Guardian's email address
 * @param {string} params.guardianName   - Guardian's name (for greeting)
 * @param {string} params.studentName    - Student's full name
 * @param {string} params.studentId      - Student's readable User ID
 * @param {string} params.driverName     - Driver's name
 * @param {string} params.driverPhone    - Driver's phone number
 * @param {string} params.vehicleType    - Vehicle type (e.g. Sedan, Van)
 * @param {string} params.vehicleReg     - Vehicle registration plate
 * @param {string} params.pickupLocation - Pickup address
 * @param {string} params.dropoffLocation- Drop-off address
 * @param {string} params.pickupDate     - Formatted pickup date
 * @param {string} params.pickupTime     - Pickup time (or empty string)
 * @param {number} params.passengerCount - Number of passengers
 * @param {string} params.notes          - Any special instructions
 */
const sendCabBookingConfirmation = async (params) => {
    const {
        guardianEmail,
        guardianName,
        studentName,
        studentId,
        driverName,
        driverPhone,
        vehicleType,
        vehicleReg,
        pickupLocation,
        dropoffLocation,
        pickupDate,
        pickupTime,
        passengerCount,
        notes
    } = params;

    if (!guardianEmail) {
        console.warn('sendCabBookingConfirmation: No guardian email provided — skipping.');
        return;
    }

    const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Cab Booking Confirmed – Stay Embrace</title>
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
                <td style="background:#E65100;padding:28px 32px;text-align:center">
                  <h1 style="margin:0;color:#ffffff;font-size:22px;letter-spacing:2px;
                             font-weight:700">STAY EMBRACE</h1>
                  <p style="margin:6px 0 0;color:#ffcc80;font-size:13px">
                    Cab Booking Confirmation
                  </p>
                </td>
              </tr>

              <!-- Confirmation banner -->
              <tr>
                <td style="background:#F57C00;padding:16px 32px;text-align:center">
                  <p style="margin:0;color:#ffffff;font-size:15px;font-weight:600">
                    🚕 &nbsp;Cab booking confirmed for <strong>${studentName}</strong>
                  </p>
                </td>
              </tr>

              <!-- Body -->
              <tr>
                <td style="padding:32px 32px 20px">
                  <p style="margin:0 0 12px;color:#333;font-size:15px">
                    Dear <strong>${guardianName || 'Guardian'}</strong>,
                  </p>
                  <p style="margin:0 0 24px;color:#555;font-size:14px;line-height:1.6">
                    A cab booking has been confirmed for
                    <strong>${studentName}</strong> (${studentId}).
                    Please find the trip details below.
                  </p>

                  <!-- Trip Details Box -->
                  <table width="100%" cellpadding="0" cellspacing="0"
                         style="background:#FFF8E1;border:1px solid #FFE082;
                                border-radius:8px;margin-bottom:24px">
                    <tr>
                      <td style="padding:20px 24px">
                        <p style="margin:0 0 4px;font-size:11px;color:#E65100;
                                  text-transform:uppercase;letter-spacing:1px;font-weight:700">
                          Trip Details
                        </p>
                        <hr style="border:none;border-top:1px solid #FFE082;margin:10px 0">

                        <table cellpadding="0" cellspacing="0" width="100%">
                          <tr>
                            <td style="padding:5px 0;color:#666;font-size:13px;width:130px">Pickup</td>
                            <td style="padding:5px 0;font-size:13px;color:#333;font-weight:500">${pickupLocation}</td>
                          </tr>
                          <tr>
                            <td style="padding:5px 0;color:#666;font-size:13px">Drop-off</td>
                            <td style="padding:5px 0;font-size:13px;color:#333;font-weight:500">${dropoffLocation}</td>
                          </tr>
                          <tr>
                            <td style="padding:5px 0;color:#666;font-size:13px">Pickup Date</td>
                            <td style="padding:5px 0;font-size:13px;color:#333;font-weight:500">${pickupDate}</td>
                          </tr>
                          ${pickupTime ? `<tr>
                            <td style="padding:5px 0;color:#666;font-size:13px">Pickup Time</td>
                            <td style="padding:5px 0;font-size:13px;color:#333;font-weight:500">${pickupTime}</td>
                          </tr>` : ''}
                          <tr>
                            <td style="padding:5px 0;color:#666;font-size:13px">Passengers</td>
                            <td style="padding:5px 0;font-size:13px;color:#333;font-weight:500">${passengerCount}</td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                  </table>

                  <!-- Driver & Vehicle Info -->
                  <table width="100%" cellpadding="0" cellspacing="0"
                         style="background:#EEF5E9;border:1px solid #b8d9c0;
                                border-radius:8px;margin-bottom:24px">
                    <tr>
                      <td style="padding:20px 24px">
                        <p style="margin:0 0 4px;font-size:11px;color:#2E7D32;
                                  text-transform:uppercase;letter-spacing:1px;font-weight:700">
                          Driver &amp; Vehicle
                        </p>
                        <hr style="border:none;border-top:1px solid #c8e0cc;margin:10px 0">

                        <table cellpadding="0" cellspacing="0" width="100%">
                          <tr>
                            <td style="padding:5px 0;color:#666;font-size:13px;width:130px">Driver Name</td>
                            <td style="padding:5px 0;font-size:13px;color:#333;font-weight:500">${driverName}</td>
                          </tr>
                          <tr>
                            <td style="padding:5px 0;color:#666;font-size:13px">Contact</td>
                            <td style="padding:5px 0;font-size:13px;color:#333;font-weight:500">
                              <a href="tel:${driverPhone}" style="color:#1565C0;text-decoration:none">${driverPhone}</a>
                            </td>
                          </tr>
                          <tr>
                            <td style="padding:5px 0;color:#666;font-size:13px">Vehicle</td>
                            <td style="padding:5px 0;font-size:13px;color:#333;font-weight:500">${vehicleType || '—'}</td>
                          </tr>
                          ${vehicleReg ? `<tr>
                            <td style="padding:5px 0;color:#666;font-size:13px">Registration</td>
                            <td style="padding:5px 0;font-size:13px;color:#333;font-weight:500"><strong>${vehicleReg}</strong></td>
                          </tr>` : ''}
                        </table>
                      </td>
                    </tr>
                  </table>

                  ${notes ? `
                  <!-- Notes -->
                  <table width="100%" cellpadding="0" cellspacing="0"
                         style="background:#f5f5f5;border-left:4px solid #F57C00;
                                border-radius:4px;margin-bottom:24px">
                    <tr>
                      <td style="padding:12px 16px;color:#666;font-size:13px;line-height:1.5">
                        <strong style="color:#E65100">📝 Notes:</strong><br>${notes}
                      </td>
                    </tr>
                  </table>` : ''}

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

    try {
        await transporter.sendMail({
            from    : `"Stay Embrace" <${process.env.EMAIL_USER}>`,
            to      : guardianEmail,
            subject : `🚕 Cab Booking Confirmed — ${studentName} (${pickupDate})`,
            html
        });
        console.log(`Cab booking confirmation email sent to guardian: ${guardianEmail}`);
    } catch (err) {
        console.error('Failed to send cab booking confirmation email:', err);
    }
};

module.exports = sendCabBookingConfirmation;
