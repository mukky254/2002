const QRCode = require('qrcode');
const { v4: uuidv4 } = require('uuid');
const QRCodeModel = require('../models/QRCode');
const Lecture = require('../models/Lecture');

class QRCodeService {
  /**
   * Generate QR code for a lecture
   * @param {Object} lectureData - Lecture data
   * @param {Number} durationMinutes - Duration in minutes
   * @returns {Object} QR code data
   */
  static async generateQRCode(lectureData, durationMinutes = 60) {
    try {
      // Create lecture record
      const lecture = new Lecture(lectureData);
      await lecture.save();

      // Generate unique code
      const uniqueCode = uuidv4();
      
      // Calculate expiration time
      const expiresAt = new Date();
      expiresAt.setMinutes(expiresAt.getMinutes() + durationMinutes);
      
      // Create QR code data
      const qrData = {
        lectureId: lecture._id.toString(),
        code: uniqueCode,
        expiresAt: expiresAt.toISOString(),
        unitCode: lecture.unitCode,
        unitName: lecture.unitName
      };
      
      // Generate QR code as data URL
      const qrCodeImage = await QRCode.toDataURL(JSON.stringify(qrData), {
        errorCorrectionLevel: 'H',
        margin: 1,
        width: parseInt(process.env.QR_CODE_SIZE) || 300,
        color: {
          dark: '#000000',
          light: '#FFFFFF'
        }
      });
      
      // Save QR code to database
      const qrCode = new QRCodeModel({
        lectureId: lecture._id,
        uniqueCode,
        qrCodeImage,
        expiresAt,
        maxScans: lecture.totalStudents || 100
      });
      
      await qrCode.save();
      
      // Update lecture with QR code ID
      lecture.qrCodeId = qrCode._id;
      await lecture.save();
      
      return {
        success: true,
        data: {
          lectureId: lecture._id,
          qrCodeId: qrCode._id,
          qrCodeImage,
          uniqueCode,
          expiresAt,
          lectureDetails: {
            unitName: lecture.unitName,
            unitCode: lecture.unitCode,
            date: lecture.date,
            startTime: lecture.startTime,
            endTime: lecture.endTime,
            venue: lecture.venue
          }
        }
      };
    } catch (error) {
      console.error('QR Code Generation Error:', error);
      throw new Error('Failed to generate QR code: ' + error.message);
    }
  }

  /**
   * Validate QR code scan
   * @param {String} code - QR code unique code
   * @param {String} studentId - Student ID
   * @returns {Object} Validation result
   */
  static async validateQRCode(code, studentId) {
    try {
      // Find active QR code
      const qrCode = await QRCodeModel.findOne({
        uniqueCode: code,
        isActive: true,
        expiresAt: { $gt: new Date() },
        scanCount: { $lt: '$maxScans' }
      }).populate('lectureId');

      if (!qrCode) {
        return { 
          valid: false, 
          message: 'QR code is invalid, expired, or has reached maximum scans' 
        };
      }

      // Check if lecture exists and is active
      if (!qrCode.lectureId || !qrCode.lectureId.isActive) {
        return { 
          valid: false, 
          message: 'Lecture is not available' 
        };
      }

      // Check if student has already scanned this QR code
      const Attendance = require('../models/Attendance');
      const existingAttendance = await Attendance.findOne({
        studentId,
        lectureId: qrCode.lectureId._id
      });

      if (existingAttendance) {
        return { 
          valid: false, 
          message: 'Attendance already marked for this lecture' 
        };
      }

      // Check lecture time
      const now = new Date();
      const lectureDate = new Date(qrCode.lectureId.date);
      const lectureStartTime = qrCode.lectureId.startTime.split(':');
      const lectureEndTime = qrCode.lectureId.endTime.split(':');
      
      const lectureStart = new Date(lectureDate);
      lectureStart.setHours(lectureStartTime[0], lectureStartTime[1], 0, 0);
      
      const lectureEnd = new Date(lectureDate);
      lectureEnd.setHours(lectureEndTime[0], lectureEndTime[1], 0, 0);
      
      // Allow scanning 30 minutes before and 15 minutes after lecture
      const scanStart = new Date(lectureStart.getTime() - 30 * 60000);
      const scanEnd = new Date(lectureEnd.getTime() + 15 * 60000);
      
      if (now < scanStart || now > scanEnd) {
        return { 
          valid: false, 
          message: 'QR code can only be scanned during lecture time (±30 minutes)' 
        };
      }

      return { 
        valid: true, 
        qrCode,
        lecture: qrCode.lectureId 
      };
    } catch (error) {
      console.error('QR Code Validation Error:', error);
      throw new Error('QR code validation failed: ' + error.message);
    }
  }

  /**
   * Record attendance from QR scan
   * @param {Object} validationResult - Validation result from validateQRCode
   * @param {String} studentId - Student ID
   * @param {Object} deviceInfo - Device information
   * @returns {Object} Attendance record
   */
  static async recordAttendance(validationResult, studentId, deviceInfo = {}) {
    try {
      const { qrCode, lecture } = validationResult;
      
      // Create attendance record
      const Attendance = require('../models/Attendance');
      const attendance = new Attendance({
        studentId,
        lectureId: lecture._id,
        qrCodeId: qrCode._id,
        deviceInfo,
        scanTime: new Date()
      });

      await attendance.save();

      // Update QR code scan count
      qrCode.scanCount += 1;
      if (qrCode.scanCount >= qrCode.maxScans) {
        qrCode.isActive = false;
      }
      await qrCode.save();

      // Update lecture attendance count
      lecture.attendanceCount += 1;
      await lecture.save();

      return {
        success: true,
        data: {
          attendanceId: attendance._id,
          lectureId: lecture._id,
          unitName: lecture.unitName,
          unitCode: lecture.unitCode,
          lecturerName: lecture.lecturerName,
          scanTime: attendance.scanTime,
          status: attendance.status,
          venue: lecture.venue,
          date: lecture.date,
          startTime: lecture.startTime,
          endTime: lecture.endTime
        }
      };
    } catch (error) {
      console.error('Attendance Recording Error:', error);
      throw new Error('Failed to record attendance: ' + error.message);
    }
  }

  /**
   * Deactivate QR code
   * @param {String} qrCodeId - QR Code ID
   * @returns {Boolean} Success status
   */
  static async deactivateQRCode(qrCodeId) {
    try {
      const qrCode = await QRCodeModel.findById(qrCodeId);
      if (!qrCode) {
        throw new Error('QR code not found');
      }

      qrCode.isActive = false;
      qrCode.expiresAt = new Date(); // Set to now to expire immediately
      await qrCode.save();

      return true;
    } catch (error) {
      console.error('QR Code Deactivation Error:', error);
      throw new Error('Failed to deactivate QR code: ' + error.message);
    }
  }

  /**
   * Get QR code statistics
   * @param {String} lecturerId - Lecturer ID
   * @returns {Object} Statistics
   */
  static async getQRCodeStats(lecturerId) {
    try {
      const lectures = await Lecture.find({ lecturerId });
      const lectureIds = lectures.map(lecture => lecture._id);

      const qrCodes = await QRCodeModel.find({ 
        lectureId: { $in: lectureIds } 
      });

      const stats = {
        totalQRCodes: qrCodes.length,
        activeQRCodes: qrCodes.filter(qr => qr.isActive && qr.expiresAt > new Date()).length,
        totalScans: qrCodes.reduce((sum, qr) => sum + qr.scanCount, 0),
        avgScanRate: qrCodes.length > 0 ? 
          (qrCodes.reduce((sum, qr) => sum + qr.scanCount, 0) / qrCodes.length).toFixed(2) : 0
      };

      return stats;
    } catch (error) {
      console.error('QR Code Stats Error:', error);
      throw new Error('Failed to get QR code statistics: ' + error.message);
    }
  }
}

module.exports = QRCodeService;
