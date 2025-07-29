require('dotenv').config();
const express = require('express');
const multer = require('multer');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(process.env.API);

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = 'uploads/';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const upload = multer({ 
  storage: storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  },
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

// Helper function to convert file to base64
function fileToGenerativePart(path, mimeType) {
  return {
    inlineData: {
      data: Buffer.from(fs.readFileSync(path)).toString("base64"),
      mimeType
    },
  };
}

// Helper function to generate HTML table from bill data
function generateHTMLTable(billData) {
  let html = `
    <div style="font-family: Arial, sans-serif; margin: 20px;">
      <h2 style="color: #333; border-bottom: 2px solid #4CAF50; padding-bottom: 10px;">Bill Details</h2>
      <table style="width: 100%; border-collapse: collapse; margin-top: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
        <thead>
          <tr style="background-color: #4CAF50; color: white;">
            <th style="padding: 12px; text-align: left; border: 1px solid #ddd;">Field</th>
            <th style="padding: 12px; text-align: left; border: 1px solid #ddd;">Value</th>
          </tr>
        </thead>
        <tbody>
  `;
  
  // Add basic bill information
  const fields = [
    { key: 'merchant_name', label: 'Merchant Name' },
    { key: 'bill_number', label: 'Bill Number' },
    { key: 'date', label: 'Date' },
    { key: 'time', label: 'Time' },
    { key: 'total_amount', label: 'Total Amount' },
    { key: 'tax_amount', label: 'Tax Amount' },
    { key: 'subtotal', label: 'Subtotal' },
    { key: 'payment_method', label: 'Payment Method' },
    { key: 'currency', label: 'Currency' }
  ];
  
  fields.forEach((field, index) => {
    const value = billData[field.key] || 'N/A';
    const rowColor = index % 2 === 0 ? '#f9f9f9' : 'white';
    html += `
      <tr style="background-color: ${rowColor};">
        <td style="padding: 10px; border: 1px solid #ddd; font-weight: bold;">${field.label}</td>
        <td style="padding: 10px; border: 1px solid #ddd;">${value}</td>
      </tr>
    `;
  });
  
  // Add items if they exist
  if (billData.items && billData.items.length > 0) {
    html += `
      <tr style="background-color: #e8f5e8;">
        <td colspan="2" style="padding: 15px; border: 1px solid #ddd; font-weight: bold; font-size: 16px;">Items Purchased</td>
      </tr>
    `;
    
    billData.items.forEach((item, index) => {
      const rowColor = index % 2 === 0 ? '#f0f8f0' : '#e8f5e8';
      html += `
        <tr style="background-color: ${rowColor};">
          <td style="padding: 10px; border: 1px solid #ddd; padding-left: 20px;">${item.name || 'Item ' + (index + 1)}</td>
          <td style="padding: 10px; border: 1px solid #ddd;">
            Qty: ${item.quantity || 'N/A'} | 
            Price: ${item.price || 'N/A'} | 
            Total: ${item.total || 'N/A'}
          </td>
        </tr>
      `;
    });
  }
  
  html += `
        </tbody>
      </table>
    </div>
  `;
  
  return html;
}

// Root endpoint
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API info endpoint
app.get('/api', (req, res) => {
  res.json({
    message: 'Bill Processor API',
    version: '1.0.0',
    endpoints: {
      'POST /process-bill': 'Upload and process bill image',
      'GET /health': 'Health check endpoint'
    }
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Main bill processing endpoint
app.post('/process-bill', upload.single('bill_image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        error: 'No image file uploaded',
        message: 'Please upload a bill image'
      });
    }

    

    const imagePath = req.file.path;
    const mimeType = req.file.mimetype;

    // Get the generative model
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    // Prepare the prompt for bill analysis
    const prompt = `
      Analyze this bill/receipt image and extract all the important details.
      
      You must return your response in exactly this format:
      
      ---JSON_START---
      {
        // Create an optimal JSON structure based on what you see in the bill
        // The JSON should contain all relevant information from the bill
        // BUT you MUST include these 3 required fields:
        "total_amount": "extracted total amount",
        "time_stamp": "extracted date and time",
        "payment_method": "extracted payment method"
        Save every bill with a timestamp in this exact format: "timestamp": "YYYY-MM-DDTHH:MM:SSZ" using UTC time (ISO 8601 standard)
        
        // Add any other fields you find relevant (merchant name, items, etc.)
        // Structure the JSON optimally based on the bill content
      }
      ---JSON_END---
      
      ---HTML_TABLE_START---
     <div style="overflow-x:auto; font-family: Arial, sans-serif; margin-top: 20px;">
  <table style="width: 100%; border-collapse: collapse; min-width: 400px;">
    <thead>
      <tr style="background-color: #4CAF50; color: white;">
        <th style="padding: 12px; text-align: left; border: 1px solid #ddd;">Field</th>
        <th style="padding: 12px; text-align: left; border: 1px solid #ddd;">Value</th>
      </tr>
    </thead>
    <tbody>
    <!-- Create a clean HTML table with only Merchant, Date, Payment Method, items with pices and quantity, and Total Amount -->
          <!-- Each row should have: <tr>
        <td style="padding: 10px; border: 1px solid #ddd;">field name</td>
        <td style="padding: 10px; border: 1px solid #ddd;">value</td>
      </tr> -->
      <!--For items 
      <tr>
        <td style="padding: 10px; border: 1px solid #ddd;">Items</td>
        <td style="padding: 10px; border: 1px solid #ddd;">
          <ul style="margin: 0; padding-left: 20px;">
            <li>Item 1 (x2) - ₹50</li>
            <li>Item 2 (x1) - ₹100</li>
          </ul>
        </td>
      </tr>-->
    </tbody>
  </table>
</div>
      ---HTML_TABLE_END---
      
      Instructions:
      1. Extract ALL visible information from the bill
      2. The JSON must include total_amount, time_stamp, and payment_method
      3. Structure the JSON optimally based on the bill content (not a fixed format)
      4. Create a clean, readable HTML table with all extracted data
      5. Use "N/A" for any information not clearly visible
      6. Return ONLY the JSON and HTML table, no other text
    `;

    // Convert image to the format expected by Gemini
    const imagePart = fileToGenerativePart(imagePath, mimeType);

    // Generate content using Gemini
    const result = await model.generateContent([prompt, imagePart]);
    const response = await result.response;
    let text = response.text();

    // Parse the response to extract JSON and HTML table
    console.log('Raw Gemini response:', text);
    
    let billData = {};
    let htmlTable = '';
    
    try {
      // Extract JSON part
      const jsonMatch = text.match(/---JSON_START---([\s\S]*?)---JSON_END---/);
      if (jsonMatch) {
        const jsonText = jsonMatch[1].trim();
        billData = JSON.parse(jsonText);
      } else {
        // Fallback: try to parse the entire response as JSON
        billData = JSON.parse(text);
      }
      
      // Extract HTML table part
      const htmlMatch = text.match(/---HTML_TABLE_START---([\s\S]*?)---HTML_TABLE_END---/);
      if (htmlMatch) {
        htmlTable = htmlMatch[1].trim();
      } else {
        // Fallback: generate HTML table from JSON data
        htmlTable = generateHTMLTable(billData);
      }
      
    } catch (parseError) {
      console.error('Response parsing error:', parseError);
      console.error('Raw response:', text);
      
      // Fallback response structure
      billData = {
        error: 'Failed to parse bill data',
        raw_response: text,
        total_amount: 'N/A',
        time_stamp: 'N/A',
        payment_method: 'N/A'
      };
      htmlTable = generateHTMLTable(billData);
    }

    // Clean up uploaded file
    fs.unlink(imagePath, (err) => {
      if (err) console.error('Error deleting uploaded file:', err);
    });

    // Send response
    res.json({
      success: true,
      data: {
        json: billData,
        html_table: htmlTable
      },
      metadata: {
        filename: req.file.originalname,
        processed_at: new Date().toISOString(),
        file_size: req.file.size
      }
    });

  } catch (error) {
    console.error('Error processing bill:', error);
    
    // Clean up uploaded file in case of error
    if (req.file && req.file.path) {
      fs.unlink(req.file.path, (err) => {
        if (err) console.error('Error deleting uploaded file:', err);
      });
    }

    res.status(500).json({
      error: 'Internal server error',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        error: 'File too large',
        message: 'File size should not exceed 10MB'
      });
    }
  }
  
  res.status(500).json({
    error: 'Server error',
    message: error.message
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not found',
    message: 'The requested endpoint does not exist'
  });
});

// Start server
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Bill Processor Server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`Main endpoint: POST http://localhost:${PORT}/process-bill`);
});

module.exports = { app, server };

