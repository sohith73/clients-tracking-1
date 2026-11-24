import mongoose from 'mongoose';

const managerSchema = new mongoose.Schema({
  fullName: {
    type: String,
    required: true,
    trim: true
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  profilePhoto: {
    type: String,
    default: null // Will store Cloudinary URL
  },
  phone: {
    type: String,
    trim: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  // Round robin for new paid clients (auto onboarding): oldest assignment goes next.
  lastAssignedAt: {
    type: Date,
    default: null
  },
  createdAt: {
    type: String,
    default: () => new Date().toLocaleString('en-US', 'Asia/Kolkata')
  },
  updatedAt: {
    type: String,
    default: () => new Date().toLocaleString('en-US', 'Asia/Kolkata')
  }
});

// Update the updatedAt field before saving
managerSchema.pre('save', function(next) {
  this.updatedAt = new Date().toLocaleString('en-US', 'Asia/Kolkata');
  next();
});

// Update the updatedAt field before updating
managerSchema.pre('findOneAndUpdate', function(next) {
  this.set({ updatedAt: new Date().toLocaleString('en-US', 'Asia/Kolkata') });
  next();
});

export const ManagerModel = mongoose.model('Manager', managerSchema, 'dashboard_managers');
// Indexes: see utils/ensureDbIndexes.js
