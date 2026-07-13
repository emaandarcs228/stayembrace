const mongoose = require("mongoose");
const User = require("../models/user");
const Student = require("../models/student");
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

const createStudent = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);

        const email = "student.seed@example.com";
        const studentExists = await User.findOne({ email });

        if (studentExists) {
            console.log("Seeded student already exists:", studentExists.userId);
            process.exit(0);
        }

        const plainPassword = "Student@123";
        const hashedPassword = await bcrypt.hash(plainPassword, 10);

        const user = new User({
            userId: await generateUserId("student"),
            fullname: "Test Student",
            email,
            password: hashedPassword,
            role: "student",
            status: "approved",

            phoneNumber: "03001234567",
            profileImage: null,
            idImage: null,
            gender: "male",
            dateOfBirth: new Date("2000-01-01"),
            createdBy: null
        });

        await user.save();

        await Student.create({ user: user._id });

        console.log("✅ Seeded Student Created Successfully");
        console.log("Login ID:", user.userId);
        console.log("Password:", plainPassword);

        process.exit(0);

    } catch (err) {
        console.log("❌ Seeder Error:", err);
        process.exit(1);
    }
};

createStudent();
