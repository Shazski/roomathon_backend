const express = require('express');
const { sendEmail } = require('../service/mail.service');
const { generateReport } = require('../service/report.service');

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

router.get('/start-report/:id', async (req, res) => {
    const {id} = req.params;
    const senderEmail = req.headers['x-user-email'] ?? '';
    try {
        await generateReport(id, senderEmail);
        res.status(200).send({
            message: "Reported generation successfully",
            status: 200
        });
    } catch (error) {
        res.status(500).send({
            message: error.message || "Failed to generate report",
            status: 500
        });
    }
});

module.exports = router;