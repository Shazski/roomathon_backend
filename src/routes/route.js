const express = require('express');
const { sendEmail } = require('../service/mail.service');

const router = express.Router();

router.post('/send-email', async (req, res) => {
    const {email, subject, emailContent} = req.body;
    try {
        await sendEmail(email, subject, emailContent);
        res.status(200).send({
            message: "email sent successfully",
            status: 200
        });
    } catch (error) {
        res.status(500).send({
            message: error.message || "Failed to send email",
            status: 500
        });
    }
});

module.exports = router;