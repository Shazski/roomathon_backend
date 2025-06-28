const express = require("express")
const cors = require("cors");
const routes = require("./routes/route.js");

const app = express()

require("dotenv").config();

// Middleware setup
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/", (req, res) => {
    res.send("Welcome to Roomathon Backend!");
});

app.use("/api", routes);

app.listen(3000)