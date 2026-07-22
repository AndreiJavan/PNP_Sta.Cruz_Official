import multer from 'multer';

// Use memoryStorage for Vercel/Serverless compatibility
const storage = multer.memoryStorage();

const upload = multer({ 
  storage: storage,
  limits: { 
    fileSize: 100 * 1024 * 1024 // Hard limit 100MB max per single stream
  },
  fileFilter: (req, file, cb) => {
    const isImage = file.mimetype.startsWith('image/');
    const isVideo = file.mimetype.startsWith('video/');
    const isDoc = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/csv',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword'
    ].includes(file.mimetype);
    
    if (isImage || isVideo || isDoc) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only Images, Videos, Excel, and DOCX are allowed.') as any, false);
    }
  }
});

export default upload;
