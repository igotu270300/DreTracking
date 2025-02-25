require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const cors = require("cors");

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB connection
mongoose
  .connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("Connected to MongoDB"))
  .catch((err) => console.error("MongoDB connection error:", err));

// User Schema
const userSchema = new mongoose.Schema({
  username: String,
  password: String,
});

const User = mongoose.model("User", userSchema);

// Duty Schema
const dutySchema = new mongoose.Schema({
  username: { type: String, required: true },
  storeName: { type: String, required: true },
  dutyStartDate: { type: String, required: true },
  dutyStartTime: { type: String, required: true },
  startLatitude: { type: String, required: true },
  startLongtitude: { type: String, required: true },
  status: { type: Boolean, default: false },
  dutyStopDate: { type: String, default: "" },
  dutyStopTime: { type: String, default: "" },
  stopLatitude: { type: String, default: "" },
  stopLongtitude: { type: String, default: "" },
  updateLocation: [
    {
      updateLatitude: { type: String, required: true },
      updateLongtitude: { type: String, required: true },
      timestamp: { type: Date, default: Date.now },
    },
  ],
});

// const Duty = mongoose.model("Duty", dutySchema);
const Duty = mongoose.model("Duty", dutySchema, "dutys");
module.exports = Duty;

// Stores Schema
const storeSchema = new mongoose.Schema({
  name: String,
  Latitude: String,
  Longitude: String,
});

const Store = mongoose.model("Store", storeSchema);

// Login Route
app.post("/login", async (req, res) => {
  const { username, password } = req.body;
  const user = await User.findOne({ username, password });

  if (user) {
    const token = jwt.sign({ id: user._id, username: user.username }, process.env.JWT_SECRET, {
      expiresIn: "1h",
    });
    return res.json({ message: "Login successful!", username: username, token });
  } else {
    return res.status(401).json({ message: "Invalid username or password" });
  }
});

// Route to fetch store names based on a query
app.get("/stores", async (req, res) => {
  const { name } = req.query;

  try {
    // Search for stores that match the query
    const stores = await mongoose.connection
      .collection("locations") // Specify the collection name
      .find({ name: { $regex: name || "", $options: "i" } }) // Case-insensitive search
      .project({ name: 1, Latitude: 1, Longitude: 1 }) // Return only the name field
      .toArray();

    res.json(stores);
  } catch (error) {
    console.error("Error fetching stores:", error);
    res.status(500).json({ message: "Error fetching stores" });
  }
});

// Duty Start
app.post("/dutys/start", async (req, res) => {
  const { username, storeName, dutyStart, startLongtitude, startLatitude } = req.body;

  console.log("Received data:", { username, storeName, dutyStart, startLatitude, startLongtitude }); // Debug log

  try {
    const [startDate, startTime] = dutyStart.split(", ");
    const duty = new Duty({
      username,
      storeName,
      dutyStartDate: startDate,
      dutyStartTime: startTime,
      startLatitude,
      startLongtitude,
      dutyStopDate: "",
      dutyStopTime: "",
      stopLongtitude: "",
      stopLatitude: "",
    });

    const savedDuty = await duty.save();
    console.log("Saved duty:", savedDuty); // Debug log

    const token = jwt.sign(
      { _id: savedDuty._id, username },
      process.env.JWT_SECRET,
      { expiresIn: "6h" }
    );

    res.json({ message: "Duty started successfully!", token });
  } catch (error) {
    console.error("Error saving duty:", error); // Debug log
    res.status(500).json({ message: "Error starting duty", error });
  }
});

app.post("/dutys/update-location", async (req, res) => {
  const { username, latitude, longitude } = req.body;

  console.log("Live Location Update:", { username, latitude, longitude });

  try {
    // Find active duty for the user
    const duty = await Duty.findOne({ username, status: false });

    if (!duty) {
      return res.status(404).json({ message: "No active duty found." });
    }

    // Append new location to the updateLocation array
    duty.updateLocation.push({
      updateLatitude: latitude.toString(),
      updateLongtitude: longitude.toString(),
      timestamp: new Date(),
    });

    await duty.save();
    res.json({ message: "Location updated successfully!" });
  } catch (error) {
    console.error("Error updating location:", error);
    res.status(500).json({ message: "Error updating location", error });
  }
});

// Stop Duty Route
app.post("/dutys/stop", async (req, res) => {
  const { dutyStop, stopLatitude, stopLongtitude } = req.body;
  const token = req.headers.authorization?.split(" ")[1]; // Extract Bearer token

  if (!token) {
    return res.status(401).json({ message: "No token provided" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const [stopDate, stopTime] = dutyStop.split(", ");

    const updatedDuty = await Duty.findByIdAndUpdate(
      decoded._id,
      {
        dutyStopDate: stopDate,
        dutyStopTime: stopTime,
        status: true,
        stopLatitude: stopLatitude,
        stopLongtitude: stopLongtitude,
      },
      { new: true }
    );

    if (!updatedDuty) {
      return res.status(404).json({ message: "Duty not found" });
    }

    res.json({ message: "Duty stopped successfully!" });
  } catch (error) {
    console.error("Error stopping duty:", error);
    res.status(500).json({ message: "Error stopping duty", error });
  }
});

// Fetch Duty History Route
app.get("/dutys", async (req, res) => {
  const { username } = req.query;

  try {
    const history = await Duty.find({ username, status: true }).sort({ dutyStartDate: -1, dutyStartTime: -1 });
    res.json(history);
  } catch (error) {
    res.status(500).json({ message: "Error fetching duty history", error });
  }
});

// Fetch Duty History Route
app.get("/pending", async (req, res) => {
  const { username } = req.query;
  const defaultStatus = false;
  console.log(username);
  try {
    const pending = await Duty.find({ username, status: defaultStatus });
    console.log(pending)
    res.json(pending);
  } catch (error) {
    res.status(500).json({ message: "Error fetching duty history", error });
  }
});

// travel-path
app.get("/dutys/travel-path/:username", async (req, res) => {
  const { username } = req.params;

  try {
    const duty = await Duty.findOne({ username, status: false });

    if (!duty) {
      return res.status(404).json({ message: "No active duty found." });
    }

    res.json({ travelPath: duty.updateLocation });
  } catch (error) {
    console.error("Error fetching travel path:", error);
    res.status(500).json({ message: "Error fetching travel path", error });
  }
});

// Start Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
