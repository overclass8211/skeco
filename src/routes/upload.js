const router = require('express').Router();
const path = require('path');
const express = require('express');
const upload = require('../middleware/upload');
const uploadDir = path.join(__dirname, '..', '..', 'public', 'uploads');

router.post('/', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, error: '파일 없음' });
  res.json({
    success: true,
    url: `/uploads/${req.file.filename}`,
    name: req.file.originalname,
    size: req.file.size,
  });
});

router.use('/', express.static(uploadDir));

module.exports = router;
