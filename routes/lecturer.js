const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { validate } = require('../middleware/validation');
const QRCodeService = require('../services/qrCodeService');
const Lecture = require('../models/Lecture');
const Attendance = require('../models/Attendance');

// Validation rules
const generateQRValidation = [
  body('unitName').trim().notEmpty().withMessage('Unit name is required'),
  body('unitCode').trim().notEmpty().withMessage('Unit code is required').toUpperCase(),
  body('date').isISO8601().withMessage('Valid date is required'),
  body('startTime').matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).withMessage('Valid start time is required'),
  body('endTime').matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/).withMessage('Valid end time is required'),
  body('venue').trim().notEmpty().withMessage('Venue is required'),
  body('totalStudents').optional().isInt({ min: 1 }).withMessage('Total students must be a positive number'),
  body('description').optional().trim(),
  body('duration').optional().isInt({ min: 5, max: 240 }).withMessage('Duration must be between 5 and 240 minutes')
];

// @route   POST /api/lecturer/generate-qr
// @desc    Generate QR code for a lecture
// @access  Private/Lecturer
router.post('/generate-qr',
  require('../middleware/auth').auth,
  require('../middleware/auth').authorize('lecturer'),
  validate(generateQRValidation),
  async (req, res) => {
    try {
      const lecturerId = req.user._id;
      const lecturerName = req.user.name;
      
      const lectureData = {
        lecturerId,
        lecturerName,
        unitName: req.body.unitName,
        unitCode: req.body.unitCode,
        date: new Date(req.body.date),
        startTime: req.body.startTime,
        endTime: req.body.endTime,
        venue: req.body.venue,
        totalStudents: req.body.totalStudents || 0,
        description: req.body.description || '',
        status: 'ongoing'
      };
      
      const duration = req.body.duration || process.env.QR_CODE_DURATION || 60;
      
      const result = await QRCodeService.generateQRCode(lectureData, parseInt(duration));
      
      res.json({
        success: true,
        message: 'QR code generated successfully',
        data: result.data
      });
    } catch (error) {
      console.error('Generate QR Error:', error);
      res.status(400).json({
        success: false,
        error: error.message
      });
    }
  }
);

// @route   GET /api/lecturer/dashboard
// @desc    Get lecturer dashboard data
// @access  Private/Lecturer
router.get('/dashboard',
  require('../middleware/auth').auth,
  require('../middleware/auth').authorize('lecturer'),
  async (req, res) => {
    try {
      const lecturerId = req.user._id;
      
      // Get today's lectures
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      
      const todayLectures = await Lecture.find({
        lecturerId,
        date: { $gte: today, $lt: tomorrow },
        isActive: true
      })
      .sort({ startTime: 1 })
      .lean();
      
      // Get active QR codes
      const activeLectures = await Lecture.find({
        lecturerId,
        status: 'ongoing',
        isActive: true,
        qrCodeId: { $ne: null }
      })
      .populate('qrCodeId', 'uniqueCode expiresAt scanCount isActive')
      .sort({ createdAt: -1 })
      .limit(5)
      .lean();
      
      // Get recent lectures
      const recentLectures = await Lecture.find({ lecturerId })
        .sort({ createdAt: -1 })
        .limit(10)
        .lean();
      
      // Get QR code statistics
      const qrStats = await QRCodeService.getQRCodeStats(lecturerId);
      
      // Get attendance statistics
      const attendanceStats = await Attendance.aggregate([
        {
          $lookup: {
            from: 'lectures',
            localField: 'lectureId',
            foreignField: '_id',
            as: 'lecture'
          }
        },
        { $unwind: '$lecture' },
        { $match: { 'lecture.lecturerId': lecturerId } },
        {
          $group: {
            _id: null,
            totalAttendance: { $sum: 1 },
            presentCount: {
              $sum: { $cond: [{ $eq: ['$status', 'present'] }, 1, 0] }
            },
            lateCount: {
              $sum: { $cond: [{ $eq: ['$status', 'late'] }, 1, 0] }
            },
            avgAttendanceRate: { $avg: { $cond: [{ $in: ['$status', ['present', 'late']] }, 1, 0] } }
          }
        }
      ]);
      
      // Get unit-wise statistics
      const unitStats = await Attendance.aggregate([
        {
          $lookup: {
            from: 'lectures',
            localField: 'lectureId',
            foreignField: '_id',
            as: 'lecture'
          }
        },
        { $unwind: '$lecture' },
        { $match: { 'lecture.lecturerId': lecturerId } },
        {
          $group: {
            _id: {
              unitCode: '$lecture.unitCode',
              unitName: '$lecture.unitName'
            },
            totalClasses: { $addToSet: '$lectureId' },
            totalAttendance: { $sum: 1 },
            presentCount: {
              $sum: { $cond: [{ $eq: ['$status', 'present'] }, 1, 0] }
            }
          }
        },
        {
          $project: {
            _id: 0,
            unitCode: '$_id.unitCode',
            unitName: '$_id.unitName',
            totalClasses: { $size: '$totalClasses' },
            totalAttendance: 1,
            presentCount: 1,
            attendanceRate: {
              $multiply: [
                { $divide: ['$presentCount', '$totalAttendance'] },
                100
              ]
            }
          }
        },
        { $sort: { attendanceRate: -1 } },
        { $limit: 5 }
      ]);
      
      res.json({
        success: true,
        data: {
          todayLectures,
          activeLectures,
          recentLectures,
          qrStats,
          attendanceStats: attendanceStats[0] || {
            totalAttendance: 0,
            presentCount: 0,
            lateCount: 0,
            avgAttendanceRate: 0
          },
          unitStats,
          lastUpdated: new Date()
        }
      });
    } catch (error) {
      console.error('Lecturer Dashboard Error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to load dashboard data'
      });
    }
  }
);

// @route   GET /api/lecturer/lectures
// @desc    Get lecturer's lectures
// @access  Private/Lecturer
router.get('/lectures',
  require('../middleware/auth').auth,
  require('../middleware/auth').authorize('lecturer'),
  async (req, res) => {
    try {
      const { 
        page = 1, 
        limit = 20, 
        status, 
        unitCode, 
        startDate, 
        endDate,
        sortBy = 'date',
        sortOrder = 'desc' 
      } = req.query;
      
      const lecturerId = req.user._id;
      const skip = (page - 1) * limit;
      
      // Build query
      const query = { lecturerId, isActive: true };
      
      if (status) query.status = status;
      if (unitCode) query.unitCode = { $regex: unitCode, $options: 'i' };
      
      if (startDate || endDate) {
        query.date = {};
        if (startDate) query.date.$gte = new Date(startDate);
        if (endDate) query.date.$lte = new Date(endDate);
      }
      
      // Get lectures
      const lectures = await Lecture.find(query)
        .populate('qrCodeId', 'uniqueCode expiresAt scanCount isActive')
        .sort({ [sortBy]: sortOrder === 'desc' ? -1 : 1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean();
      
      // Get total count
      const total = await Lecture.countDocuments(query);
      
      // Enrich with attendance data
      const lecturesWithAttendance = await Promise.all(
        lectures.map(async (lecture) => {
          const attendanceCount = await Attendance.countDocuments({
            lectureId: lecture._id
          });
          
          return {
            ...lecture,
            attendanceCount,
            attendanceRate: lecture.totalStudents > 0 
              ? ((attendanceCount / lecture.totalStudents) * 100).toFixed(2)
              : 0
          };
        })
      );
      
      res.json({
        success: true,
        data: {
          lectures: lecturesWithAttendance,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            pages: Math.ceil(total / limit)
          }
        }
      });
    } catch (error) {
      console.error('Lectures Error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to load lectures'
      });
    }
  }
);

// @route   GET /api/lecturer/attendance/:lectureId
// @desc    Get attendance for a specific lecture
// @access  Private/Lecturer
router.get('/attendance/:lectureId',
  require('../middleware/auth').auth,
  require('../middleware/auth').authorize('lecturer'),
  async (req, res) => {
    try {
      const lectureId = req.params.lectureId;
      const lecturerId = req.user._id;
      
      // Verify lecture belongs to lecturer
      const lecture = await Lecture.findOne({
        _id: lectureId,
        lecturerId,
        isActive: true
      });
      
      if (!lecture) {
        return res.status(404).json({
          success: false,
          error: 'Lecture not found or access denied'
        });
      }
      
      // Get attendance records
      const attendance = await Attendance.find({ lectureId })
        .populate('studentId', 'name email admissionNumber phone course yearOfStudy')
        .sort({ scanTime: 1 })
        .lean();
      
      // Get statistics
      const stats = await Attendance.aggregate([
        { $match: { lectureId } },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 }
          }
        }
      ]);
      
      // Get attendance timeline (hourly)
      const timeline = await Attendance.aggregate([
        { $match: { lectureId } },
        {
          $group: {
            _id: {
              hour: { $hour: '$scanTime' },
              minute: { $minute: '$scanTime' }
            },
            count: { $sum: 1 }
          }
        },
        { $sort: { '_id.hour': 1, '_id.minute': 1 } }
      ]);
      
      res.json({
        success: true,
        data: {
          lecture,
          attendance,
          stats,
          timeline,
          totalStudents: attendance.length,
          attendanceRate: lecture.totalStudents > 0 
            ? ((attendance.length / lecture.totalStudents) * 100).toFixed(2)
            : 0
        }
      });
    } catch (error) {
      console.error('Lecture Attendance Error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to load attendance data'
      });
    }
  }
);

// @route   PUT /api/lecturer/lectures/:id
// @desc    Update lecture details
// @access  Private/Lecturer
router.put('/lectures/:id',
  require('../middleware/auth').auth,
  require('../middleware/auth').authorize('lecturer'),
  async (req, res) => {
    try {
      const lecturerId = req.user._id;
      const lectureId = req.params.id;
      
      // Verify lecture belongs to lecturer
      const lecture = await Lecture.findOne({
        _id: lectureId,
        lecturerId
      });
      
      if (!lecture) {
        return res.status(404).json({
          success: false,
          error: 'Lecture not found or access denied'
        });
      }
      
      // Update lecture
      const updateData = { ...req.body };
      delete updateData._id;
      delete updateData.lecturerId;
      delete updateData.lecturerName;
      delete updateData.qrCodeId;
      
      const updatedLecture = await Lecture.findByIdAndUpdate(
        lectureId,
        updateData,
        { new: true, runValidators: true }
      ).lean();
      
      res.json({
        success: true,
        message: 'Lecture updated successfully',
        data: updatedLecture
      });
    } catch (error) {
      console.error('Update Lecture Error:', error);
      res.status(400).json({
        success: false,
        error: error.message
      });
    }
  }
);

// @route   DELETE /api/lecturer/lectures/:id
// @desc    Delete (deactivate) a lecture
// @access  Private/Lecturer
router.delete('/lectures/:id',
  require('../middleware/auth').auth,
  require('../middleware/auth').authorize('lecturer'),
  async (req, res) => {
    try {
      const lecturerId = req.user._id;
      const lectureId = req.params.id;
      
      // Verify lecture belongs to lecturer
      const lecture = await Lecture.findOne({
        _id: lectureId,
        lecturerId
      });
      
      if (!lecture) {
        return res.status(404).json({
          success: false,
          error: 'Lecture not found or access denied'
        });
      }
      
      // Deactivate lecture
      lecture.isActive = false;
      lecture.status = 'cancelled';
      await lecture.save();
      
      // Deactivate associated QR code
      if (lecture.qrCodeId) {
        await QRCodeService.deactivateQRCode(lecture.qrCodeId);
      }
      
      res.json({
        success: true,
        message: 'Lecture deactivated successfully'
      });
    } catch (error) {
      console.error('Delete Lecture Error:', error);
      res.status(400).json({
        success: false,
        error: error.message
      });
    }
  }
);

// @route   PUT /api/lecturer/attendance/:id/status
// @desc    Update attendance status manually
// @access  Private/Lecturer
router.put('/attendance/:id/status',
  require('../middleware/auth').auth,
  require('../middleware/auth').authorize('lecturer'),
  [
    body('status').isIn(['present', 'late', 'absent', 'excused']).withMessage('Invalid status')
  ],
  validate,
  async (req, res) => {
    try {
      const { status, notes } = req.body;
      const attendanceId = req.params.id;
      
      // Find attendance and verify lecturer access
      const attendance = await Attendance.findById(attendanceId)
        .populate('lectureId');
      
      if (!attendance) {
        return res.status(404).json({
          success: false,
          error: 'Attendance record not found'
        });
      }
      
      // Verify lecturer owns the lecture
      if (attendance.lectureId.lecturerId.toString() !== req.user._id.toString()) {
        return res.status(403).json({
          success: false,
          error: 'Access denied to this attendance record'
        });
      }
      
      // Update attendance
      attendance.status = status;
      if (notes) attendance.notes = notes;
      attendance.isVerified = false; // Mark as manually verified
      await attendance.save();
      
      res.json({
        success: true,
        message: 'Attendance status updated successfully',
        data: attendance
      });
    } catch (error) {
      console.error('Update Attendance Status Error:', error);
      res.status(400).json({
        success: false,
        error: error.message
      });
    }
  }
);

module.exports = router;
