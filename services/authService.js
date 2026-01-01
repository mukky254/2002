const jwt = require('jsonwebtoken');
const User = require('../models/User');

class AuthService {
  /**
   * Generate JWT token
   * @param {String} userId - User ID
   * @param {String} role - User role
   * @returns {String} JWT token
   */
  static generateToken(userId, role) {
    return jwt.sign(
      { 
        userId, 
        role,
        iat: Math.floor(Date.now() / 1000)
      },
      process.env.JWT_SECRET,
      { 
        expiresIn: process.env.JWT_EXPIRE || '7d',
        algorithm: 'HS256'
      }
    );
  }

  /**
   * Verify JWT token
   * @param {String} token - JWT token
   * @returns {Object} Decoded token payload
   */
  static verifyToken(token) {
    try {
      return jwt.verify(token, process.env.JWT_SECRET);
    } catch (error) {
      throw new Error('Invalid or expired token');
    }
  }

  /**
   * Register new user
   * @param {Object} userData - User data
   * @returns {Object} User and token
   */
  static async register(userData) {
    try {
      // Check if user already exists
      const existingUser = await User.findOne({ 
        $or: [
          { email: userData.email },
          { admissionNumber: userData.admissionNumber }
        ]
      });

      if (existingUser) {
        throw new Error('User with this email or admission number already exists');
      }

      // Create user
      const user = new User(userData);
      await user.save();

      // Generate token
      const token = this.generateToken(user._id, user.role);

      return {
        user: user.toJSON(),
        token
      };
    } catch (error) {
      console.error('Registration Error:', error);
      throw new Error('Registration failed: ' + error.message);
    }
  }

  /**
   * Login user
   * @param {String} email - User email
   * @param {String} password - User password
   * @returns {Object} User and token
   */
  static async login(email, password) {
    try {
      // Find user with password
      const user = await User.findOne({ email }).select('+password');
      
      if (!user) {
        throw new Error('Invalid credentials');
      }

      if (!user.isActive) {
        throw new Error('Account is deactivated. Please contact administrator.');
      }

      // Check password
      const isPasswordValid = await user.comparePassword(password);
      if (!isPasswordValid) {
        throw new Error('Invalid credentials');
      }

      // Update last login
      user.lastLogin = new Date();
      await user.save();

      // Generate token
      const token = this.generateToken(user._id, user.role);

      // Return user without password
      const userWithoutPassword = user.toJSON();

      return {
        user: userWithoutPassword,
        token
      };
    } catch (error) {
      console.error('Login Error:', error);
      throw new Error('Login failed: ' + error.message);
    }
  }

  /**
   * Change password
   * @param {String} userId - User ID
   * @param {String} currentPassword - Current password
   * @param {String} newPassword - New password
   * @returns {Boolean} Success status
   */
  static async changePassword(userId, currentPassword, newPassword) {
    try {
      const user = await User.findById(userId).select('+password');
      
      if (!user) {
        throw new Error('User not found');
      }

      // Verify current password
      const isPasswordValid = await user.comparePassword(currentPassword);
      if (!isPasswordValid) {
        throw new Error('Current password is incorrect');
      }

      // Update password
      user.password = newPassword;
      await user.save();

      return true;
    } catch (error) {
      console.error('Password Change Error:', error);
      throw new Error('Failed to change password: ' + error.message);
    }
  }

  /**
   * Update user profile
   * @param {String} userId - User ID
   * @param {Object} updateData - Data to update
   * @returns {Object} Updated user
   */
  static async updateProfile(userId, updateData) {
    try {
      // Remove restricted fields
      const restrictedFields = ['password', 'role', 'isActive', 'isVerified', 'createdAt'];
      restrictedFields.forEach(field => delete updateData[field]);

      const user = await User.findByIdAndUpdate(
        userId,
        updateData,
        { 
          new: true, 
          runValidators: true 
        }
      ).select('-password');

      if (!user) {
        throw new Error('User not found');
      }

      return user;
    } catch (error) {
      console.error('Profile Update Error:', error);
      throw new Error('Failed to update profile: ' + error.message);
    }
  }

  /**
   * Get user by ID
   * @param {String} userId - User ID
   * @returns {Object} User data
   */
  static async getUserById(userId) {
    try {
      const user = await User.findById(userId).select('-password');
      
      if (!user) {
        throw new Error('User not found');
      }

      return user;
    } catch (error) {
      console.error('Get User Error:', error);
      throw new Error('Failed to get user: ' + error.message);
    }
  }

  /**
   * Get all users with pagination
   * @param {Object} filters - Filter criteria
   * @param {Number} page - Page number
   * @param {Number} limit - Items per page
   * @returns {Object} Paginated users
   */
  static async getAllUsers(filters = {}, page = 1, limit = 10) {
    try {
      const query = { ...filters };
      
      // Calculate skip value
      const skip = (page - 1) * limit;

      // Get users
      const users = await User.find(query)
        .select('-password')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit);

      // Get total count
      const total = await User.countDocuments(query);

      return {
        users,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      };
    } catch (error) {
      console.error('Get All Users Error:', error);
      throw new Error('Failed to get users: ' + error.message);
    }
  }
}

module.exports = AuthService;
