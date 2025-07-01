const fetch = (...args) => import('node-fetch').then((mod) => mod.default(...args));
const { initializeApp } = require("firebase/app");
const {
  getFirestore,
  doc,
  getDoc,
  collection,
  getDocs,
  sum,
  updateDoc
} = require("firebase/firestore");
const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");
const { sendEmailWithAttachment } = require("./mail.service");
const { cloudinary } = require('../utils/cloudinary');
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

const generateReport = async (inspectionId, senderEmail) => {
  try {
    const docRef = doc(db, "houseInspections", inspectionId);
    const docSnap = await getDoc(docRef);
    if (!docSnap.exists()) throw new Error("No inspection found for given ID");

    const inspectionData = docSnap.data();
    const homeData = {
      name: inspectionData.name,
      address: inspectionData.address,
    };

    const homeRef = doc(db, "homes", inspectionData.homeId);
    const homeSnap = await getDoc(homeRef);

    // Fetch roomComparisons
    const comparisonsRef = collection(docRef, "roomComparisons");
    const comparisonSnap = await getDocs(comparisonsRef);
    const roomComparisons = comparisonSnap.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    // OpenAI call
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
                text: `
You are an AI assistant specializing in property inspections and condition reporting.

Your task is to analyze the inspection results for the property "${homeData.name}" located at ${homeData.address || 'an unspecified address'}.
Please generate a structured inspection summary with:

EXECUTIVE SUMMARY:
- Overview of property condition.

ROOM-BY-ROOM FINDINGS:
- Room name in uppercase.
- Bullet-point key findings.
- Mark if skipped, unchanged, or images analyzed.

FINAL NOTES:
- Call out if the property appears well maintained overall.
- Stay factual and objective.

Here are the raw comparison notes:
                `,
              },
              ...roomComparisons.map((room) => ({
                type: "text",
                text: `Room: ${room.roomName}\nNotes: ${
                  room.comparisonEvents?.map((e) => e.aiComparisonResult).join("\n") || "No notes."
                }`,
              })),
            ],
          },
        ],
      }),
    });

    const openaiData = await openaiRes.json();
    const summaryText = openaiData.choices?.[0]?.message?.content || "No summary generated.";

    // Markdown cleaner
    const cleanText = (text) =>
      text
        .replace(/\*\*(.*?)\*\*/g, "$1")
        .replace(/__(.*?)__/g, "$1")
        .replace(/^#+\s?/gm, "")
        .trim();

    const outputDir = path.join(__dirname, "..", "reports");
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);

    const filename = `inspection-report-${inspectionId}.pdf`;
    const pdfPath = path.join(outputDir, filename);
    const docPdf = new PDFDocument({ margin: 40 });
    docPdf.pipe(fs.createWriteStream(pdfPath));

    // Header
    docPdf.fontSize(20).font("Helvetica-Bold").text("Inspection Report", { align: "center" });
    docPdf.moveDown();
    docPdf.fontSize(12).font("Helvetica").text(`Inspection ID: ${inspectionId}`);
    docPdf.text(`Client: ${inspectionData.name}`);
    docPdf.text(`Email: ${inspectionData.email}`);
    docPdf.text(`Date: ${new Date(inspectionData.createdAt.toDate()).toLocaleString()}`);
    docPdf.moveDown(2);

    // Summary
    docPdf.fontSize(16).font("Helvetica-Bold").text("AI Summary", { underline: true });
    docPdf.moveDown();

    const sections = summaryText.split(/\n(?=[A-Z ]{4,}:)/g);
    const summarizedRooms = [];

    for (const section of sections) {
      const [header, ...bodyLines] = cleanText(section.trim()).split("\n");
      const title = header.trim().replace(":", "").toUpperCase();
      const body = bodyLines.join("\n").trim();
      if (title) {
        docPdf.moveDown(1).fontSize(13).font("Helvetica-Bold").text(title);
      }
      if (body) {
        docPdf.moveDown(0.3).fontSize(11).font("Helvetica").text(body, { lineGap: 4 });
      }

      if (title === "ROOM-BY-ROOM FINDINGS") {
        const matches = body.match(/^[\-\*]?\s?([A-Z][A-Z\s]+):/gm);
        if (matches) {
          matches.forEach((m) =>
            summarizedRooms.push(m.replace(/^[\-\*]?\s?/, "").replace(":", "").trim().toLowerCase())
          );
        }
      }
    }

    // Only add new page if there’s something more to render
    const hasOtherContent = roomComparisons.length > 0;
    if (hasOtherContent) {
      docPdf.addPage();
    }

    // Group rooms
    const skippedRooms = [];
    const imageRooms = [];

    for (const room of roomComparisons) {
      const note = room.aiComparisonResult?.toLowerCase() || "";
      const hasImages = room.uploadedImageUrls?.length > 0;
      const isSkipped =
        note.includes("skipped") || note.includes("not inspected") || note.includes("no data");

      if (isSkipped) {
        skippedRooms.push(room);
      } else if (hasImages && !summarizedRooms.includes(room.roomName.toLowerCase())) {
        imageRooms.push(room);
      }
    }

    // Skipped rooms block
    if (skippedRooms.length > 0) {
      docPdf.fontSize(14).font("Helvetica-Bold").text("Skipped / Uninspected Rooms", { underline: true });
      docPdf.moveDown(0.5);
      docPdf.font("Helvetica").fontSize(11);
      for (const room of skippedRooms) {
        const reason = cleanText(room.aiComparisonResult || "No data provided.");
        docPdf.text(`- ${room.roomName}: ${reason}`);
      }

      if (imageRooms.length > 0) {
        docPdf.addPage(); // Only if images follow
      }
    }

    // Rooms with images
    for (let i = 0; i < imageRooms.length; i++) {
      const room = imageRooms[i];
      docPdf.fontSize(14).font("Helvetica-Bold").text(`Room: ${room.roomName}`, { underline: true });
      docPdf.moveDown(0.5);
      const note = cleanText(room.aiComparisonResult || "No comparison available.");
      docPdf.fontSize(11).font("Helvetica").text(note, { lineGap: 4 });

      if (room.uploadedImageUrls?.length) {
        docPdf.moveDown(0.5);
        for (const imageUrl of room.uploadedImageUrls) {
          try {
            const imageRes = await fetch(imageUrl);
            if (!imageRes.ok) throw new Error(`HTTP ${imageRes.status}`);
            const buffer = await imageRes.buffer();
            docPdf.image(buffer, { fit: [400, 300], align: "center" });
            docPdf.moveDown();
          } catch (err) {
            docPdf.font("Helvetica-Oblique").text(`Could not load image: ${imageUrl}`);
            docPdf.moveDown(0.5);
          }
        }
      }

      if (i < imageRooms.length - 1) {
        docPdf.addPage(); // Only between pages
      }
    }

    docPdf.end(); // ✅ Cleanly ends PDF with no empty page

    // Upload to Cloudinary
    const uploadResult = await cloudinary.uploader.upload(pdfPath, {
      resource_type: "raw",
      folder: "inspection_reports",
      use_filename: true,
      unique_filename: false,
      overwrite: true,
    });

    const pdfUrl = uploadResult.secure_url;

    // Update DB
    await updateDoc(docRef, {
      reportUrl: pdfUrl,
      status: "completed",
      reportGeneratedAt: new Date(),
    });

    // Email
    await sendEmailWithAttachment({
      email: senderEmail ? [inspectionData.email, senderEmail] : inspectionData.email,
      subject: `Inspection Report for ${inspectionData.name}`,
      emailContent: `
        <p>Hello ${inspectionData.name},</p>
        <p>Here is your inspection report. Please find attached the inspection report.</p>
        <p>Thank you.</p>
      `,
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
