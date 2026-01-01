const mongoose = require('mongoose');

const QRCodeSchema = new mongoose.Schema({
  lectureId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Lecture',
    required: [true, 'Lecture ID is required'],
    index: true
  },
  uniqueCode: {
    type: String,
    required: [true, 'Unique code is required'],
    unique: true,
    index: true
  },
  qrCodeImage: {
    type: String,
    required: [true, 'QR code image is required']
  },
  expiresAt: {
    type: Date,
    required: [true, 'Expiration time is required'],
    index: { expires: 0 }
  },
  isActive: {
    type: Boolean,
    default: true,
    index: true
  },
  scanCount: {
    type: Number,
    default: 0,
    min: 0
  },
  maxScans: {
    type: Number,
    default: 100,
    min: 1
  },
  locationRestricted: {
    type: Boolean,
    default: false
  },
  allowedCoordinates: {
    latitude: Number,
    longitude: Number,
    radius: { type: Number, default: 50 } // in meters
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  }
}, {
  timestamps: true
});

// TTL Index for automatic expiration
QRCodeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Compound indexes
QRCodeSchema.index({ lectureId: 1, isActive: 1 });
QRCodeSchema.index({ uniqueCode: 1, isActive: 1 });

module.exports = mongoose.model('QRCode', QRCodeSchema);
