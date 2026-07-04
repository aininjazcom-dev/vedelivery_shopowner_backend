require('dotenv').config();
const app = require('./app');

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(`VE Delivery Shop Owner Backend running on port ${PORT}`);
  console.log(`CORS allowed origin: ${process.env.CORS_ORIGIN || 'http://localhost:5173'}`);
  console.log(`==================================================`);
});
