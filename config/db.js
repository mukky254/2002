const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });
    
    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
    
    // Check if admin exists, if not create one
    await createInitialAdmin();
    
    return conn;
  } catch (error) {
    console.error(`❌ MongoDB Connection Error: ${error.message}`);
    process.exit(1);
  }
};

// Create initial admin user
const createInitialAdmin = async () => {
  try {
    const User = require('../models/User');
    const bcrypt = require('bcryptjs');
    
    const adminExists = await User.findOne({ email: process.env.ADMIN_EMAIL });
    
    if (!adminExists) {
      const hashedPassword = await bcrypt.hash(process.env.ADMIN_PASSWORD, 10);
      
      const admin = new User({
        name: 'System Administrator',
        email: process.env.ADMIN_EMAIL,
        password: hashedPassword,
        role: 'admin',
        phone: process.env.ADMIN_PHONE,
        admissionNumber: 'ADMIN001',
        isVerified: true
      });
      
      await admin.save();
      console.log('✅ Initial admin user created successfully');
    }
  } catch (error) {
    console.error('❌ Error creating admin user:', error);
  }
};

module.exports = connectDB;
