import mongoose from 'mongoose';

const ResumeSchema = new mongoose.Schema(
  {
    fileName: { type: String, required: true },
    rawText: { type: String, required: true },
    parsed: {
      name: String,
      email: String,
      phone: String,
      summary: String,
      skills: [String],
      experience: [
        {
          role: String,
          organization: String,
          duration: String,
          highlights: [String],
        },
      ],
      projects: [
        {
          name: String,
          description: String,
          techStack: [String],
        },
      ],
      education: [
        {
          degree: String,
          institution: String,
          year: String,
        },
      ],
      certifications: [String],
    },
    status: {
      type: String,
      enum: ['uploaded', 'parsed', 'failed'],
      default: 'uploaded',
    },
  },
  { timestamps: true }
);

export default mongoose.model('Resume', ResumeSchema);
