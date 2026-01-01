const mongoose = require('mongoose');

const LectureSchema = new mongoose.Schema({
  lecturerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Lecturer ID is required']
  },
  lecturerName: {
    type: String,
    required: [true, 'Lecturer name is required']
  },
  unitName: {
    type: String,
    required: [true, 'Unit name is required'],
    trim: true
  },
  unitCode: {
    type: String,
    required: [true, 'Unit code is required'],
    uppercase: true,
    trim: true
  },
  date: {
    type: Date,
    required: [true, 'Lecture date is required']
  },
  startTime: {
    type: String,
    required: [true, 'Start time is required'],
    match: [/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, 'Please provide valid time format (HH:MM)']
  },
  endTime: {
    type: String,
    required: [true, 'End time is required'],
    match: [/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, 'Please provide valid time format (HH:MM)']
  },
  venue: {
    type: String,
    required: [true, 'Venue is required'],
    trim: true
  },
  qrCodeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'QRCode'
  },
  status: {
    type: String,
    enum: ['scheduled', 'ongoing', 'completed', 'cancelled'],
    default: 'scheduled'
  },
  attendanceCount: {
    type: Number,
    default: 0,
    min: 0
  },
  totalStudents: {
    type: Number,
    default: 0,
    min: 0
  },
  description: {
    type: String,
    default: '',
    maxlength: [500, 'Description cannot exceed 500 characters']
  },
  isActive: {
    type: Boolean,
    default: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Indexes
LectureSchema.index({ lecturerId: 1, date: 1 });
LectureSchema.index({ unitCode: 1 });
LectureSchema.index({ status: 1 });
LectureSchema.index({ date: 1 });
LectureSchema.index({ createdAt: -1 });

// Virtual for lecture duration
LectureSchema.virtual('duration').get(function() {
  const start = this.startTime.split(':').map(Number);
  const end = this.endTime.split(':').map(Number);
  const startMinutes = start[0] * 60 + start[1];
  const endMinutes = end[0] * 60 + end[1];
  return endMinutes - startMinutes;
});

module.exports = mongoose.model('Lecture', LectureSchema);
