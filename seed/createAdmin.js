const mongoose = require("mongoose");
const User = require("../models/user");
const bcrypt = require("bcryptjs");
require("dotenv").config();

async function generateUserId(role) {
    const prefix =
        role === "student" ? "STU" :
        role === "admin" ? "ADM" :
        role === "warden" ? "WAR" : "USR";

    const year = new Date().getFullYear();
    const count = await User.countDocuments({ role });
    const sequence = (count + 1).toString().padStart(4, "0");

    return `${prefix}-${year}-${sequence}`;
}

const createAdmin = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);

        const adminExists = await User.findOne({ role: "admin" });

        if (adminExists) {
            console.log("Admin already exists:", adminExists.userId);
            process.exit(0);
        }

        const hashedPassword = await bcrypt.hash("Admin@123", 10);

        const admin = new User({
            userId: await generateUserId("admin"),
            fullname: "Emaan Dar",
            email: "emaandar04@gmail.com",
            password: hashedPassword,
            role: "admin",
            status: "approved",

            // new fields
            phoneNumber: null,
            profileImage: null,
            gender: null,
            dateOfBirth: null,
            createdBy: null        // seeded admin has no creator
        });

        await admin.save();

        console.log("✅ First Admin Created Successfully");
        console.log("Login ID:", admin.userId);

        process.exit(0);

    } catch (err) {
        console.log("❌ Seeder Error:", err);
        process.exit(1);
    }
};

createAdmin();