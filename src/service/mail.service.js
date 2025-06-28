const nodemailer = require('nodemailer')
const sendEmail = async(email, subject, emailContent) => {
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: 'ecommerce1419@gmail.com',
            pass: 'iqtyaldszzgoweap'
        }
    });

    const mailOptions = {
        from: 'roomaton@gmail.com',
        to: email,
        subject: subject,
        html: `
            <html>
                <body style="font-family: Arial, sans-serif; background-color: #f6f6f6; padding: 20px;">
                    <div style="max-width: 600px; margin: auto; background: #fff; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.05); padding: 30px;">
                        <h2 style="color: #333; margin-bottom: 20px;">Roomathon Notification</h2>
                        <div style="color: #444; font-size: 16px; line-height: 1.6;">
                            ${emailContent}
                        </div>
                        <hr style="margin: 30px 0;">
                        <div style="font-size: 12px; color: #888;">
                            &copy; ${new Date().getFullYear()} Roomathon. All rights reserved.
                        </div>
                    </div>
                </body>
            </html>
        `,
        attachments: [
            {filename:'HAIKU_XEANCO.COM_NONPAYER 3_Devis N°1_08-05-2025_nonpayer usecase3_Version2.pdf',
                path:"./public/files/HAIKU_XEANCO.COM_NONPAYER 3_Devis N°1_08-05-2025_nonpayer usecase3_Version2.pdf"
            }
        ]
    };

    try {
        await transporter.sendMail(mailOptions);
        return 'Email sent successfully!'
    } catch (error) {
        return ('Error sending email: ' + error.message)
    }
}

module.exports = {
    sendEmail
}