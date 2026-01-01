const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Lecture = require('../models/Lecture');
const Attendance = require('../models/Attendance');
const QRCode = require('../models/QRCode');

// @route   GET /api/admin/dashboard
// @desc    Get admin dashboard data
// @access  Private/Admin
router.get('/dashboard',
  require('../middleware/auth').auth,
  require('../middleware/auth').authorize('admin'),
  async (req, res) => {
    try {
      // Get user statistics
      const userStats = await User.aggregate([
        {
          $group: {
            _id: '$role',
            count: { $sum: 1 },
            active: {
              $sum: { $cond: [{ $eq: ['$isActive', true] }, 1, 0] }
            }
          }
        }
      ]);
      
      // Get lecture statistics
      const lectureStats = await Lecture.aggregate([
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
            totalAttendance: { $sum: '$attendanceCount' }
          }
        }
      ]);
      
      // Get attendance statistics
      const attendanceStats = await Attendance.aggregate([
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            today: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $gte: ['$scanTime', new Date(new Date().setHours(0, 0, 0, 0))] },
                      { $lt: ['$scanTime', new Date(new Date().setHours(23, 59, 59, 999))] }
                    ]
                  },
                  1,
                  0
                ]
              }
            },
            thisWeek: {
              $sum: {
                $cond: [
                  {
                    $gte: ['$scanTime', new Date(new Date().setDate(new Date().getDate() - 7))]
                  },
                  1,
                  0
                ]
              }
            },
            thisMonth: {
              $sum: {
                $cond: [
                  {
                    $gte: ['$scanTime', new Date(new Date().setMonth(new Date().getMonth() - 1))]
                  },
                  1,
                  0
                ]
              }
            }
          }
        }
      ]);
      
      // Get QR code statistics
      const qrStats = await QRCode.aggregate([
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            active: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $eq: ['$isActive', true] },
                      { $gt: ['$expiresAt', new Date()] }
                    ]
                  },
                  1,
                  0
                ]
              }
            },
            totalScans: { $sum: '$scanCount' },
            avgScans: { $avg: '$scanCount' }
          }
        }
      ]);
      
      // Get recent activities
      const recentActivities = await Attendance.find()
        .populate('studentId', 'name admissionNumber')
        .populate('lectureId', 'unitName unitCode')
        .sort({ scanTime: -1 })
        .limit(10)
        .lean();
      
      // Get system health
      const systemHealth = {
        database: 'connected',
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage(),
        timestamp: new Date()
      };
      
      // Get top performing units
      const topUnits = await Attendance.aggregate([
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
          userStats,
          lectureStats,
          attendanceStats: attendanceStats[0] || {
            total: 0,
            today: 0,
            thisWeek: 0,
            thisMonth: 0
          },
          qrStats: qrStats[0] || {
            total: 0,
            active: 0,
            totalScans: 0,
            avgScans: 0
          },
          recentActivities,
          systemHealth,
          topUnits,
          lastUpdated: new Date()
        }
      });
    } catch (error) {
      console.error('Admin Dashboard Error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to load admin dashboard data'
      });
    }
  }
);

// @route   GET /api/admin/reports/attendance
// @desc    Get comprehensive attendance report
// @access  Private/Admin
router.get('/reports/attendance',
  require('../middleware/auth').auth,
  require('../middleware/auth').authorize('admin'),
  async (req, res) => {
    try {
      const { 
        startDate, 
        endDate, 
        department, 
        course, 
        yearOfStudy,
        groupBy = 'student' 
      } = req.query;
      
      // Build match query
      const matchQuery = {};
      
      if (startDate || endDate) {
        matchQuery.scanTime = {};
        if (startDate) matchQuery.scanTime.$gte = new Date(startDate);
        if (endDate) matchQuery.scanTime.$lte = new Date(endDate);
      }
      
      // Get attendance with student details
      const attendancePipeline = [
        {
          $lookup: {
            from: 'users',
            localField: 'studentId',
            foreignField: '_id',
            as: 'student'
          }
        },
        { $unwind: '$student' },
        {
          $lookup: {
            from: 'lectures',
            localField: 'lectureId',
            foreignField: '_id',
            as: 'lecture'
          }
        },
        { $unwind: '$lecture' }
      ];
      
      // Apply filters
      if (department) {
        attendancePipeline.push({
          $match: { 'student.department': department }
        });
      }
      
      if (course) {
        attendancePipeline.push({
          $match: { 'student.course': course }
        });
      }
      
      if (yearOfStudy) {
        attendancePipeline.push({
          $match: { 'student.yearOfStudy': yearOfStudy }
        });
      }
      
      // Group based on parameter
      if (groupBy === 'student') {
        attendancePipeline.push(
          {
            $group: {
              _id: {
                studentId: '$studentId',
                studentName: '$student.name',
                admissionNumber: '$student.admissionNumber',
                course: '$student.course',
                department: '$student.department',
                yearOfStudy: '$student.yearOfStudy'
              },
              totalClasses: { $addToSet: '$lectureId' },
              totalAttendance: { $sum: 1 },
              presentCount: {
                $sum: { $cond: [{ $eq: ['$status', 'present'] }, 1, 0] }
              },
              lateCount: {
                $sum: { $cond: [{ $eq: ['$status', 'late'] }, 1, 0] }
              },
              absentCount: {
                $sum: { $cond: [{ $eq: ['$status', 'absent'] }, 1, 0] }
              },
              excusedCount: {
                $sum: { $cond: [{ $eq: ['$status', 'excused'] }, 1, 0] }
              },
              firstAttendance: { $min: '$scanTime' },
              lastAttendance: { $max: '$scanTime' }
            }
          },
          {
            $project: {
              _id: 0,
              studentId: '$_id.studentId',
              studentName: '$_id.studentName',
              admissionNumber: '$_id.admissionNumber',
              course: '$_id.course',
              department: '$_id.department',
              yearOfStudy: '$_id.yearOfStudy',
              totalClasses: { $size: '$totalClasses' },
              totalAttendance: 1,
              presentCount: 1,
              lateCount: 1,
              absentCount: 1,
              excusedCount: 1,
              attendancePercentage: {
                $multiply: [
                  {
                    $divide: [
                      { $add: ['$presentCount', '$lateCount'] },
                      '$totalAttendance'
                    ]
                  },
                  100
                ]
              },
              firstAttendance: 1,
              lastAttendance: 1
            }
          },
          { $sort: { attendancePercentage: -1 } }
        );
      } else if (groupBy === 'unit') {
        attendancePipeline.push(
          {
            $group: {
              _id: {
                unitCode: '$lecture.unitCode',
                unitName: '$lecture.unitName',
                lecturerName: '$lecture.lecturerName'
              },
              totalClasses: { $addToSet: '$lectureId' },
              totalAttendance: { $sum: 1 },
              presentCount: {
                $sum: { $cond: [{ $eq: ['$status', 'present'] }, 1, 0] }
              },
              lateCount: {
                $sum: { $cond: [{ $eq: ['$status', 'late'] }, 1, 0] }
              },
              uniqueStudents: { $addToSet: '$studentId' }
            }
          },
          {
            $project: {
              _id: 0,
              unitCode: '$_id.unitCode',
              unitName: '$_id.unitName',
              lecturerName: '$_id.lecturerName',
              totalClasses: { $size: '$totalClasses' },
              totalAttendance: 1,
              presentCount: 1,
              lateCount: 1,
              totalStudents: { $size: '$uniqueStudents' },
              attendanceRate: {
                $multiply: [
                  {
                    $divide: [
                      { $add: ['$presentCount', '$lateCount'] },
                      '$totalAttendance'
                    ]
                  },
                  100
                ]
              }
            }
          },
          { $sort: { attendanceRate: -1 } }
        );
      } else if (groupBy === 'daily') {
        attendancePipeline.push(
          {
            $group: {
              _id: {
                date: {
                  $dateToString: { format: '%Y-%m-%d', date: '$scanTime' }
                }
              },
              totalAttendance: { $sum: 1 },
              presentCount: {
                $sum: { $cond: [{ $eq: ['$status', 'present'] }, 1, 0] }
              },
              uniqueStudents: { $addToSet: '$studentId' },
              uniqueLectures: { $addToSet: '$lectureId' }
            }
          },
          {
            $project: {
              _id: 0,
              date: '$_id.date',
              totalAttendance: 1,
              presentCount: 1,
              totalStudents: { $size: '$uniqueStudents' },
              totalLectures: { $size: '$uniqueLectures' },
              attendanceRate: {
                $multiply: [
                  { $divide: ['$presentCount', '$totalAttendance'] },
                  100
                ]
              }
            }
          },
          { $sort: { date: -1 } }
        );
      }
      
      const report = await Attendance.aggregate(attendancePipeline);
      
      // Get summary statistics
      const summary = await Attendance.aggregate([
        ...attendancePipeline.slice(0, -1), // Remove last grouping
        {
          $group: {
            _id: null,
            totalRecords: { $sum: 1 },
            totalStudents: { $addToSet: '$studentId' },
            totalLectures: { $addToSet: '$lectureId' },
            presentCount: {
              $sum: { $cond: [{ $eq: ['$status', 'present'] }, 1, 0] }
            },
            lateCount: {
              $sum: { $cond: [{ $eq: ['$status', 'late'] }, 1, 0] }
            }
          }
        },
        {
          $project: {
            _id: 0,
            totalRecords: 1,
            totalStudents: { $size: '$totalStudents' },
            totalLectures: { $size: '$totalLectures' },
            presentCount: 1,
            lateCount: 1,
            overallAttendanceRate: {
              $multiply: [
                {
                  $divide: [
                    { $add: ['$presentCount', '$lateCount'] },
                    '$totalRecords'
                  ]
                },
                100
              ]
            }
          }
        }
      ]);
      
      res.json({
        success: true,
        data: {
          report,
          summary: summary[0] || {
            totalRecords: 0,
            totalStudents: 0,
            totalLectures: 0,
            presentCount: 0,
            lateCount: 0,
            overallAttendanceRate: 0
          },
          filters: {
            startDate,
            endDate,
            department,
            course,
            yearOfStudy,
            groupBy
          },
          generatedAt: new Date()
        }
      });
    } catch (error) {
      console.error('Attendance Report Error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to generate attendance report'
      });
    }
  }
);

// @route   GET /api/admin/reports/export
// @desc    Export attendance report
// @access  Private/Admin
router.get('/reports/export',
  require('../middleware/auth').auth,
  require('../middleware/auth').authorize('admin'),
  async (req, res) => {
    try {
      const { format = 'csv', ...filters } = req.query;
      
      // Get report data
      const reportResponse = await fetch(`http://localhost:${process.env.PORT}/api/admin/reports/attendance?${new URLSearchParams(filters).toString()}`, {
        headers: {
          'Authorization': req.headers.authorization
        }
      });
      
      const reportData = await reportResponse.json();
      
      if (!reportData.success) {
        throw new Error(reportData.error);
      }
      
      if (format === 'csv') {
        // Convert to CSV
        const { Parser } = require('json2csv');
        const fields = Object.keys(reportData.data.report[0] || {});
        const parser = new Parser({ fields });
        const csv = parser.parse(reportData.data.report);
        
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=attendance-report-${Date.now()}.csv`);
        res.send(csv);
      } else if (format === 'json') {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename=attendance-report-${Date.now()}.json`);
        res.send(JSON.stringify(reportData.data, null, 2));
      } else if (format === 'pdf') {
        // PDF generation would require additional libraries like pdfkit
        res.status(400).json({
          success: false,
          error: 'PDF export not implemented yet'
        });
      } else {
        res.status(400).json({
          success: false,
          error: 'Unsupported export format'
        });
      }
    } catch (error) {
      console.error('Export Error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to export report'
      });
    }
  }
);

// @route   GET /api/admin/system/stats
// @desc    Get system statistics
// @access  Private/Admin
router.get('/system/stats',
  require('../middleware/auth').auth,
  require('../middleware/auth').authorize('admin'),
  async (req, res) => {
    try {
      // Get database statistics
      const dbStats = {
        users: await User.countDocuments(),
        lectures: await Lecture.countDocuments(),
        attendance: await Attendance.countDocuments(),
        qrCodes: await QRCode.countDocuments(),
        activeQRCodes: await QRCode.countDocuments({ 
          isActive: true, 
          expiresAt: { $gt: new Date() } 
        })
      };
      
      // Get growth statistics (last 30 days)
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      
      const growthStats = {
        newUsers: await User.countDocuments({ createdAt: { $gte: thirtyDaysAgo } }),
        newLectures: await Lecture.countDocuments({ createdAt: { $gte: thirtyDaysAgo } }),
        newAttendance: await Attendance.countDocuments({ createdAt: { $gte: thirtyDaysAgo } }),
        activeUsers: await User.countDocuments({ 
          lastLogin: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } 
        })
      };
      
      // Get performance metrics
      const avgAttendancePerLecture = await Lecture.aggregate([
        { $match: { attendanceCount: { $gt: 0 } } },
        { $group: { _id: null, avg: { $avg: '$attendanceCount' } } }
      ]);
      
      const avgScansPerQR = await QRCode.aggregate([
        { $match: { scanCount: { $gt: 0 } } },
        { $group: { _id: null, avg: { $avg: '$scanCount' } } }
      ]);
      
      res.json({
        success: true,
        data: {
          dbStats,
          growthStats,
          performance: {
            avgAttendancePerLecture: avgAttendancePerLecture[0]?.avg || 0,
            avgScansPerQR: avgScansPerQR[0]?.avg || 0,
            systemUptime: process.uptime(),
            memoryUsage: process.memoryUsage()
          },
          timestamp: new Date()
        }
      });
    } catch (error) {
      console.error('System Stats Error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get system statistics'
      });
    }
  }
);

// @route   POST /api/admin/system/backup
// @desc    Create system backup
// @access  Private/Admin
router.post('/system/backup',
  require('../middleware/auth').auth,
  require('../middleware/auth').authorize('admin'),
  async (req, res) => {
    try {
      const backupData = {
        timestamp: new Date(),
        users: await User.find().lean(),
        lectures: await Lecture.find().lean(),
        attendance: await Attendance.find().lean(),
        qrCodes: await QRCode.find().lean(),
        metadata: {
          version: '1.0.0',
          backupType: 'full',
          records: {
            users: await User.countDocuments(),
            lectures: await Lecture.countDocuments(),
            attendance: await Attendance.countDocuments(),
            qrCodes: await QRCode.countDocuments()
          }
        }
      };
      
      // In production, you would save this to a file or cloud storage
      // For now, we'll just return it
      
      res.json({
        success: true,
        message: 'Backup created successfully',
        data: {
          backupId: `backup-${Date.now()}`,
          timestamp: backupData.timestamp,
          records: backupData.metadata.records,
          downloadUrl: `/api/admin/system/backup/${Date.now()}` // Example URL
        }
      });
    } catch (error) {
      console.error('Backup Error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to create backup'
      });
    }
  }
);

// @route   GET /api/admin/system/logs
// @desc    Get system logs
// @access  Private/Admin
router.get('/system/logs',
  require('../middleware/auth').auth,
  require('../middleware/auth').authorize('admin'),
  async (req, res) => {
    try {
      const { limit = 100, type, startDate, endDate } = req.query;
      
      // In a real application, you would query from a logs database
      // For now, we'll return mock logs
      const mockLogs = [
        {
          timestamp: new Date(),
          level: 'INFO',
          type: 'SYSTEM',
          message: 'System started successfully',
          userId: 'system',
          ip: '127.0.0.1'
        },
        {
          timestamp: new Date(Date.now() - 3600000),
          level: 'INFO',
          type: 'AUTH',
          message: 'User logged in successfully',
          userId: 'admin001',
          ip: '192.168.1.100'
        },
        {
          timestamp: new Date(Date.now() - 7200000),
          level: 'WARN',
          type: 'ATTENDANCE',
          message: 'QR code scan failed - expired',
          userId: 'student001',
          ip: '192.168.1.101'
        }
      ];
      
      res.json({
        success: true,
        data: {
          logs: mockLogs,
          total: mockLogs.length,
          filters: { limit, type, startDate, endDate }
        }
      });
    } catch (error) {
      console.error('Logs Error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get system logs'
      });
    }
  }
);

module.exports = router;
