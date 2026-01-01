const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { validate } = require('../middleware/validation');
const QRCodeService = require('../services/qrCodeService');
const Attendance = require('../models/Attendance');
const Lecture = require('../models/Lecture');

// @route   POST /api/student/scan
// @desc    Scan QR code and mark attendance
// @access  Private/Student
router.post('/scan',
  require('../middleware/auth').auth,
  require('../middleware/auth').authorize('student'),
  [
    body('code').notEmpty().withMessage('QR code is required'),
    body('lectureId').optional().isMongoId().withMessage('Invalid lecture ID')
  ],
  validate,
  async (req, res) => {
    try {
      const { code, lectureId } = req.body;
      
      // Validate QR code
      const validation = await QRCodeService.validateQRCode(code, req.user._id);
      
      if (!validation.valid) {
        return res.status(400).json({
          success: false,
          error: validation.message
        });
      }
      
      // Get device info
      const deviceInfo = {
        browser: req.headers['user-agent'] || 'Unknown',
        os: req.headers['sec-ch-ua-platform'] || 'Unknown',
        device: req.headers['sec-ch-ua-mobile'] === '?1' ? 'Mobile' : 'Desktop',
        userAgent: req.headers['user-agent'],
        ip: req.ip || req.connection.remoteAddress
      };
      
      // Record attendance
      const result = await QRCodeService.recordAttendance(
        validation,
        req.user._id,
        deviceInfo
      );
      
      res.json({
        success: true,
        message: 'Attendance marked successfully',
        data: result.data
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        error: error.message
      });
    }
  }
);

// @route   GET /api/student/dashboard
// @desc    Get student dashboard data
// @access  Private/Student
router.get('/dashboard',
  require('../middleware/auth').auth,
  require('../middleware/auth').authorize('student'),
  async (req, res) => {
    try {
      const studentId = req.user._id;
      
      // Get total lectures (for student's courses)
      const totalLectures = await Lecture.countDocuments({
        isActive: true,
        status: { $in: ['completed', 'ongoing'] }
      });
      
      // Get attended lectures
      const attendedLectures = await Attendance.countDocuments({
        studentId,
        status: { $in: ['present', 'late'] }
      });
      
      // Get attendance percentage
      const attendancePercentage = totalLectures > 0 
        ? ((attendedLectures / totalLectures) * 100).toFixed(2)
        : 0;
      
      // Get recent attendance (last 10)
      const recentAttendance = await Attendance.find({ studentId })
        .populate('lectureId', 'unitName unitCode date startTime endTime venue lecturerName')
        .sort({ scanTime: -1 })
        .limit(10)
        .lean();
      
      // Get attendance by status
      const attendanceStats = await Attendance.aggregate([
        { $match: { studentId } },
        { $group: { _id: '$status', count: { $sum: 1 } } }
      ]);
      
      // Get monthly attendance trend
      const monthlyTrend = await Attendance.aggregate([
        { $match: { studentId } },
        {
          $group: {
            _id: {
              year: { $year: '$scanTime' },
              month: { $month: '$scanTime' }
            },
            count: { $sum: 1 }
          }
        },
        { $sort: { '_id.year': 1, '_id.month': 1 } },
        { $limit: 6 }
      ]);
      
      // Get upcoming lectures
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const upcomingLectures = await Lecture.find({
        date: { $gte: today },
        isActive: true,
        status: 'scheduled'
      })
      .sort({ date: 1, startTime: 1 })
      .limit(5)
      .lean();
      
      // Check which upcoming lectures student can attend (not already attended)
      const upcomingLecturesWithStatus = await Promise.all(
        upcomingLectures.map(async (lecture) => {
          const attendance = await Attendance.findOne({
            studentId,
            lectureId: lecture._id
          });
          
          return {
            ...lecture,
            canAttend: !attendance,
            attendanceStatus: attendance ? attendance.status : 'not-attended'
          };
        })
      );
      
      res.json({
        success: true,
        data: {
          stats: {
            totalLectures,
            attendedLectures,
            attendancePercentage,
            attendanceStats,
            monthlyTrend
          },
          recentAttendance,
          upcomingLectures: upcomingLecturesWithStatus,
          lastUpdated: new Date()
        }
      });
    } catch (error) {
      console.error('Dashboard Error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to load dashboard data'
      });
    }
  }
);

// @route   GET /api/student/attendance
// @desc    Get student attendance history
// @access  Private/Student
router.get('/attendance',
  require('../middleware/auth').auth,
  require('../middleware/auth').authorize('student'),
  async (req, res) => {
    try {
      const { 
        page = 1, 
        limit = 20, 
        status, 
        unitCode, 
        startDate, 
        endDate,
        sortBy = 'scanTime',
        sortOrder = 'desc' 
      } = req.query;
      
      const studentId = req.user._id;
      const skip = (page - 1) * limit;
      
      // Build query
      const query = { studentId };
      
      if (status) query.status = status;
      if (unitCode) query['lectureId.unitCode'] = { $regex: unitCode, $options: 'i' };
      
      if (startDate || endDate) {
        query.scanTime = {};
        if (startDate) query.scanTime.$gte = new Date(startDate);
        if (endDate) query.scanTime.$lte = new Date(endDate);
      }
      
      // Get attendance records
      const attendance = await Attendance.find(query)
        .populate('lectureId', 'unitName unitCode date startTime endTime venue lecturerName')
        .populate('qrCodeId', 'uniqueCode')
        .sort({ [sortBy]: sortOrder === 'desc' ? -1 : 1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean();
      
      // Get total count
      const total = await Attendance.countDocuments(query);
      
      // Calculate statistics
      const stats = await Attendance.aggregate([
        { $match: { studentId } },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            present: { 
              $sum: { $cond: [{ $eq: ['$status', 'present'] }, 1, 0] }
            },
            late: { 
              $sum: { $cond: [{ $eq: ['$status', 'late'] }, 1, 0] }
            },
            absent: { 
              $sum: { $cond: [{ $eq: ['$status', 'absent'] }, 1, 0] }
            },
            excused: { 
              $sum: { $cond: [{ $eq: ['$status', 'excused'] }, 1, 0] }
            }
          }
        }
      ]);
      
      res.json({
        success: true,
        data: {
          attendance,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total,
            pages: Math.ceil(total / limit)
          },
          stats: stats[0] || {
            total: 0,
            present: 0,
            late: 0,
            absent: 0,
            excused: 0
          }
        }
      });
    } catch (error) {
      console.error('Attendance History Error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to load attendance history'
      });
    }
  }
);

// @route   GET /api/student/units
// @desc    Get student's enrolled units
// @access  Private/Student
router.get('/units',
  require('../middleware/auth').auth,
  require('../middleware/auth').authorize('student'),
  async (req, res) => {
    try {
      // Get distinct units from attendance records
      const units = await Attendance.aggregate([
        { $match: { studentId: req.user._id } },
        {
          $lookup: {
            from: 'lectures',
            localField: 'lectureId',
            foreignField: '_id',
            as: 'lecture'
          }
        },
        { $unwind: '$lecture' },
        {
          $group: {
            _id: {
              unitCode: '$lecture.unitCode',
              unitName: '$lecture.unitName'
            },
            totalClasses: { $sum: 1 },
            attendedClasses: {
              $sum: { 
                $cond: [{ $in: ['$status', ['present', 'late']] }, 1, 0]
              }
            },
            lastAttendance: { $max: '$scanTime' }
          }
        },
        {
          $project: {
            _id: 0,
            unitCode: '$_id.unitCode',
            unitName: '$_id.unitName',
            totalClasses: 1,
            attendedClasses: 1,
            attendancePercentage: {
              $multiply: [
                { $divide: ['$attendedClasses', '$totalClasses'] },
                100
              ]
            },
            lastAttendance: 1
          }
        },
        { $sort: { unitCode: 1 } }
      ]);
      
      res.json({
        success: true,
        data: units
      });
    } catch (error) {
      console.error('Units Error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to load units data'
      });
    }
  }
);

// @route   GET /api/student/attendance/:id
// @desc    Get single attendance record
// @access  Private/Student
router.get('/attendance/:id',
  require('../middleware/auth').auth,
  require('../middleware/auth').authorize('student'),
  async (req, res) => {
    try {
      const attendance = await Attendance.findOne({
        _id: req.params.id,
        studentId: req.user._id
      })
      .populate('lectureId', 'unitName unitCode date startTime endTime venue lecturerName description')
      .populate('qrCodeId', 'uniqueCode')
      .lean();
      
      if (!attendance) {
        return res.status(404).json({
          success: false,
          error: 'Attendance record not found'
        });
      }
      
      res.json({
        success: true,
        data: attendance
      });
    } catch (error) {
      console.error('Attendance Detail Error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to load attendance details'
      });
    }
  }
);

module.exports = router;
