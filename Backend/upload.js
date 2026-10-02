import multer from 'multer';
import { config } from '../config/index.js';

const storage = multer.memoryStorage(); // we only need the buffer, not a saved file

function fileFilter(req, file, cb) {
  if (file.mimetype !== 'application/pdf') {
    return cb(new Error('Only PDF files are accepted.'));
  }
  cb(null, true);
}

export const uploadPdf = multer({
  storage,
  fileFilter,
  limits: { fileSize: config.maxUploadSizeMb * 1024 * 1024 },
});
