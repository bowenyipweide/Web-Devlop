const mongoose = require('mongoose');

const connectDB = async () => {
  const uri = `${process.env.MONGODB_URI.replace(/\/$/, '')}`;
  const opts = {
    dbName: process.env.MONGODB_DATABASE || 'eventease',
    autoIndex: true,
    serverSelectionTimeoutMS: 15000,
  };
  const conn = await mongoose.connect(uri, opts);
  console.log(`[db] MongoDB connected: ${conn.connection.name}`);
  return conn;
};

module.exports = connectDB;