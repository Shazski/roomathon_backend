
const fetch = (...args) => import('node-fetch').then((mod) => mod.default(...args));
const { initializeApp } = require("firebase/app");
const {
  getFirestore,
  doc,
  getDoc,
  collection,
  getDocs,
  sum,
} = require("firebase/firestore");
const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");
const { sendEmail } = require("./mail.service")
const dotenv = require("dotenv");
dotenv.config();

// Firebase config
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const generateReport = async (inspectionId) => {
  try {
    console.log(process.env.FIREBASE_API_KEY)
    const docRef = doc(db, "houseInspections", inspectionId);
    const docSnap = await getDoc(docRef);

    if (!docSnap.exists()) {
      throw new Error("No inspection found for given ID");
    }

    const inspectionData = docSnap.data();

    // Fetch roomComparisons
    const comparisonsRef = collection(docRef, "roomComparisons");
    const comparisonSnap = await getDocs(comparisonsRef);

    const roomComparisons = [];
    for (const roomDoc of comparisonSnap.docs) {
      const roomData = roomDoc.data();
      roomComparisons.push({ id: roomDoc.id, ...roomData });
    }

    // 🔍 Optional: summarize with OpenAI
    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `You are an assistant generating a professional home inspection summary report. Include key differences in rooms using the following descriptions.`,
              },
              ...roomComparisons.map((room) => ({
                type: "text",
                text: `Room: ${room.roomName}\n\n${room.aiComparisonResult}`,
              })),
            ],
          },
        ],
        max_tokens: 2000,
      }),
    });

    const openaiData = await openaiRes.json();
    const summaryText = openaiData.choices?.[0]?.message?.content || "No summary generated.";
    console.log("AI Summary:", summaryText);

    // // Generate PDF
    const outputDir = path.join(__dirname, "..", "reports");
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);

    const filename = `inspection-report-${inspectionId}.pdf`;
    const pdfPath = path.join(outputDir, filename);
    const docPdf = new PDFDocument();
    docPdf.pipe(fs.createWriteStream(pdfPath));

    // Header
    docPdf.fontSize(20).text("Inspection Report", { align: "center" });
    docPdf.moveDown();
    docPdf.fontSize(14).text(`Inspection ID: ${inspectionId}`);
    docPdf.text(`Client: ${inspectionData.name}`);
    docPdf.text(`Email: ${inspectionData.email}`);
    docPdf.text(`Date: ${new Date(inspectionData.createdAt.toDate()).toLocaleString()}`);
    docPdf.moveDown();

    // Summary
    docPdf.fontSize(16).text("AI Summary:", { underline: true });
    docPdf.fontSize(12).text(summaryText);
    docPdf.addPage();

    // Add each room
    for (const room of roomComparisons) {
      docPdf.fontSize(14).text(`Room: ${room.roomName}`, { underline: true });
      docPdf.moveDown(0.5);
      docPdf.fontSize(11).text(room.aiComparisonResult || "No comparison available.");

      if (room.uploadedImageUrls?.length) {
        docPdf.moveDown();
        for (const imageUrl of room.uploadedImageUrls) {
          try {
            const imageRes = await fetch(imageUrl);
            const buffer = await imageRes.buffer();
            docPdf.image(buffer, { fit: [400, 300], align: "center" });
            docPdf.moveDown();
          } catch (err) {
            docPdf.text(`Could not load image: ${imageUrl}`);
          }
        }
      }

      docPdf.addPage();
    }

    docPdf.end();

    await sendEmail({
      email: inspectionData.email, // e.g. aravindhan@skills-agency.com
      subject: `Inspection Report for ${inspectionData.name}`,
      emailContent: `Hello ${inspectionData.name},\n\nHere is your inspection report. Please find attached the inspection report.\n\nThank you.`,
      attachments: [
        {
          filename: path.basename(pdfPath),
          path: pdfPath,
          contentType: "application/pdf",
        },
      ],
    });
    return pdfPath;
  } catch (err) {
    console.error("Error generating report:", err);
    throw err;
  }
};

module.exports = {
  generateReport,
};
