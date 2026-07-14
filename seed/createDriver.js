const mongoose = require("mongoose");
const User = require("../models/user");
const Driver = require("../models/driver");
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

const createDriver = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);

        const email = "driver.seed@example.com";
        const driverExists = await User.findOne({ email });

        if (driverExists) {
            console.log("Seeded driver already exists:", driverExists.userId);
            process.exit(0);
        }

        const plainPassword = "Driver@123";
        const hashedPassword = await bcrypt.hash(plainPassword, 10);

        const user = new User({
            userId      : await generateUserId("driver"),
            fullname    : "Test Driver",
            email,
            password    : hashedPassword,
            role        : "driver",
            status      : "approved",

            phoneNumber : "03001234567",
            profileImage: null,
            gender      : "male",
            dateOfBirth : new Date("1990-05-15"),
            createdBy   : null
        });

        await user.save();

        await Driver.create({
            user                : user._id,
            cnic                : "35202-1234567-8",
            licenseNumber       : "L-12345678",
            licenseExpiry       : new Date("2028-12-31"),
            vehicleType         : "car",
            vehicleRegistration : "LEP-1234",
            vehicleModel        : "2022",
            serviceArea         : "Lahore",
            experienceYears     : 5,
            cnicFrontImage      : null,
            cnicBackImage       : null,
            licenseImage        : null,
            vehicleDocImage     : null,
            isVerified          : true,
            isActive            : true
        });

        console.log("✅ Seeded Driver Created Successfully");
        console.log("Login ID:", user.userId);
        console.log("Password:", plainPassword);

        process.exit(0);

    } catch (err) {
        console.log("❌ Seeder Error:", err);
        process.exit(1);
    }
};

createDriver();
