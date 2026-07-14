const mongoose = require("mongoose");
const User = require("../models/user");
const bcrypt = require("bcryptjs");
require("dotenv").config();

async function generateUserId(role) {
    const prefix =
        role === "student" ? "STU" :
        role === "admin"   ? "ADM" :
        role === "warden"  ? "WAR" :
        role === "driver"  ? "DRV" : "USR";

    const year     = new Date().getFullYear();
    const count    = await User.countDocuments({ role });
    const sequence = (count + 1).toString().padStart(4, "0");

    return `${prefix}-${year}-${sequence}`;
}

const createWarden = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);

        const email = "warden.seed@example.com";
        const wardenExists = await User.findOne({ email });

        if (wardenExists) {
            console.log("Seeded warden already exists:", wardenExists.userId);
            process.exit(0);
        }

        const plainPassword = "Warden@123";
        const hashedPassword = await bcrypt.hash(plainPassword, 10);

        const user = new User({
            userId      : await generateUserId("warden"),
            fullname    : "Test Warden",
            email,
            password    : hashedPassword,
            role        : "warden",
            status      : "approved",

            phoneNumber : "03001234567",
            profileImage: null,
            gender      : "male",
            dateOfBirth : new Date("1985-08-20"),
            createdBy   : null
        });

        await user.save();

        console.log("✅ Seeded Warden Created Successfully");
        console.log("Login ID:", user.userId);
        console.log("Password:", plainPassword);

        process.exit(0);

    } catch (err) {
        console.log("❌ Seeder Error:", err);
        process.exit(1);
    }
};

createWarden();
