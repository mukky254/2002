const mongoose = require('mongoose');

const AttendanceSchema = new mongoose.Schema({
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Student ID is required'],
    index: true
  },
  lectureId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Lecture',
    required: [true, 'Lecture ID is required'],
    index: true
  },
  qrCodeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'QRCode',
    required: [true, 'QR Code ID is required']
  },
  scanTime: {
    type: Date,
    default: Date.now,
    index: true
  },
  status: {
    type: String,
    enum: ['present', 'late', 'absent', 'excused'],
    default: 'present'
  },
  deviceInfo: {
    browser: String,
    os: String,
    device: String,
    userAgent: String,
    ip: String
  },
  location: {
    latitude: Number,
    longitude: Number,
    accuracy: Number,
    address: String
  },
  isVerified: {
    type: Boolean,
    default: true
  },
  notes: {
    type: String,
    maxlength: [200, 'Notes cannot exceed 200 characters']
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Unique compound index to prevent duplicate attendance
AttendanceSchema.index({ studentId: 1, lectureId: 1 }, { unique: true });

// Compound indexes for better query performance
AttendanceSchema.index({ studentId: 1, scanTime: -1 });
AttendanceSchema.index({ lectureId: 1, scanTime: -1 });
AttendanceSchema.index({ status: 1, scanTime: -1 });
AttendanceSchema.index({ qrCodeId: 1 });

// Pre-save middleware to set status based on scan time
AttendanceSchema.pre('save', async function(next) {
  if (this.isNew) {
    const Lecture = mongoose.model('Lecture');
    try {
      const lecture = await Lecture.findById(this.lectureId);
      if (lecture) {
        const lectureDate = new Date(lecture.date);
        const lectureStartTime = lecture.startTime.split(':');
        const lectureStart = new Date(lectureDate);
        lectureStart.setHours(lectureStartTime[0], lectureStartTime[1], 0, 0);
        
        const lectureEndTime = lecture.endTime.split(':');
        const lectureEnd = new Date(lectureDate);
        lectureEnd.setHours(lectureEndTime[0], lectureEndTime[1], 0, 0);
        
        // If scan is 15 minutes after start time, mark as late
        const lateThreshold = new Date(lectureStart.getTime() + 15 * 60000);
        
        if (this.scanTime > lectureEnd) {
          this.status = 'absent';
        } else if (this.scanTime > lateThreshold) {
          this.status = 'late';
        } else {
          this.status = 'present';
        }
      }
    } catch (error) {
      console.error('Error setting attendance status:', error);
    }
  }
  next();
});

module.exports = mongoose.model('Attendance', AttendanceSchema);
